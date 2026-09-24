import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalHost } from "../evals/harness.js";
import {
	cancelRequestBudget,
	createRequestBudget,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import { createSimulationTransport } from "../evals/recovery-decisions/simulation-transport.js";
import {
	ExperimentalProfile,
	type RecoveryTreatment,
	RecoveryTreatmentSchema,
	validateTreatmentBudget,
} from "../evals/recovery-decisions/treatment.js";
import { RecoveryController } from "../src/application/recovery-policy.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
const treatment: RecoveryTreatment = {
	origin: "simulation",
	arm: "manager-plus-jev",
	script: { kind: "guarded-reset-v1", outcome: "accepted" },
};
async function budget(
	options: { live?: boolean; missingJev?: boolean; expired?: boolean } = {},
) {
	const root = await mkdtemp(join(tmpdir(), "treatment-unit-"));
	directories.push(root);
	const directory = join(root, "ledger");
	const authorization = await createRequestBudget(directory, {
		schemaVersion: 1,
		origin: options.live ? "live" : "simulation",
		purpose: "Treatment admission test",
		maxRequests: 10,
		maxMicroUsd: 50000,
		expiresAt: new Date(
			Date.now() + (options.expired ? 100 : 60000),
		).toISOString(),
		models: [
			"xai/grok-4.6",
			...(options.missingJev ? [] : ["typesafe/jev-1.13.0"]),
		].map((model) => ({
			model,
			reservationMicroUsd: 5000,
			basis: options.live
				? {
						kind: "reviewed-upper-bound",
						reviewedBy: "test",
						evidenceDigest: "a".repeat(64),
					}
				: { kind: "simulation" },
		})),
	});
	return {
		directory,
		authorizationDigest: datasetDigest(authorization),
		managerModel: "xai/grok-4.6" as const,
	};
}
test("treatment startup rejects missing, live, cancelled, mismatched and incomplete budgets", async () => {
	await expect(validateTreatmentBudget(treatment, undefined)).rejects.toThrow(
		"requires a request budget",
	);
	const valid = await budget();
	expect(
		(await validateTreatmentBudget(treatment, valid)).authorization.origin,
	).toBe("simulation");
	await expect(
		validateTreatmentBudget(treatment, {
			...valid,
			authorizationDigest: "0".repeat(64),
		}),
	).rejects.toThrow("Invalid simulation");
	await expect(
		validateTreatmentBudget(treatment, await budget({ live: true })),
	).rejects.toThrow("Invalid simulation");
	await expect(
		validateTreatmentBudget(treatment, await budget({ missingJev: true })),
	).rejects.toThrow("Invalid simulation");
	await expect(
		validateTreatmentBudget(treatment, {
			...valid,
			managerModel: "unsupported/model",
		}),
	).rejects.toThrow("Invalid simulation");
	const expired = await budget({ expired: true });
	await Bun.sleep(150);
	await expect(validateTreatmentBudget(treatment, expired)).rejects.toThrow(
		"Invalid simulation",
	);
	await cancelRequestBudget(valid.directory);
	await expect(validateTreatmentBudget(treatment, valid)).rejects.toThrow(
		"Invalid simulation",
	);
});

test("treatment budget admission honors cancellation during ledger reads", async () => {
	const simulation = await budget();
	const live = await budget({ live: true });
	const cancelled = new AbortController();
	cancelled.abort(new Error("Admission cancelled"));
	await expect(
		validateTreatmentBudget(treatment, simulation, cancelled.signal),
	).rejects.toThrow("Admission cancelled");
	await expect(
		validateTreatmentBudget(
			{ origin: "live", arm: "manager-plus-jev" },
			{
				...live,
				scope: {
					executionId: randomUUID(),
					registrationDigest: "a".repeat(64),
					episodeId: "one",
					arm: "manager-plus-jev",
					harnessDigest: "b".repeat(64),
				},
			},
			cancelled.signal,
		),
	).rejects.toThrow("Admission cancelled");
});
test("host refuses treatment without a gate before any process starts", async () => {
	await expect(
		EvalHost.start({
			toolchain: {
				executable: "/unused",
				expectedVersion: "1.4.0",
				actualVersion: "1.4.0",
				environment: {},
			},
			packageCache: "/unused",
			opencodeVersion: "1.18.31",
			files: { "README.md": "test" },
			recoveryTreatment: treatment,
		}),
	).rejects.toThrow("requires a request budget");
	expect(() =>
		RecoveryTreatmentSchema.parse({ ...treatment, origin: "live" }),
	).toThrow();
	expect(() =>
		RecoveryTreatmentSchema.parse({ ...treatment, thresholds: { choice: 0 } }),
	).toThrow();
});
test("injected profiles always carry experimental provenance and controllers have separate leases", () => {
	const provider = {
		async assess() {
			return { kind: "unavailable" as const, reason: "test" };
		},
	};
	const one = new RecoveryController(provider, {
		profiles: [ExperimentalProfile],
	});
	const two = new RecoveryController(provider, {
		profiles: [ExperimentalProfile],
	});
	one.activate("host", { mode: "delegated", maxCalls: 3, maxUsd: 0.01 });
	expect(one.snapshot()).toMatchObject({
		qualification: "experimental-evaluation",
		mode: "delegated",
	});
	expect(two.snapshot()).toEqual({ mode: "off" });
	expect(() =>
		new RecoveryController(provider).activate("host", {
			mode: "delegated",
			maxCalls: 3,
			maxUsd: 0.01,
		}),
	).toThrow("No release-owned");
	expect(ExperimentalProfile).toMatchObject({
		choice: 0.9,
		goal: 0.95,
		suitability: 0.95,
	});
	expect(Object.isFrozen(ExperimentalProfile)).toBe(true);
});
test("simulation has no remote fallback and emits one bounded Jev result", async () => {
	const transport = createSimulationTransport(treatment.script);
	await expect(
		transport(
			new Request("https://auth.x.ai/oauth2/token", {
				method: "POST",
				body: "{}",
			}),
		),
	).rejects.toThrow("Unexpected simulation route");
	const request = () =>
		new Request("https://api.typesafe.ai/v1/systemone", {
			method: "POST",
			body: JSON.stringify({
				model: "jev-1.13.0",
				state: { candidates: [{ id: "actual-candidate" }] },
			}),
		});
	expect(await (await transport(request())).json()).toMatchObject({
		answers: { choice: { choice: "actual-candidate" } },
	});
	await expect(transport(request())).rejects.toThrow("exhausted");
});

test("guarded reset simulation refuses a fresh Flow checkpoint", async () => {
	const transport = createSimulationTransport(treatment.script);
	const request = new Request(
		"https://chatgpt.com/backend-api/codex/responses",
		{
			method: "POST",
			body: JSON.stringify({
				model: "gpt-5.6-terra",
				stream: true,
				tools: [{ name: "flow_status" }],
				input: [
					{ type: "function_call", call_id: "call-1", name: "flow_status" },
					{
						type: "function_call_output",
						call_id: "call-1",
						output: JSON.stringify({
							status: "ok",
							workflowData: {
								projection: {
									status: "idle",
									revision: 0,
									nextAction: "flow_plan_save",
								},
							},
						}),
					},
				],
			}),
		},
	);
	await expect(transport(request)).rejects.toThrow("blocked fixture");
});

test("simulation cites every live blocker of the blocked feature", async () => {
	const transport = createSimulationTransport(treatment.script);
	const response = await transport(
		new Request("https://chatgpt.com/backend-api/codex/responses", {
			method: "POST",
			body: JSON.stringify({
				model: "gpt-5.6-terra",
				stream: true,
				tools: [{ name: "flow_status" }],
				input: [
					{ type: "function_call", call_id: "call-1", name: "flow_status" },
					{
						type: "function_call_output",
						call_id: "call-1",
						output: JSON.stringify({
							status: "ok",
							workflowData: {
								projection: {
									sessionId: "blocked-session",
									revision: 12,
									blockedFeature: { featureId: "parser" },
									findingsDigest: [
										{
											featureId: "other",
											findingId: "other.R1-01",
											severity: "blocking",
											live: true,
										},
										{
											featureId: "parser",
											findingId: "parser.R1-01",
											severity: "blocking",
											live: true,
										},
										{
											featureId: "parser",
											findingId: "parser.R2-02",
											severity: "blocking",
											live: true,
										},
										{
											featureId: "parser",
											findingId: "parser.R0-03",
											severity: "blocking",
											live: false,
										},
									],
								},
							},
						}),
					},
				],
			}),
		}),
	);
	const events = (await response.text())
		.split("\n\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)));
	const done = events.find((event) => event.type === "response.completed");
	const argumentsText = done?.response?.output?.[0]?.arguments;
	if (typeof argumentsText !== "string")
		throw new Error("Simulation did not call a tool.");
	expect(JSON.parse(argumentsText)).toMatchObject({
		recoveryProposal: {
			candidates: [{ findingIds: ["parser.R1-01", "parser.R2-02"] }],
		},
	});
});

test("operator-only simulation writes only its declared result file", async () => {
	const transport = createSimulationTransport({ kind: "operator-resume-v1" });
	const response = await transport(
		new Request("https://api.x.ai/v1/responses", {
			method: "POST",
			body: JSON.stringify({
				model: "grok-4.6",
				stream: true,
				tools: [{ name: "flow_status" }],
				input: [
					{
						type: "message",
						role: "user",
						content: [
							{
								type: "input_text",
								text: "Write fixed followed by a newline.",
							},
						],
					},
				],
			}),
		}),
	);
	const events = (await response.text())
		.split("\n\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)));
	const done = events.find((event) => event.type === "response.completed");
	const call = done?.response?.output?.[0];
	expect(call?.name).toBe("bash");
	expect(JSON.parse(call?.arguments ?? "{}").command).toBe(
		"printf 'fixed\\n' > result.txt",
	);
});
