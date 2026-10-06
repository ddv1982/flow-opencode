import { mock, spyOn } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Outcome } from "../../evals/harness.js";
import {
	HostAbortObservationSchema,
	HostTraceSchema,
} from "../../evals/host-trace.js";

const rootInput = process.argv[2];
if (!rootInput) throw new Error("Expected isolated fixture root.");
const root = rootInput;
const model = "openai/gpt-6.1-sol";
const sessionId = "ses_fallbackmanager";
let now = 1_000_000;
let startedAt = now;
let auxiliaryThrows = 0;
const clock = spyOn(Date, "now").mockImplementation(() => now);
globalThis.fetch = Object.assign(
	() => {
		throw new Error(
			"Network forbidden in the explicitly fake fallback fixture.",
		);
	},
	{ preconnect: fetch.preconnect },
);
const harness = { ...(await import("../../evals/harness.js")) };
const provenance = { ...(await import("../../evals/provenance.js")) };
const cassette = { ...(await import("../../evals/cassette.js")) };

class FixtureHost {
	readonly project = join(root, "explicitly-fake-project");
	static async start() {
		return new FixtureHost();
	}
	async catalogModels() {
		return [model];
	}
	async probeModel() {
		return null;
	}
	async createSession() {
		return sessionId;
	}
	async runCommand(): Promise<never> {
		startedAt = now;
		now += 182_000;
		throw new Error(
			"Explicitly fake watchdog abort after 180 seconds of observed silence.",
		);
	}
	async outcome(): Promise<Outcome> {
		const input = {
			subagent_type: "flow-reviewer",
			prompt: `Inspect ${sessionId} in ${this.project}.`,
		};
		const native = {
			sessionId,
			messageId: "msg_fallback",
			partId: "prt_fallback",
			partIndex: 0,
			callId: "call_fallback",
			startedAt: startedAt + 2,
			completedAt: now,
		};
		const hostTrace = HostTraceSchema.parse({
			version: 1,
			kind: "observed",
			runnerRootSessionIds: [sessionId],
			sessions: [
				{ id: sessionId, parentId: null, agent: "build", projectMatched: true },
			],
			messages: [
				{
					id: "msg_fallbackuser",
					sessionId,
					order: 0,
					created: startedAt,
					role: "user",
					parts: [
						{
							id: "prt_fallbackuser",
							partIndex: 0,
							type: "text",
							synthetic: false,
							textBytes: 7,
							flowTokenSha256: null,
							compactionContinue: null,
							automaticCompaction: null,
						},
					],
				},
				{
					id: "msg_fallback",
					sessionId,
					order: 1,
					created: startedAt + 1,
					role: "assistant",
					parentId: "msg_fallbackuser",
					agent: "build",
					summary: false,
					tools: [{ ...native, tool: "task", status: "error" }],
				},
			],
			compactionDelivery: "unavailable-from-message-export",
		});
		const abortObservation = HostAbortObservationSchema.parse({
			rootSessionId: sessionId,
			startedAt,
			excludedMs: 0,
			observedAt: now,
			abortRequestedAt: now,
			trigger: {
				kind: "stall",
				unchangedMs: 180_000,
				lastActivityAt: startedAt + 2_000,
				thresholdMs: 180_000,
			},
			pending: [
				{
					native: { ...native, completedAt: null },
					tool: "task",
					status: "running",
					input,
				},
			],
		});
		return {
			hostTrace,
			abortObservation,
			allCalls: [
				{
					native,
					tool: "task",
					status: "error",
					sessionIndex: 0,
					agent: "build",
					input,
					output: "Task cancelled",
					rawOutput: "Task cancelled",
					metadata: {},
				},
			],
			flowCalls: [],
			actors: [
				{
					role: "manager",
					sessionIds: [sessionId],
					actualModel: {
						kind: "observed",
						value: { providerID: "openai", modelID: "gpt-6.1-sol" },
					},
				},
			],
			guidanceLoads: [],
			session: null,
			archives: [],
			finalText: "",
			tokens: {
				input: 0,
				output: 1,
				reasoning: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			costUsd: null,
			assistantMessages: 1,
			durationMs: now - startedAt,
			providerError: null,
		};
	}
	async stop() {}
}
mock.module("../../evals/harness.js", () => ({
	...harness,
	EvalHost: FixtureHost,
	packPlugin: async (_repository: string, directory: string) => {
		const path = join(directory, "explicitly-fake-artifact.tgz");
		await writeFile(
			path,
			"Provider-free fallback fixture; not a release artifact.\n",
		);
		return path;
	},
	preparePackageCache: async (_tarball: string, directory: string) => directory,
}));
mock.module("../../evals/provenance.js", () => ({
	...provenance,
	inspectArtifact: async ({ tarballPath }: { tarballPath: string }) => ({
		packageVersion: "0.0.0-fixture",
		sourceCommit: "explicitly-fake-fallback",
		sourceTreeSha256: `sha256:${"a".repeat(64)}`,
		tarballSha256: await provenance.tarballSha256(tarballPath),
		unpackedManifestSha256: `sha256:${"b".repeat(64)}`,
	}),
}));
mock.module("../../evals/cassette.js", () => ({
	...cassette,
	buildCassette: () => {
		auxiliaryThrows++;
		throw new Error("Explicitly fake auxiliary cassette construction failure.");
	},
}));
try {
	await mkdir(root, { recursive: true });
	const { runCampaign } = await import("../../evals/run.js");
	const code = await runCampaign(
		new AbortController().signal,
		[
			"--scenario",
			"happy-path",
			"--repeat",
			"1",
			"--model",
			model,
			"--concurrency",
			"1",
		],
		root,
	);
	await writeFile(
		join(root, "fixture-result.json"),
		JSON.stringify({ code, auxiliaryThrows, elapsedMs: now - 1_000_000 }),
	);
} finally {
	clock.mockRestore();
}
