import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BenchmarkCase } from "../evals/benchmark.js";
import {
	attemptFailure,
	EvaluationPhaseError,
} from "../evals/failure-origin.js";
import { type Outcome, splitModel } from "../evals/harness.js";
import {
	packedPackageManifest,
	tarballSha256,
	unpackedManifestSha256,
} from "../evals/provenance.js";
import type { ModelIdentity } from "../evals/report.js";
import type { StudyManifest } from "../evals/study-manifest.js";
import type { StudyTransport } from "../evals/study-runner.js";
import { normalizeStudyUsage } from "../evals/study-usage.js";

export const studyModel: ModelIdentity = {
	routeProvider: "fixture",
	model: "manager",
	family: "fixture",
	gateway: null,
	revision: null,
};
export const studyCase: BenchmarkCase = {
	id: "study-value",
	caseVersion: 1,
	description: "A local runner fixture.",
	files: {
		"package.json": '{"name":"study-value","type":"module"}\n',
		"value.ts": "export function value(input: number) { return input + 1; }\n",
	},
	prompt: "Ensure value returns the next integer.",
	probes: [
		{
			id: "next",
			module: "value.ts",
			exportName: "value",
			args: [4],
			expected: { kind: "return", value: 5 },
		},
	],
	oracle: {
		schemaVersion: 1,
		contamination: { schemaVersion: 1, public: [], withheld: [] },
		knownBadMutations: [],
	},
	grade: async () => {
		throw new Error("Runner must use retained grading.");
	},
};

export function studyManifest(): StudyManifest {
	const arm = {
		artifact: { kind: "ordinary-opencode" as const },
		manager: studyModel,
		reviewer: null,
	};
	return {
		schemaVersion: 1,
		purpose: "exploratory",
		comparison: "total-effect",
		method: "equal-task-cluster-bootstrap-v1",
		opencodeVersion: "1.18.6",
		arms: { baseline: structuredClone(arm), candidate: structuredClone(arm) },
		cases: [{ caseId: studyCase.id, caseVersion: 1 }],
		repetitions: 1,
		reservePairsPerBlock: 1,
		seed: "study-test-seed",
		budget: {
			maxUsd: null,
			unknownCostPolicy: "token-wall-clock-bounds",
			maxWallClockMs: 120000,
			maxAttempts: 4,
		},
		accounting: {
			schemaVersion: 1,
			hostContract: "opencode-1.18.6-disjoint-output-v1",
			maxGeneratedOutputTokens: 10000,
			estimate: {
				generatedOutputTokensPerAttempt: 10,
				wallClockMsPerAttempt: 10,
				costUsdPerAttempt: null,
				basis: "Synthetic local test.",
			},
			preflight: { kind: "none" },
		},
	};
}

export async function studyArtifact(
	directory: string,
	name: string,
	version: string,
) {
	const root = join(directory, name);
	await mkdir(join(root, "package"), { recursive: true });
	await writeFile(
		join(root, "package", "package.json"),
		JSON.stringify({
			name: "opencode-plugin-flow",
			version,
			main: "index.js",
			type: "module",
		}),
	);
	await writeFile(
		join(root, "package", "index.js"),
		`export default ${JSON.stringify(name)};\n`,
	);
	const path = join(root, "artifact.tgz");
	const packed = spawnSync("tar", ["-czf", path, "-C", root, "package"], {
		encoding: "utf8",
	});
	if (packed.status !== 0) throw new Error(packed.stderr);
	return {
		path,
		identity: {
			packageVersion: (await packedPackageManifest(path)).version,
			sourceCommit: `fixture-${name}`,
			sourceTreeSha256: `sha256:${"a".repeat(64)}`,
			tarballSha256: await tarballSha256(path),
			unpackedManifestSha256: await unpackedManifestSha256(path),
		},
	};
}

export function fakeStudyTransport(
	options: {
		failStart?: number;
		badProduct?: number;
		usage?: Outcome["tokens"];
		costUsd?: number | null;
		afterRun?: (index: number) => void;
		variants?: string[] | null;
		probeFailure?: string;
		usageAvailability?: Outcome["usageAvailability"];
		observedVariant?: string;
		afterProbe?: () => void;
		probeError?: { stage: "before-dispatch" | "after-dispatch"; error: Error };
		beforeRetain?: (index: number) => void;
		beforeSession?: () => Promise<void>;
	} = {},
) {
	const starts: Parameters<StudyTransport["startHost"]>[0][] = [];
	const dispatches: Array<{
		mode: string;
		model: string;
		variant: string | undefined;
	}> = [];
	const caches: string[] = [];
	let probes = 0;
	const transport: StudyTransport = {
		prepareCache: async (path, directory) => {
			await readFile(path);
			caches.push(directory);
			return directory;
		},
		startHost: async (input) => {
			starts.push(input);
			const index = starts.length;
			if (index === options.failStart)
				throw new EvaluationPhaseError(
					attemptFailure(
						"host",
						"injected-start-failure",
						new Error("Injected host failure"),
						true,
					),
					new Error("Injected host failure"),
				);
			const project = await mkdtemp(join(tmpdir(), "study-local-"));
			for (const [path, value] of Object.entries(input.files)) {
				await mkdir(dirname(join(project, path)), { recursive: true });
				await writeFile(join(project, path), value);
			}
			let retain: ((project: string) => Promise<void>) | undefined;
			let stopped = false;
			let lastModel = "fixture/manager";
			let variant: string | undefined;
			const run = async (
				mode: string,
				model: string,
				requestedVariant?: string,
			) => {
				lastModel = model;
				variant = requestedVariant;
				dispatches.push({ mode, model, variant });
				if (index === options.badProduct)
					await writeFile(
						join(project, "value.ts"),
						"export function value(input: number) { return input - 1; }\n",
					);
				options.afterRun?.(index);
				return "quiet" as const;
			};
			return {
				project,
				retainProjectOnStop: (callback) => {
					retain = callback;
				},
				createSession: async () => {
					await options.beforeSession?.();
					return `session-${index}`;
				},
				runCommand: async (_session, _command, _arguments, model, settings) =>
					run("flow", model, settings?.variant),
				runPrompt: async (_session, _prompt, model, settings) =>
					run("ordinary", model, settings?.variant),
				outcome: async () => ({
					allCalls: [],
					flowCalls: [],
					session: input.withFlow ? { closure: { kind: "completed" } } : null,
					archives: [],
					finalText: "Task status: complete",
					durationMs: 1,
					assistantMessages: 1,
					tokens: options.usage ?? {
						input: 5,
						output: 2,
						reasoning: 3,
						cacheRead: 7,
						cacheWrite: 11,
					},
					costUsd: options.costUsd === undefined ? 0.25 : options.costUsd,
					providerError: null,
					...(options.usageAvailability === undefined
						? {}
						: { usageAvailability: options.usageAvailability }),
					actors: [
						{
							role: "manager",
							sessionIds: [`session-${index}`],
							actualModel: {
								kind: "observed",
								value: splitModel(lastModel),
							},
							...(variant === undefined
								? {}
								: {
										actualVariant: {
											kind: "observed",
											value: options.observedVariant ?? variant,
										} as const,
									}),
						},
					],
				}),
				stop: async () => {
					if (stopped) return;
					stopped = true;
					try {
						options.beforeRetain?.(index);
						await retain?.(project);
					} finally {
						await rm(project, { recursive: true, force: true });
					}
				},
				catalogProfiles: async () => [
					{
						model: "fixture/manager",
						variants:
							options.variants === undefined
								? ["high", "low"]
								: options.variants,
					},
				],
				probeModel: async (_model, settings) => {
					if (options.probeError?.stage === "before-dispatch")
						throw options.probeError.error;
					settings?.onDispatch?.();
					probes++;
					if (options.probeError?.stage === "after-dispatch")
						throw options.probeError.error;
					settings?.observeUsage?.(
						normalizeStudyUsage({
							tokens: {
								input: 0,
								output: 1,
								reasoning: 2,
								cacheRead: 0,
								cacheWrite: 0,
							},
							costUsd: options.costUsd === undefined ? 0.01 : options.costUsd,
						}),
					);
					options.afterProbe?.();
					return options.probeFailure ?? null;
				},
			};
		},
	};
	return { transport, starts, dispatches, caches, probes: () => probes };
}
