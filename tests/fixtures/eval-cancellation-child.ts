// Only this subprocess replaces paid/external boundaries. The scheduler, scenario
// checks, retained evidence, cassette recorder and report store stay real.
import { mock } from "bun:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withCampaignSignals } from "../../evals/campaign-stop.js";
import { providerFailure } from "../../evals/failure-origin.js";
import type { CommandEnd, EvalHost, Outcome } from "../../evals/harness.js";

const [root, mode] = process.argv.slice(2);
if (!root || !mode)
	throw new Error("Expected temporary root and fixture mode.");
const repositoryRoot = root;
const models = ["fixture/model-a", "fixture/model-b"];
let elapsedOffset = 0;
if (mode === "budget-stop") {
	const RealDate = Date;
	class ControlledDate extends RealDate {
		constructor(value?: string | number) {
			super(value ?? RealDate.now() + elapsedOffset);
		}
		static override now() {
			return RealDate.now() + elapsedOffset;
		}
	}
	globalThis.Date = ControlledDate as unknown as DateConstructor;
}
const event = (name: string) =>
	process.stdout.write(`\n@@eval-cancellation:${name}\n`);
// A pending Promise / signal listener alone need not keep Bun's event loop alive.
// The parent owns this pipe and writes only after the cleanup handshake.
process.stdin.resume();

// Defence in depth: no inherited credentials, real host, package installation,
// artifact inspection subprocess, or fetch is needed by this fixture.
globalThis.fetch = Object.assign(
	() => {
		event("unexpected-network");
		throw new Error("Network is forbidden in the cancellation fixture.");
	},
	{ preconnect: fetch.preconnect },
);
const realHarness = { ...(await import("../../evals/harness.js")) };
const realProvenance = { ...(await import("../../evals/provenance.js")) };
const realStore = { ...(await import("../../evals/report-store.js")) };
const realFS = { ...(await import("node:fs/promises")) };
let publishing = false;
let signalledPublication = false;

function interrupted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) reject(signal.reason);
		else
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
	});
}

async function stopHere(signal: AbortSignal): Promise<never> {
	const stopped = interrupted(signal);
	event("ready"); // Abort listener installed before the parent sends a signal.
	return stopped;
}

async function cleanupGate(): Promise<void> {
	const release = new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
	});
	event("cleanup-wait");
	await release;
}

async function publicationGate(): Promise<void> {
	if (signalledPublication) return;
	signalledPublication = true;
	const signal = new Promise<void>((resolve) => {
		process.once("SIGINT", () => resolve());
		process.once("SIGTERM", () => resolve());
	});
	event("ready");
	await signal;
	await cleanupGate();
}

function plannedOutcome(sessionId: string): Outcome {
	const flowCalls = ["flow_guidance", "flow_plan_save"].map((tool) => ({
		tool,
		status: "completed" as const,
		sessionIndex: 0,
		agent: "build",
		input: tool === "flow_guidance" ? { id: "flow-plan" } : {},
		output: null,
		rawOutput: "",
		metadata: {},
	}));
	return {
		flowCalls,
		allCalls: flowCalls,
		actors: [
			{
				role: "manager",
				sessionIds: [sessionId],
				actualModel: { kind: "unobserved", reason: "field-unavailable" },
			},
		],
		guidanceLoads: [],
		// Same narrowed Session v5 shape used by eval-scenario-checks.test.ts.
		session: {
			version: 5,
			goal: "Add farewell(name) to src/greet.ts.",
			approval: "pending",
			plan: {
				features: [{ id: "farewell", title: "Add farewell" }],
				evidence: [{ scope: "gate", command: "bun test" }],
			},
			runs: [],
			closure: null,
		},
		archives: [],
		finalText: "Fixture plan saved; awaiting approval.",
		tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
		costUsd: 0,
		assistantMessages: 1,
		durationMs: 1,
		providerError: null,
	};
}

let attemptsStarted = 0;
class FakeEvalHost {
	readonly project = join(repositoryRoot, "fake-project");
	readonly signal: AbortSignal;
	readonly attempt: number;
	private pollHost: EvalHost | null = null;
	private restoreFetch: (() => void) | null = null;
	constructor(signal: AbortSignal, attempt: number) {
		this.signal = signal;
		this.attempt = attempt;
	}

	static async start(options: {
		files: Readonly<Record<string, string>>;
		signal?: AbortSignal;
	}): Promise<FakeEvalHost> {
		if (!options.signal) throw new Error("Runner did not pass its signal.");
		const preflight = options.files["package.json"]?.includes('"preflight"');
		const host = new FakeEvalHost(
			options.signal,
			preflight ? 0 : ++attemptsStarted,
		);
		event(`start:${host.attempt}`);
		if (
			((mode === "host" || mode === "host-cleanup-failure") &&
				host.attempt === 2) ||
			(mode === "preflight-host-cleanup-failure" && preflight)
		) {
			try {
				await stopHere(host.signal);
			} finally {
				// Startup owns its partially constructed host, just like EvalHost.start.
				await host.stop();
			}
		}
		return host;
	}

	async catalogModels(): Promise<string[]> {
		return models;
	}
	async probeModel(model: string): Promise<null> {
		event(`probe:${model}`);
		if (mode === "preflight") await stopHere(this.signal);
		return null;
	}
	async createSession(): Promise<string> {
		event(`session:${this.attempt}`);
		return `fixture-session-${this.attempt}`;
	}
	async runCommand(
		sessionId: string,
		command: string,
		args: string,
		model: string,
	): Promise<CommandEnd> {
		event(`command:${this.attempt}`);
		if (mode?.startsWith("provider-poll-") && this.attempt === 2) {
			this.pollHost = Reflect.construct(realHarness.EvalHost, [
				this.project,
				this.project,
				this.signal,
			]) as EvalHost;
			Object.assign(this.pollHost, { baseUrl: "http://fixture" });
			const originalFetch = globalThis.fetch;
			this.restoreFetch = () => {
				globalThis.fetch = originalFetch;
			};
			globalThis.fetch = Object.assign(
				async (input: string | URL | Request) => {
					const url = String(input);
					if (!url.startsWith("http://fixture/"))
						throw new Error("Unexpected fixture request");
					if (url.endsWith("/command")) return Response.json({});
					if (url.endsWith("/message")) {
						event("actual-progress-poll");
						return Response.json([
							{
								info: {
									id: "message",
									role: "assistant",
									sessionID: sessionId,
									time: { created: 1, completed: 2 },
									error: {
										name: "FixtureProviderUnavailable",
										data: { message: "Fake polled provider failure" },
									},
								},
								parts: [],
							},
						]);
					}
					if (url.endsWith("/abort")) {
						event("actual-provider-abort");
						if (mode === "provider-poll-stop") return stopHere(this.signal);
						return Response.json(true);
					}
					event("unexpected-enrichment");
					throw new Error(
						"Polled provider evidence must not depend on another host read",
					);
				},
				{ preconnect: originalFetch.preconnect },
			);
			return this.pollHost.runCommand(sessionId, command, args, model);
		}
		if (mode === "budget-stop" && this.attempt === 2)
			elapsedOffset = 24 * 60 * 60_000;
		if (
			this.attempt === 2 &&
			mode !== "complete" &&
			mode !== "provider-outcome-stop" &&
			mode !== "provider-transcript-stop"
		)
			await stopHere(this.signal);
		return "quiet";
	}
	async outcome(sessionIds: string[]): Promise<Outcome> {
		event(`outcome:${this.attempt}`);
		if (this.pollHost) {
			if (mode === "provider-poll-outcome-stop")
				await stopHere(this.signal).catch((error) => {
					if (error !== this.signal.reason) throw error;
				});
			return this.pollHost.outcome(sessionIds, 1, this.signal);
		}
		if (mode === "provider-transcript-stop" && this.attempt === 2) {
			const host = Reflect.construct(realHarness.EvalHost, [
				this.project,
				this.project,
			]) as EvalHost;
			Object.assign(host, { baseUrl: "http://fixture" });
			const parent = sessionIds[0] ?? "id";
			const originalFetch = globalThis.fetch;
			globalThis.fetch = Object.assign(
				async (input: string | URL | Request) => {
					const url = String(input);
					if (!url.startsWith("http://fixture/"))
						throw new Error("Unexpected fixture request");
					if (url.endsWith(`/session/${parent}/children`))
						return Response.json([{ id: "reviewer", parentID: parent }]);
					if (url.endsWith("/children")) return Response.json([]);
					if (url.endsWith(`/session/${parent}/message`))
						return Response.json([
							{
								info: {
									id: "message",
									role: "assistant",
									sessionID: parent,
									time: { created: 1, completed: 2 },
									error: {
										name: "FixtureProviderUnavailable",
										data: { message: "Fake earlier provider failure" },
									},
								},
								parts: [],
							},
						]);
					if (url.endsWith("/session/reviewer/message"))
						return stopHere(this.signal);
					throw new Error("Unexpected fixture endpoint");
				},
				{ preconnect: originalFetch.preconnect },
			);
			try {
				return await host.outcome(sessionIds, 1, this.signal);
			} finally {
				globalThis.fetch = originalFetch;
			}
		}
		if (mode === "provider-outcome-stop" && this.attempt === 2) {
			const observation = {
				sessionId: sessionIds[0] ?? "id",
				name: "FixtureProviderUnavailable",
				message: "Fake observed provider failure",
			};
			const failure = providerFailure(observation.message);
			await stopHere(this.signal).catch((error) => {
				if (error !== this.signal.reason) throw error;
			});
			return {
				...plannedOutcome(observation.sessionId),
				providerError: failure,
				providerErrorObservation: observation,
			};
		}
		return plannedOutcome(sessionIds[0] ?? "fixture-session");
	}
	async stop(): Promise<void> {
		event(`stop:${this.attempt}`);
		if (this.pollHost) await this.pollHost.stop();
		this.restoreFetch?.();
		if (mode === "last-cleanup" && this.attempt === 1) {
			const stopped = interrupted(this.signal).catch(() => {});
			event("ready");
			await stopped;
			await cleanupGate();
		} else if (this.signal.aborted) {
			await cleanupGate();
			if (
				mode === "cleanup-failure" ||
				mode === "host-cleanup-failure" ||
				mode === "preflight-host-cleanup-failure"
			) {
				event("injected-cleanup-failure");
				throw new Error("Injected host cleanup failure.");
			}
			if (mode === "persistence-failure") {
				const results = join(repositoryRoot, "evals", "results");
				const directory = (await readdir(results)).find((name) =>
					name.endsWith(".v2"),
				);
				if (!directory)
					throw new Error("Real report store was not initialized.");
				// A real filesystem conflict, not a fake reportStore implementation.
				await mkdir(join(results, directory, "completion.json"));
				event("injected-persistence-failure");
			}
		}
		event(`cleaned:${this.attempt}`);
	}
}

mock.module("../../evals/harness.js", () => ({
	...realHarness,
	EvalHost: FakeEvalHost,
	packPlugin: async (_repo: string, packDirectory: string) => {
		const path = join(packDirectory, "explicitly-fake-artifact.tgz");
		await writeFile(
			path,
			"not a release artifact; cancellation fixture only\n",
		);
		return path;
	},
	preparePackageCache: async (_tarball: string, packDirectory: string) =>
		packDirectory,
}));
mock.module("../../evals/provenance.js", () => ({
	...realProvenance,
	// Fake external artifact boundary only; digesting and copying its bytes stay real.
	inspectArtifact: async ({ tarballPath }: { tarballPath: string }) => ({
		packageVersion: "0.0.0-fixture",
		sourceCommit: "explicitly-fake-cancellation-fixture",
		sourceTreeSha256: `sha256:${"a".repeat(64)}`,
		tarballSha256: await realProvenance.tarballSha256(tarballPath),
		unpackedManifestSha256: `sha256:${"b".repeat(64)}`,
	}),
}));

mock.module("../../evals/report-store.js", () => ({
	...realStore,
	createReportStore: (
		options: Parameters<typeof realStore.createReportStore>[0],
	) => {
		const store = realStore.createReportStore({
			...options,
			hooks: {
				checkpoint: async (stage) => {
					if (
						publishing &&
						mode === "finalize-write" &&
						stage === "after-file-sync"
					)
						await publicationGate();
				},
			},
		});
		const finalize = store.finalize.bind(store);
		store.finalize = async (input) => {
			publishing = true;
			if (mode === "finalize-read") await publicationGate();
			return finalize(input);
		};
		return store;
	},
}));
mock.module("node:fs/promises", () => ({
	...realFS,
	writeFile: async (...args: Parameters<typeof realFS.writeFile>) => {
		const path = String(args[0]);
		if (
			publishing &&
			((mode === "legacy-write" && path.endsWith(".json")) ||
				(mode === "cassette-write" && path.includes(".cassettes")))
		)
			await publicationGate();
		return realFS.writeFile(...args);
	},
}));

const { runCampaign } = await import("../../evals/run.js");
const args = [
	"--model",
	models[0] ?? "fixture/model-a",
	...(mode === "preflight" ? ["--model", models[1] ?? "fixture/model-b"] : []),
	"--scenario",
	"plan-only-stops",
	"--repeat",
	mode === "last-cleanup" ||
	mode === "complete" ||
	mode.endsWith("-write") ||
	mode === "finalize-read"
		? "1"
		: "3",
	"--concurrency",
	"1",
];
const observedInt = () => event("signal:SIGINT");
const observedTerm = () => event("signal:SIGTERM");
try {
	process.exitCode = await withCampaignSignals(
		async (signal, beginFinalization) => {
			process.on("SIGINT", observedInt);
			process.on("SIGTERM", observedTerm);
			try {
				const code = await runCampaign(
					signal,
					args,
					repositoryRoot,
					beginFinalization,
				);
				event("returned");
				return code;
			} finally {
				process.removeListener("SIGINT", observedInt);
				process.removeListener("SIGTERM", observedTerm);
			}
		},
	);
} catch (error) {
	event("error");
	console.error(error);
	process.exitCode = 1;
} finally {
	process.stdin.pause();
}
