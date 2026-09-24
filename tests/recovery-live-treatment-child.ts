import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Plugin, ToolContext } from "@opencode-ai/plugin";
import BudgetPlugin from "../evals/recovery-decisions/budget-plugin.js";
import LiveTreatmentPlugin from "../evals/recovery-decisions/live-treatment-plugin.js";
import {
	cancelRequestBudget,
	createRequestBudget,
	type EpisodeReservationScope,
	reconcileRequestReservations,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import { frozenCampaignFixture } from "./recovery-campaign-support.js";

const root = process.argv[2];
const scenario = process.argv[3];
assert(root && scenario);
const managerModel =
	process.argv[4] === "xai" ? "xai/grok-4.6" : "openai/gpt-5.6-terra";
const control = scenario === "control" || scenario === "control-with-jev";
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
	scenario === "control" || scenario === "missing-jev"
		? [managerModel]
		: scenario === "wrong-manager"
			? [
					managerModel === "xai/grok-4.6"
						? "openai/gpt-5.6-terra"
						: "xai/grok-4.6",
					"typesafe/jev-1.13.0",
				]
			: scenario === "other-manager"
				? ["openai/gpt-5.6-terra", "xai/grok-4.6", "typesafe/jev-1.13.0"]
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
		assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
		requests++;
		const evidence = await reconcileRequestReservations(
			directory,
			options.budget.authorizationDigest,
			scope,
		);
		assert.equal(evidence.claims.length, 1);
		assert.equal(evidence.totalMicroUsd, 3000);
		assert.equal(evidence.claims[0]?.model, "typesafe/jev-1.13.0");
		assert.equal(
			request.headers.get("authorization"),
			"Bearer synthetic-live-key",
		);
		if (scenario === "transport-failure")
			throw new Error("intercepted transport failure");
		if (retryReplacedFetch && requests === 1) {
			globalThis.fetch = intercepted as typeof fetch;
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
	directory: workspace,
	worktree: workspace,
	project: {},
	serverUrl: new URL("http://localhost:43210"),
	$: {},
	experimental_workspace: { register() {} },
	client: {
		app: { log() {} },
		session: { message: async () => ({ data: undefined }) },
	},
} as unknown as Parameters<Plugin>[0];
const gateOptions = {
	directory,
	authorizationDigest: options.budget.authorizationDigest,
	scope,
	readyPath: options.budgetReadyPath,
};
const expected = {
	...options.budget,
	origin: "live" as const,
	controlOrigin: context.serverUrl.origin,
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
	await assert.rejects(LiveTreatmentPlugin(context, options));
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
	await assert.rejects(LiveTreatmentPlugin(context, input));
	assert.equal(globalThis.fetch, intercepted);
	assert.equal(globalThis.WebSocket, originalWebSocket);
	assert.equal((await requestBudgetStatus(directory)).consumed, 0);
} else if (scenario === "failed-ready" || scenario === "pending-ready") {
	if (scenario === "failed-ready") {
		await writeFile(options.budgetReadyPath, "occupied");
		await assert.rejects(BudgetPlugin(context, gateOptions));
	} else {
		await writeFile(options.budgetReadyPath, "occupied");
		const results = await Promise.allSettled([
			BudgetPlugin(context, gateOptions),
			BudgetPlugin(context, gateOptions),
		]);
		assert(results.every((result) => result.status === "rejected"));
	}
	assert.notEqual(globalThis.fetch, intercepted);
	assert.throws(() => BudgetPlugin.assertInstalledRequestGate(expected));
	await assert.rejects(BudgetPlugin(context, gateOptions));
	await assert.rejects(fetch("https://unlisted.invalid/inference"));
} else if (
	scenario === "gate-fetch" ||
	scenario === "gate-websocket" ||
	scenario === "gate-scope"
) {
	await BudgetPlugin(context, gateOptions);
	await BudgetPlugin(context, gateOptions);
	BudgetPlugin.assertInstalledRequestGate(expected);
	if (scenario === "gate-fetch") globalThis.fetch = intercepted as typeof fetch;
	if (scenario === "gate-websocket") globalThis.WebSocket = originalWebSocket;
	if (scenario === "gate-scope")
		options.budget.scope = { ...scope, executionId: randomUUID() };
	await assert.rejects(LiveTreatmentPlugin(context, options));
	await assert.rejects(
		BudgetPlugin(context, { ...gateOptions, scope: options.budget.scope }),
	);
} else {
	const fixture = await frozenCampaignFixture();
	for (const [name, bytes] of Object.entries(fixture.fixture.files)) {
		await mkdir(dirname(join(workspace, name)), { recursive: true });
		await writeFile(join(workspace, name), bytes);
	}
	for (const args of [
		["init", "--initial-branch=main"],
		["add", "."],
	])
		assert.equal(Bun.spawnSync(["git", "-C", workspace, ...args]).exitCode, 0);
	if (scenario === "treatment-ready")
		await writeFile(options.readyPath, "occupied");
	if (scenario === "treatment-ready") {
		await assert.rejects(LiveTreatmentPlugin(context, options));
		BudgetPlugin.assertInstalledRequestGate(expected);
		await assert.rejects(fetch("https://unlisted.invalid/inference"));
	} else {
		const hooks = await LiveTreatmentPlugin(context, options);
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
			await hooks["command.execute.before"]?.(
				{
					command: "flow-auto",
					sessionID: "host",
					arguments: `--recovery=${mode} --recovery-calls=${retryReplacedFetch ? 2 : 1} --recovery-usd=0.01`,
				},
				{ parts: [{ type: "text", text: "Flow", synthetic: true } as never] },
			);
			await hooks["chat.message"]?.(
				{ sessionID: "host" },
				{
					message: {
						id: "user",
						agent: "build",
						model: {
							providerID: managerModel.split("/")[0],
							modelID: managerModel.split("/")[1],
						},
					} as never,
					parts: [{ type: "text", text: "Continue" } as never],
				},
			);
			await hooks.event?.({
				event: {
					type: "message.updated",
					properties: {
						info: {
							id: "assistant",
							sessionID: "host",
							role: "assistant",
							parentID: "user",
						},
					},
				} as never,
			});
			if (scenario === "replaced-fetch")
				globalThis.fetch = intercepted as typeof fetch;
			if (scenario === "replaced-websocket")
				globalThis.WebSocket = originalWebSocket;
			const run = fixture.session.runs.at(-1);
			assert(run);
			const finding = run.reviews.at(-1)?.result?.findings[0]?.findingId;
			assert(finding);
			const result = await hooks.tool?.flow_status?.execute(
				{
					request: { view: "compact" },
					recoveryProposal: {
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
					},
				},
				{
					directory: workspace,
					worktree: workspace,
					sessionID: "host",
					messageID: "assistant",
					agent: "build",
					abort: new AbortController().signal,
					metadata() {},
					async ask() {},
				} as ToolContext,
			);
			assert.equal(typeof result, "string");
			if (scenario === "accepted") {
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
				assert.equal(requests, 1);
				assert.match(result as string, /unavailable/);
				assert.throws(() => BudgetPlugin.assertInstalledRequestGate(expected));
			} else {
				assert.equal(requests, 0);
				assert.match(result as string, /unavailable/);
			}
			const reconciled = await reconcileRequestReservations(
				directory,
				options.budget.authorizationDigest,
				scope,
			);
			assert.equal(reconciled.totalMicroUsd, requests ? 3000 : 0);
			if (requests && !retryReplacedFetch) {
				await assert.rejects(
					fetch("https://api.typesafe.ai/v1/systemone", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ model: "jev-1.13.0" }),
					}),
					/budget exhausted/,
				);
				assert.equal(requests, 1);
			}
		} finally {
			await hooks.dispose?.();
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
