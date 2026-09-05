// Explicitly fake host/artifact/scenario-check boundaries, subprocess-local only.
// Canonical release policy, scheduler, reserve derivation, retained failure
// derivation, cassettes, report store and runCampaign are NOT mocked.
import { mock } from "bun:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withCampaignSignals } from "../../evals/campaign-stop.js";
import { providerFailure } from "../../evals/failure-origin.js";
import type { Outcome } from "../../evals/harness.js";

const [root, mode] = process.argv.slice(2);
if (!root || (mode !== "handoff" && mode !== "reserve"))
	throw new Error("Expected temporary root and handoff/reserve mode.");
const repositoryRoot = root;
const models = ["fixture-a/model", "fixture-b/model"] as const;
const event = (name: string) =>
	process.stdout.write(`\n@@eval-reserve:${name}\n`);
process.stdin.resume(); // Keep the child alive until the parent releases cleanup.
globalThis.fetch = Object.assign(
	() => {
		event("unexpected-network");
		throw new Error("Network forbidden in the reserve cancellation fixture.");
	},
	{ preconnect: fetch.preconnect },
);
const realHarness = { ...(await import("../../evals/harness.js")) };
const realProvenance = { ...(await import("../../evals/provenance.js")) };
const realPolicy = { ...(await import("../../evals/release-policy.js")) };
const realScenarios = { ...(await import("../../evals/scenarios.js")) };
// runCampaign hashes the real grader dependency closure relative to its output
// root. Copy those exact source bytes; do not substitute a fake grader bundle.
for (const { path, source } of realPolicy.releaseGraderSourceBundle(
	join(import.meta.dir, "../.."),
).files) {
	const target = join(root, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, source);
}

function interrupted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) reject(signal.reason);
		else
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
	});
}

async function stopHere(signal: AbortSignal, expectedDurable: number) {
	const results = join(repositoryRoot, "evals", "results");
	const name = (await readdir(results)).find((entry) => entry.endsWith(".v2"));
	if (!name) throw new Error("Real report store is missing.");
	const count = (await readdir(join(results, name, "attempts"))).length;
	if (count !== expectedDurable)
		throw new Error(
			`Expected ${expectedDurable} durable attempts, got ${count}.`,
		);
	const stopped = interrupted(signal);
	event(`durable:${count}`);
	event("ready"); // Listener and durable-prefix assertion precede the OS signal.
	return stopped;
}

async function cleanupGate() {
	const release = new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
	});
	event("cleanup-wait");
	await release;
}

let started = 0;
class FakeReleaseHost {
	readonly project = join(repositoryRoot, "explicitly-fake-project");
	readonly signal: AbortSignal;
	readonly attempt: number;
	constructor(signal: AbortSignal, attempt: number) {
		this.signal = signal;
		this.attempt = attempt;
	}
	static async start(options: {
		files: Readonly<Record<string, string>>;
		signal?: AbortSignal;
	}) {
		if (!options.signal) throw new Error("Runner omitted its signal.");
		const preflight = options.files["package.json"]?.includes('"preflight"');
		const host = new FakeReleaseHost(options.signal, preflight ? 0 : ++started);
		event(`start:${host.attempt}`);
		return host;
	}
	async catalogModels() {
		return models;
	}
	async probeModel() {
		return null;
	}
	async createSession() {
		return `fixture-session-${this.attempt}`;
	}
	async runCommand(): Promise<"quiet"> {
		if (mode === "reserve" && this.attempt === 78)
			await stopHere(this.signal, 77);
		return "quiet";
	}
	async outcome(sessionIds: string[]): Promise<Outcome> {
		event(`outcome:${this.attempt}`);
		// One eligible gap in each of the first three canonical case/provider
		// strata: three reserves really activate, leaving a third queued behind
		// the interrupted second reserve. No outcome/ledger retry flags are patched.
		const gap = [1, 4, 7].includes(this.attempt);
		const observation = gap
			? {
					sessionId: sessionIds[0] ?? "missing-session",
					name: "FixtureProviderUnavailable",
					message: "Explicitly fake provider outage for reserve scheduling.",
				}
			: null;
		return {
			flowCalls: [],
			allCalls: [],
			actors: [
				{
					role: "manager",
					sessionIds,
					actualModel: { kind: "unobserved", reason: "field-unavailable" },
				},
			],
			guidanceLoads: [],
			session: null,
			archives: [],
			finalText: "Explicitly fake scenario success; not release evidence.",
			tokens: {
				input: 0,
				output: 0,
				reasoning: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			costUsd: 0,
			assistantMessages: 1,
			durationMs: 1,
			providerError: observation ? providerFailure(observation.message) : null,
			providerErrorObservation: observation,
		};
	}
	async stop() {
		event(`stop:${this.attempt}`);
		if (mode === "handoff" && this.attempt === 76)
			await stopHere(this.signal, 76).catch((error: unknown) => {
				if (error !== this.signal.reason) throw error;
			});
		if (this.signal.aborted) await cleanupGate();
		event(`cleaned:${this.attempt}`);
	}
}

mock.module("../../evals/harness.js", () => ({
	...realHarness,
	EvalHost: FakeReleaseHost,
	packPlugin: async (_repo: string, directory: string) => {
		const path = join(directory, "explicitly-fake-artifact.tgz");
		await writeFile(
			path,
			"Cancellation fixture only; not a release artifact.\n",
		);
		return path;
	},
	preparePackageCache: async (_tarball: string, directory: string) => directory,
}));
mock.module("../../evals/provenance.js", () => ({
	...realProvenance,
	inspectArtifact: async ({ tarballPath }: { tarballPath: string }) => ({
		packageVersion: "0.0.0-fixture",
		sourceCommit: "explicitly-fake-reserve-cancellation",
		sourceTreeSha256: `sha256:${"a".repeat(64)}`,
		tarballSha256: await realProvenance.tarballSha256(tarballPath),
		unpackedManifestSha256: `sha256:${"b".repeat(64)}`,
	}),
}));
mock.module("../../evals/scenarios.js", () => ({
	...realScenarios,
	// Preserve canonical cases, order, files and steps. Only the product oracle
	// accepts the fake host outcome; this test makes no product-quality claim.
	SCENARIOS: realScenarios.SCENARIOS.map((scenario) => ({
		...scenario,
		check: () => [],
	})),
}));
if (process.platform === "darwin")
	mock.module("../../evals/release-policy.js", () => ({
		...realPolicy,
		assertReleaseHost: () => {}, // Local simulation, NOT Linux qualification.
	}));

const { runCampaign } = await import("../../evals/run.js");
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
					[
						"--release",
						"--model",
						models[0],
						"--model",
						models[1],
						"--concurrency",
						"1",
					],
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
	console.error(error);
	process.exitCode = 1;
} finally {
	process.stdin.pause();
}
