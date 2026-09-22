import { afterEach, expect, test } from "bun:test";
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
