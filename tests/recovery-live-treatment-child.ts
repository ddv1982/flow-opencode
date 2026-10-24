import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Plugin } from "@opencode/plugin";
import BudgetPlugin from "../evals/recovery-decisions/budget-plugin.js";
import {
	cancelRequestBudget,
	createRequestBudget,
	type EpisodeReservationScope,
	reconcileRequestReservations,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import type { RecoveryController } from "../src/application/recovery-policy.js";
import type { createFlowPlugin as FlowFactory } from "../src/platform/opencode/plugin-composition.js";
import {
	approveSession,
	deterministicEnvironment,
	MemorySessionRepository,
	plan,
	resetFeatureRun,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

let capturedRecovery: RecoveryController | undefined;
mock.module("../src/platform/opencode/plugin-composition.js", () => ({
	createFlowPlugin: (dependencies: Parameters<typeof FlowFactory>[0]) =>
		Plugin.define({
			id: "native-composition-unit",
			setup() {
				capturedRecovery = dependencies.createRecovery();
				return () => {
					capturedRecovery?.revoke();
				};
			},
		}),
}));
const { default: LiveTreatmentPlugin } = await import(
	"../evals/recovery-decisions/live-treatment-plugin.js"
);
async function blockedFixture() {
	const repository = new MemorySessionRepository();
	const flow = await approveSession(repository, deterministicEnvironment(), {
		goal: "Repair parser null handling and write the selected output after recovery.",
		plan: {
			...plan,
			features: [
				{
					id: "parser",
					title: "Parser recovery",
					summary: "Repair parser null handling",
					targets: ["parser.ts"],
					validation: ["bun test"],
					dependsOn: [],
				},
			],
		},
	});
	for (let index = 0; index < 2; index += 1) {
		if (index)
			await resetFeatureRun(flow, repository, "parser", `reset-${index}`);
		await startReviewedRun(flow, repository, {
			featureId: "parser",
			suffix: `failed-${index}`,
		});
		await submitReview(flow, repository, {
			featureId: "parser",
			suffix: `failed-${index}`,
			summary: "Missing null guard",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "Null input crashes",
					evidence: "parser.ts",
					...(index
						? {
								findingId:
									repository.session?.runs[0]?.reviews[0]?.result?.findings[0]
										?.findingId,
							}
						: {}),
				},
			],
		});
	}
	if (!repository.session) throw new Error("Missing blocked recovery session");
	return { session: repository.session, sourceDigest: repository.sourceDigest };
}

const root = process.argv[2];
const scenario = process.argv[3];
assert(root && scenario);
const managerModel =
	process.argv[4] === "xai" ? "xai/grok-4.6" : "openai/gpt-6-sol";
const control =
	scenario === "control" ||
	scenario === "control-with-jev" ||
	scenario === "control-manager-gate";
const workspace = join(root, "workspace");
await mkdir(workspace);
const scope: EpisodeReservationScope = {
	executionId: randomUUID(),
	registrationDigest: "a".repeat(64),
	episodeId: "episode",
	arm: control ? "manager-only" : "manager-plus-jev",
	harnessDigest: "b".repeat(64),
};
const directory = join(root, "budget");
const simulation = scenario === "simulation";
const retryReplacedFetch = scenario === "retry-replaced-fetch";
const modelNames =
	scenario === "control" ||
	scenario === "control-manager-gate" ||
	scenario === "missing-jev"
		? [managerModel]
		: scenario === "wrong-manager"
			? [
					managerModel === "xai/grok-4.6" ? "openai/gpt-6-sol" : "xai/grok-4.6",
					"typesafe/jev-1.13.0",
				]
			: scenario === "other-manager"
				? ["openai/gpt-6-sol", "xai/grok-4.6", "typesafe/jev-1.13.0"]
				: [managerModel, "typesafe/jev-1.13.0"];
const authorization = await createRequestBudget(directory, {
	schemaVersion: 1,
	origin: simulation ? "simulation" : "live",
	purpose: "Intercepted test only",
	maxRequests: retryReplacedFetch ? 2 : 1,
	maxMicroUsd: retryReplacedFetch ? 6000 : 3000,
	expiresAt: new Date(Date.now() + 60000).toISOString(),
	models: modelNames.map((model) => ({
		model,
		reservationMicroUsd: 3000,
		basis: simulation
			? { kind: "simulation" }
			: {
					kind: "reviewed-upper-bound",
					reviewedBy: "synthetic-test",
					evidenceDigest: "c".repeat(64),
				},
	})),
});
if (scenario === "expired") {
	authorization.expiresAt = "2000-01-01T00:00:00.000Z";
	await writeFile(
		join(directory, "authorization.json"),
		JSON.stringify(authorization),
	);
}
if (scenario === "cancelled") await cancelRequestBudget(directory);
const options = {
	origin: "live",
	budget: {
		directory,
		authorizationDigest: datasetDigest(authorization),
		managerModel,
		scope,
	},
	readyPath: join(root, "ready.json"),
	budgetReadyPath: join(root, "budget-ready.json"),
};
let requests = 0;
const intercepted = Object.assign(
	async (input: string | URL | Request) => {
		const request =
			input instanceof Request ? input : new Request(String(input));
		if (scenario.endsWith("manager-gate")) {
			assert.equal(
				request.url,
				managerModel === "xai/grok-4.6"
					? "https://api.x.ai/v1/chat/completions"
					: "https://chatgpt.com/backend-api/codex/responses",
			);
			const evidence = await reconcileRequestReservations(
				directory,
				options.budget.authorizationDigest,
				scope,
			);
			assert.deepEqual(
				evidence.claims.map((claim) => claim.model),
				[managerModel],
			);
			return Response.json({ ok: true });
		}
		assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
		requests++;
		const evidence = await reconcileRequestReservations(
			directory,
			options.budget.authorizationDigest,
			scope,
		);
		assert.equal(evidence.claims.length, requests);
		assert.equal(evidence.totalMicroUsd, requests * 3000);
		assert.equal(evidence.claims.at(-1)?.model, "typesafe/jev-1.13.0");
		assert.equal(
			request.headers.get("authorization"),
			"Bearer synthetic-live-key",
		);
		if (scenario === "transport-failure")
			throw new Error("intercepted transport failure");
		if (retryReplacedFetch && requests === 1) {
			assert.throws(() => {
				globalThis.fetch = intercepted as typeof fetch;
			});
			return new Response("retry", {
				status: 429,
				headers: { "retry-after": "0" },
			});
		}
		return Response.json({
			model: "jev-1.13.0",
			answers: {
				choice: {
					type: "choice",
					choice: "retry",
					probabilities: { retry: 1, abstain: 0 },
					confidence: 1,
				},
				goal_0: { type: "noul", noul: 1 },
				fit_0: { type: "noul", noul: 1 },
			},
			usage: { input_tokens: 1, output_tokens: 1 },
		});
	},
	{ preconnect() {} },
);
globalThis.fetch = intercepted as typeof fetch;
const originalWebSocket = globalThis.WebSocket;
const context = {
	options: {},
	session: { hook: async () => ({ dispose: async () => {} }) },
};
const setupLive = (options: unknown): Promise<unknown> =>
	Reflect.apply(LiveTreatmentPlugin.setup, undefined, [
		{ ...context, options },
	]);
const installBudget = (options: unknown): Promise<void> =>
	Reflect.apply(BudgetPlugin.install, undefined, [context, options]);
const gateOptions = {
	directory,
	authorizationDigest: options.budget.authorizationDigest,
	scope,
	readyPath: options.budgetReadyPath,
};
const expected = {
	...options.budget,
	origin: "live" as const,
};
assert.throws(() => BudgetPlugin.assertInstalledRequestGate(expected));
if (scenario === "forged-ready") {
	await writeFile(
		options.budgetReadyPath,
		JSON.stringify({
			pid: process.pid,
			origin: "live",
			authorizationDigest: options.budget.authorizationDigest,
			scopeDigest: datasetDigest(scope),
			scriptDigest: null,
		}),
	);
	assert.throws(() => BudgetPlugin.assertInstalledRequestGate(expected));
	await assert.rejects(setupLive(options));
	assert.throws(() => BudgetPlugin.assertInstalledRequestGate(expected));
	console.log(JSON.stringify({ scenario, managerModel, requests, ok: true }));
	process.exit(0);
}
if (scenario === "missing-key" || control) delete process.env.TYPESAFE_API_KEY;
if (scenario === "digest") options.budget.authorizationDigest = "d".repeat(64);
const invalid = [
	"simulation",
	"expired",
	"cancelled",
	"missing-jev",
	"control-with-jev",
	"wrong-manager",
	"other-manager",
	"missing-key",
	"digest",
	"missing-scope",
	"unknown-option",
	"script",
];
if (invalid.includes(scenario)) {
	const input = structuredClone(options) as Record<string, unknown>;
	if (scenario === "unknown-option") input.thresholds = {};
	if (scenario === "script")
		input.script = { kind: "guarded-reset-v1", outcome: "accepted" };
	if (scenario === "missing-scope")
		delete (input.budget as Record<string, unknown>).scope;
	await assert.rejects(setupLive(input));
	assert.equal(globalThis.fetch, intercepted);
	assert.equal(globalThis.WebSocket, originalWebSocket);
	assert.equal((await requestBudgetStatus(directory)).consumed, 0);
} else if (scenario === "failed-ready" || scenario === "pending-ready") {
	if (scenario === "failed-ready") {
		await writeFile(options.budgetReadyPath, "occupied");
		await assert.rejects(installBudget(gateOptions));
	} else {
		await writeFile(options.budgetReadyPath, "occupied");
		const results = await Promise.allSettled([
			installBudget(gateOptions),
			installBudget(gateOptions),
		]);
		assert(results.every((result) => result.status === "rejected"));
	}
	assert.notEqual(globalThis.fetch, intercepted);
	assert.throws(() => BudgetPlugin.assertInstalledRequestGate(expected));
	await assert.rejects(installBudget(gateOptions));
	await assert.rejects(fetch("https://unlisted.invalid/inference"));
} else if (
	scenario === "control-manager-gate" ||
	scenario === "treatment-manager-gate"
) {
	await installBudget(gateOptions);
	BudgetPlugin.assertInstalledRequestGate(expected);
	assert.throws(() => {
		globalThis.fetch = intercepted as typeof fetch;
	});
	assert.throws(() => {
		globalThis.WebSocket = originalWebSocket;
	});
	const route =
		managerModel === "xai/grok-4.6"
			? "https://api.x.ai/v1/chat/completions"
			: "https://chatgpt.com/backend-api/codex/responses";
	const response = await fetch(route, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model: managerModel.split("/")[1] }),
	});
	assert.deepEqual(await response.json(), { ok: true });
	assert.equal((await requestBudgetStatus(directory)).consumed, 1);
} else if (
	scenario === "gate-fetch" ||
	scenario === "gate-websocket" ||
	scenario === "gate-scope"
) {
	await installBudget(gateOptions);
	await installBudget(gateOptions);
	BudgetPlugin.assertInstalledRequestGate(expected);
	if (scenario === "gate-fetch")
		assert.throws(() => {
			globalThis.fetch = intercepted as typeof fetch;
		});
	if (scenario === "gate-websocket")
		assert.throws(() => {
			globalThis.WebSocket = originalWebSocket;
		});
	if (scenario === "gate-scope")
		options.budget.scope = { ...scope, executionId: randomUUID() };
	if (scenario === "gate-scope") {
		await assert.rejects(setupLive(options));
		await assert.rejects(
			installBudget({ ...gateOptions, scope: options.budget.scope }),
		);
	} else {
		BudgetPlugin.assertInstalledRequestGate(expected);
		await installBudget(gateOptions);
	}
} else {
	const fixture = await blockedFixture();
	if (scenario === "treatment-ready")
		await writeFile(options.readyPath, "occupied");
	if (scenario === "treatment-ready") {
		await assert.rejects(setupLive(options));
		BudgetPlugin.assertInstalledRequestGate(expected);
		await assert.rejects(fetch("https://unlisted.invalid/inference"));
	} else {
		const hooks = await setupLive(options);
		try {
			assert.equal(requests, 0);
			const ready = JSON.parse(await readFile(options.readyPath, "utf8"));
			assert.equal(ready.origin, "live");
			assert.equal(ready.arm, scope.arm);
			assert.equal(ready.scopeDigest, datasetDigest(scope));
			assert.equal(ready.qualification, "experimental-evaluation");
			if (control) {
				await assert.rejects(
					fetch("https://api.typesafe.ai/v1/systemone", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ model: "jev-1.13.0" }),
					}),
					/model not authorized/i,
				);
				assert.equal(requests, 0);
			}
			const mode = control ? "shadow" : "delegated";
			const recovery = capturedRecovery;
			if (!recovery)
				throw new Error(
					"Native composition did not receive recovery controller",
				);
			recovery.activate("host", {
				mode,
				maxCalls: retryReplacedFetch ? 2 : 1,
				maxUsd: 0.01,
			});
			recovery.observeMessage("host", "user", false);
			recovery.observeAssistant("host", "assistant", "user");
			if (scenario === "replaced-fetch")
				assert.throws(() => {
					globalThis.fetch = intercepted as typeof fetch;
				});
			if (scenario === "replaced-websocket")
				assert.throws(() => {
					globalThis.WebSocket = originalWebSocket;
				});
			const run = fixture.session.runs.at(-1);
			assert(run);
			const finding = run.reviews.at(-1)?.result?.findings[0]?.findingId;
			assert(finding);
			const advice = await recovery
				.guard({
					hostSessionId: "host",
					messageId: "assistant",
					agent: "build",
				})
				.propose(fixture.session, fixture.sourceDigest, {
					id: "proposal",
					sessionId: fixture.session.id,
					expectedRevision: fixture.session.revision,
					candidates: [
						{
							id: "retry",
							action: "retry",
							featureId: run.featureId,
							remedy: "Add null guard",
							changedFromPreviousAttempt: "Handle null",
							findingIds: [finding],
						},
					],
				});
			const result = JSON.stringify({ workflowData: { recovery: advice } });
			assert.equal(typeof result, "string");
			if (
				["accepted", "replaced-fetch", "replaced-websocket"].includes(scenario)
			) {
				assert.match(result as string, /recommended/);
				assert.equal(
					JSON.parse(result as string).workflowData.recovery.kind,
					"selected",
				);
				assert.equal(requests, 1);
			} else if (scenario === "transport-failure") {
				assert.equal(requests, 1);
				assert.match(result as string, /unavailable/);
			} else if (retryReplacedFetch) {
				assert.equal(requests, 2);
				assert.match(result as string, /recommended/);
				BudgetPlugin.assertInstalledRequestGate(expected);
			} else {
				assert.equal(requests, 0);
				assert.match(result as string, /unavailable/);
			}
			const reconciled = await reconcileRequestReservations(
				directory,
				options.budget.authorizationDigest,
				scope,
			);
			assert.equal(reconciled.totalMicroUsd, requests * 3000);
			if (requests) {
				await assert.rejects(
					fetch("https://api.typesafe.ai/v1/systemone", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ model: "jev-1.13.0" }),
					}),
					/budget exhausted/,
				);
				assert.equal(requests, retryReplacedFetch ? 2 : 1);
			}
		} finally {
			if (typeof hooks === "function")
				await Reflect.apply(hooks, undefined, []);
		}
	}
}
for (const name of [
	...(await readdir(directory, { recursive: true })).map(
		(name) => `budget/${name}`,
	),
	...(await readdir(workspace, { recursive: true })).map(
		(name) => `workspace/${name}`,
	),
	...(await readdir(root)).filter((name) => name.endsWith(".json")),
]) {
	try {
		assert(
			!String(await readFile(join(root, name))).includes("synthetic-live-key"),
		);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EISDIR"))
			throw error;
	}
}
console.log(JSON.stringify({ scenario, managerModel, requests, ok: true }));

process.exit(0);
