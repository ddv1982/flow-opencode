import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import type { BenchmarkCase } from "./benchmark.js";
import type { RetainedBenchmarkInputs } from "./benchmark-evidence.js";
import {
	benchmarkRuntimeIdentity,
	bindBenchmarkCase,
	gradeRetainedBenchmark,
	retainBenchmarkInputs,
} from "./benchmark-grader.js";
import {
	actorsFor,
	benchmarkTaskPrompt,
	catalogFor,
	productAttempt,
	workflowCompleted,
} from "./benchmark-run.js";
import { BENCHMARK_CASES } from "./benchmarks.js";
import { type BunToolchain, currentBunToolchain } from "./bun-toolchain.js";
import { withCampaignSignals } from "./campaign-stop.js";
import { canonicalJson } from "./canonical-json.js";
import { parseCaseCatalog } from "./catalog.js";
import { assessCompletionDeclaration } from "./completion-claim.js";
import { EvidenceStore, evidenceSha256 } from "./evidence-store.js";
import {
	armForCell,
	createPairedPlan,
	type ExperimentBlock,
	freezeMaskedAnalysis,
	pairedBlocks,
	revealPairedAnalysis,
	scanPairedTranscript,
} from "./experiment.js";
import {
	type AttemptFailure,
	attemptFailure,
	type DurableFailureOrigin,
	EvaluationPersistenceError,
	EvaluationPhaseError,
	evaluationPhase,
	evaluatorFailure,
	failureOutcome,
	isEvaluatorFailure,
	persistEvaluation,
} from "./failure-origin.js";
import { EvalHost, type Outcome, preparePackageCache } from "./harness.js";
import {
	evaluatorIdentity,
	inspectWorkingSource,
	redactTranscript,
} from "./provenance.js";
import type {
	AttemptRecordV2,
	CampaignCompletion,
	ModelIdentity,
} from "./report.js";
import { createReportStore } from "./report-store.js";
import { type PreparedStudy, readStudyManifest } from "./study-manifest.js";
import {
	studyHostConfigSha256,
	studyObservedProfileIssues,
	studyReviewerModel,
} from "./study-protocol.js";
import {
	aggregateStudyUsage,
	generatedOutputTokens,
	normalizeStudyUsage,
	type StudyUsage,
} from "./study-usage.js";

export type StudyHost = Pick<
	EvalHost,
	| "project"
	| "retainProjectOnStop"
	| "createSession"
	| "runCommand"
	| "runPrompt"
	| "outcome"
	| "stop"
	| "probeModel"
	| "catalogProfiles"
>;
export type StudyTransport = {
	startHost: (
		options: Parameters<typeof EvalHost.start>[0],
	) => Promise<StudyHost>;
	prepareCache: typeof preparePackageCache;
};

const modelRoute = (model: ModelIdentity) =>
	`${model.routeProvider}/${model.model}`;

function thresholdExceeded(
	usage: StudyUsage,
	elapsed: number,
	limits: {
		maxUsd: number | null;
		unknownCostPolicy: string;
		maxWallClockMs: number;
		maxGeneratedOutputTokens: number;
	},
): boolean {
	return (
		usage.availability !== "observed" ||
		elapsed > limits.maxWallClockMs ||
		generatedOutputTokens(usage) > limits.maxGeneratedOutputTokens ||
		(limits.maxUsd !== null &&
			(usage.costUsd === null
				? limits.unknownCostPolicy === "stop"
				: usage.costUsd > limits.maxUsd))
	);
}

function allowanceExhausted(
	usage: StudyUsage,
	observations: number,
	elapsed: number,
	limits: {
		maxUsd: number | null;
		unknownCostPolicy: string;
		maxWallClockMs: number;
		maxGeneratedOutputTokens: number;
	},
): boolean {
	return (
		(observations > 0 && usage.availability !== "observed") ||
		elapsed >= limits.maxWallClockMs ||
		generatedOutputTokens(usage) >= limits.maxGeneratedOutputTokens ||
		(limits.maxUsd !== null &&
			((usage.costUsd ?? 0) >= limits.maxUsd ||
				(observations > 0 &&
					usage.costUsd === null &&
					limits.unknownCostPolicy === "stop")))
	);
}

export function selectStudyCases(
	study: PreparedStudy,
	available: readonly BenchmarkCase[],
): BenchmarkCase[] {
	return study.cases.map((requested) => {
		const benchmark = available.find(
			(entry) =>
				entry.id === requested.caseId &&
				entry.caseVersion === requested.caseVersion,
		);
		if (!benchmark)
			throw new Error(
				`Unknown development benchmark ${requested.caseId}@${requested.caseVersion}.`,
			);
		return benchmark;
	});
}

export async function executeStudy(
	study: PreparedStudy,
	options: {
		directory: string;
		benchmarks: readonly BenchmarkCase[];
		root?: string;
		toolchain?: BunToolchain;
		transport?: StudyTransport;
		signal?: AbortSignal;
		beginFinalization?: () => void;
	},
) {
	const root = options.root ?? join(import.meta.dir, "..");
	const toolchain =
		options.toolchain ?? currentBunToolchain(packageJson.packageManager);
	const transport = options.transport ?? {
		startHost: EvalHost.start,
		prepareCache: preparePackageCache,
	};
	const selected = selectStudyCases(study, options.benchmarks);
	const policy = study.policy;
	const catalogResult = parseCaseCatalog(catalogFor(selected));
	if (!catalogResult.ok) throw new Error("Invalid study case catalog.");
	const catalog = catalogResult.value;
	const runtimeSha256 = evidenceSha256(
		canonicalJson(await benchmarkRuntimeIdentity()),
	);
	const experiment = createPairedPlan({
		cases: study.cases,
		benchmarkCases: selected.map((entry) =>
			bindBenchmarkCase(entry, runtimeSha256),
		),
		model: policy.arms.candidate.manager,
		study: policy,
		repetitions: study.repetitions,
		reservePairsPerBlock: study.reservePairsPerBlock,
		randomizationSeed: study.seed,
		allocationSeed: randomBytes(32).toString("hex"),
		commitmentNonce: randomBytes(32).toString("hex"),
		budget: study.budget,
	});
	const store = createReportStore({ directory: options.directory, catalog });
	const evidence = new EvidenceStore(options.directory);
	await store.initialize(experiment.plan);
	await store.writeCatalog(catalog);
	const source = await inspectWorkingSource(root);
	const evaluator = evaluatorIdentity({
		sourceCommit: source.sourceCommit,
		caseCatalog: experiment.plan.benchmarkCases,
		policyCatalog: catalog,
		graderBundle: await Promise.all(
			[
				"study-runner.ts",
				"study-protocol.ts",
				"study-statistics.ts",
				"study-usage.ts",
				"experiment.ts",
				"report.ts",
			].map(async (path) => [
				path,
				await readFile(join(root, "evals", path), "utf8"),
			]),
		),
	});
	const scratch = await mkdtemp(join(tmpdir(), "flow-study-artifacts-"));
	const caches = new Map<string, string>();
	const attempts: AttemptRecordV2[] = [];
	const scans: ReturnType<typeof scanPairedTranscript>[] = [];
	const activatedReserveCellIds: string[] = [];
	const preflight: NonNullable<CampaignCompletion["preflight"]> = [];
	let preflightWallClockMs = 0;
	const startedAt = new Date().toISOString();
	let cause: CampaignCompletion["cause"] = "fixed-target";
	const accounting = () =>
		aggregateStudyUsage(
			attempts.map(
				(attempt) =>
					attempt.usage.accounting ??
					normalizeStudyUsage({ tokens: {}, costUsd: null }),
			),
		);
	const budgetExceeded = () =>
		attempts.length > study.budget.maxAttempts ||
		Date.now() - Date.parse(startedAt) > study.budget.maxWallClockMs ||
		attempts.reduce((sum, attempt) => sum + attempt.usage.outputTokens, 0) >
			study.budget.maxOutputTokens ||
		(attempts.length > 0 &&
			thresholdExceeded(accounting(), Date.now() - Date.parse(startedAt), {
				...study.budget,
				maxGeneratedOutputTokens: policy.accounting.maxGeneratedOutputTokens,
			}));
	try {
		for (const armName of ["baseline", "candidate"] as const) {
			const arm = policy.arms[armName];
			const bytes = study.artifacts[armName];
			if (
				!bytes ||
				"kind" in arm.artifact ||
				caches.has(arm.artifact.tarballSha256)
			)
				continue;
			const ref = await evidence.write(bytes);
			if (ref.sha256 !== arm.artifact.tarballSha256)
				throw new Error("Stored study artifact differs from its commitment.");
			const staging = join(scratch, ref.sha256.slice(7));
			await mkdir(staging);
			const tarball = join(staging, "artifact.tgz");
			await writeFile(tarball, await evidence.read(ref));
			caches.set(
				ref.sha256,
				await transport.prepareCache(tarball, staging, toolchain),
			);
		}
		const allowance = policy.accounting.preflight;
		if (allowance.kind === "entitlement" && !options.signal?.aborted) {
			const profiles = [
				...new Map(
					Object.values(policy.arms)
						.flatMap((arm) => [
							arm.manager,
							...(arm.reviewer?.model ? [arm.reviewer.model] : []),
						])
						.map((model) => [canonicalJson(model), model]),
				).values(),
			];
			if (profiles.length > allowance.maxRequests)
				throw new Error(
					"Preflight request allowance cannot cover the declared profiles.",
				);
			const preflightStarted = Date.now();
			let host: StudyHost | undefined;
			try {
				host = await transport.startHost({
					toolchain,
					packageCache: "",
					opencodeVersion: policy.opencodeVersion,
					nativeLlm: false,
					ambientConfig: "disabled",
					withFlow: false,
					reviewerEnvironment: "disabled",
					files: { "package.json": '{"name":"profile-probe"}\n' },
					signal: options.signal
						? AbortSignal.any([
								options.signal,
								AbortSignal.timeout(allowance.maxWallClockMs),
							])
						: AbortSignal.timeout(allowance.maxWallClockMs),
				});
				const catalogProfiles = await host.catalogProfiles();
				for (const model of profiles) {
					if (options.signal?.aborted) {
						cause = "operator";
						break;
					}
					let usage = normalizeStudyUsage({ tokens: {}, costUsd: null });
					const before = Date.now();
					const priorCalls = preflight.filter((entry) => entry.providerCalled);
					if (
						priorCalls.length >= allowance.maxRequests ||
						allowanceExhausted(
							aggregateStudyUsage(priorCalls.map((entry) => entry.accounting)),
							priorCalls.length,
							before - preflightStarted,
							allowance,
						)
					) {
						cause = "budget";
						break;
					}
					const catalogProfile = catalogProfiles.find(
						(entry) => entry.model === modelRoute(model),
					);
					const variantAvailability =
						model.variant === undefined
							? ("not-requested" as const)
							: catalogProfile?.variants === null ||
									catalogProfile?.variants === undefined
								? ("unobserved" as const)
								: catalogProfile.variants.includes(model.variant)
									? ("listed" as const)
									: ("missing" as const);
					const eligibleForProbe =
						catalogProfile !== undefined &&
						variantAvailability !== "missing" &&
						variantAvailability !== "unobserved";
					let providerCalled = false;
					let failure: string | null;
					try {
						failure = eligibleForProbe
							? await host.probeModel(modelRoute(model), {
									...(model.variant === undefined
										? {}
										: { variant: model.variant }),
									onDispatch: () => {
										options.signal?.throwIfAborted();
										if (
											Date.now() - preflightStarted >=
											allowance.maxWallClockMs
										) {
											cause = "budget";
											throw new Error(
												"Preflight wall-clock allowance exhausted before dispatch.",
											);
										}
										providerCalled = true;
									},
									observeUsage: (observed) => {
										usage = observed;
									},
								})
							: !catalogProfile
								? "Requested model is absent from the native host catalog."
								: `Requested variant availability is ${variantAvailability}; provider application is unverified.`;
					} catch (error) {
						failure = error instanceof Error ? error.message : String(error);
						cause = options.signal?.aborted
							? "operator"
							: Date.now() - preflightStarted >= allowance.maxWallClockMs
								? "budget"
								: "host";
					}
					if (providerCalled && failure && usage.costUsd === 0)
						usage = normalizeStudyUsage({
							tokens: usage.tokens,
							costUsd: null,
							availability: usage.availability,
						});
					const receipt = {
						model,
						failure,
						providerCalled,
						variantAvailability,
						durationMs: Date.now() - before,
						accounting: usage,
					};
					preflight.push(receipt);
					await persistEvaluation("study-preflight", () =>
						store.writePreflightRequest(preflight.length - 1, receipt),
					);
					if (
						cause !== "operator" &&
						providerCalled &&
						thresholdExceeded(
							aggregateStudyUsage(
								preflight
									.filter((entry) => entry.providerCalled)
									.map((entry) => entry.accounting),
							),
							Date.now() - preflightStarted,
							allowance,
						)
					) {
						cause = "budget";
						break;
					}
					if (cause !== "fixed-target") break;
					if (failure) {
						cause = providerCalled ? "provider" : "host";
						break;
					}
				}
			} catch (error) {
				cause = options.signal?.aborted
					? "operator"
					: Date.now() - preflightStarted >= allowance.maxWallClockMs
						? "budget"
						: "host";
				if (error instanceof EvaluationPersistenceError) throw error;
			} finally {
				await host?.stop();
				preflightWallClockMs = Date.now() - preflightStarted;
				if (
					preflightWallClockMs > allowance.maxWallClockMs &&
					cause !== "operator"
				)
					cause = "budget";
			}
		}
		const runCell = async (
			cell: ExperimentBlock["cells"][number],
		): Promise<AttemptFailure<DurableFailureOrigin> | null> => {
			const arm = policy.arms[armForCell(experiment.secret, cell)];
			const flow = !("kind" in arm.artifact);
			const benchmark = selected.find(
				(entry) =>
					entry.id === cell.caseId && entry.caseVersion === cell.caseVersion,
			);
			if (!benchmark) throw new Error("Study cell has no benchmark.");
			const cellStarted = Date.now();
			let host: StudyHost | undefined;
			let inputs: RetainedBenchmarkInputs | undefined;
			let outcome: Outcome | undefined;
			let usage = normalizeStudyUsage({
				tokens: {
					input: 0,
					output: 0,
					reasoning: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				costUsd: 0,
			});
			let failure: AttemptFailure<DurableFailureOrigin> | null = null;
			let cleanupFailure: unknown;
			let attempt: AttemptRecordV2;
			try {
				const reviewer = arm.reviewer;
				host = await evaluationPhase("host", "host-start-failed", true, () =>
					transport.startHost({
						toolchain,
						packageCache:
							flow && "tarballSha256" in arm.artifact
								? (caches.get(arm.artifact.tarballSha256) ?? "")
								: "",
						...(flow && "packageVersion" in arm.artifact
							? { packageVersion: arm.artifact.packageVersion }
							: {}),
						opencodeVersion: policy.opencodeVersion,
						files: benchmark.files,
						withFlow: flow,
						nativeLlm: false,
						ambientConfig: "disabled",
						reviewerEnvironment: "disabled",
						...(reviewer
							? {
									reviewer: {
										...(reviewer.model
											? {
													model: modelRoute(reviewer.model),
													...(reviewer.model.variant === undefined
														? {}
														: { variant: reviewer.model.variant }),
												}
											: {}),
										...(reviewer.steps === null
											? {}
											: { steps: reviewer.steps }),
									},
								}
							: {}),
						...(options.signal ? { signal: options.signal } : {}),
					}),
				);
				host.retainProjectOnStop(async (project) => {
					inputs = await persistEvaluation("benchmark-inputs", () =>
						retainBenchmarkInputs({ project, benchmark, store: evidence }),
					);
				});
				const activeHost = host;
				const session = await evaluationPhase(
					"host",
					"session-create-failed",
					true,
					() => activeHost.createSession("Project task"),
				);
				let ended: Awaited<ReturnType<StudyHost["runPrompt"]>> = "quiet";
				try {
					const remainingWallClockMs =
						study.budget.maxWallClockMs - (Date.now() - Date.parse(startedAt));
					if (remainingWallClockMs <= 0) {
						cause = "budget";
						throw new EvaluationPhaseError(
							attemptFailure(
								"host",
								"budget-before-dispatch",
								new Error(
									"Host setup exhausted the study wall-clock allowance.",
								),
								false,
							),
							new Error("Study wall-clock allowance exhausted."),
						);
					}
					const callOptions = {
						timeoutMs: remainingWallClockMs,
						...(arm.manager.variant === undefined
							? {}
							: { variant: arm.manager.variant }),
					};
					usage = normalizeStudyUsage({ tokens: {}, costUsd: null });
					ended = await evaluationPhase("host", "command-aborted", true, () =>
						flow
							? activeHost.runCommand(
									session,
									"flow-auto",
									benchmarkTaskPrompt(benchmark),
									modelRoute(arm.manager),
									callOptions,
								)
							: activeHost.runPrompt(
									session,
									benchmarkTaskPrompt(benchmark),
									modelRoute(arm.manager),
									callOptions,
								),
					);
				} catch (error) {
					failure = evaluatorFailure(error, "command-aborted");
				}
				outcome = await host.outcome([session], Date.now() - cellStarted);
				usage = normalizeStudyUsage({
					tokens: outcome.tokens,
					costUsd: outcome.costUsd,
					...(outcome.usageAvailability === undefined
						? {}
						: { availability: outcome.usageAvailability }),
				});
				failure ??= outcome.providerError;
				if (failure && usage.costUsd === 0)
					usage = normalizeStudyUsage({
						tokens: usage.tokens,
						costUsd: null,
						availability: usage.availability,
					});
				if (usage.availability !== "observed")
					failure ??= attemptFailure(
						"host",
						"usage-unavailable",
						new Error("Complete host token categories were not observed."),
						false,
					);
				const profileIssues = studyObservedProfileIssues(
					arm,
					actorsFor(arm.manager, outcome, studyReviewerModel(arm)),
				);
				if (profileIssues.length > 0)
					failure ??= attemptFailure(
						"host",
						"profile-observation-mismatch",
						new Error(profileIssues.join(" ")),
						false,
					);
				if (failure) throw new EvaluationPhaseError(failure, failure);
				await evaluationPhase("host", "host-cleanup-failed", false, () =>
					activeHost.stop(),
				);
				if (!inputs)
					throw new Error("Benchmark inputs were not retained before cleanup.");
				const grade = await gradeRetainedBenchmark({ inputs, store: evidence });
				const receipt = await persistEvaluation("benchmark-receipt", () =>
					evidence.writeJson(grade),
				);
				const transcript = redactTranscript({
					projectPath: host.project,
					value: {
						schemaVersion: 1,
						calls: outcome.allCalls,
						finalText: outcome.finalText,
						workflowDocuments: [outcome.session, ...outcome.archives].filter(
							(document) => document !== null,
						),
					},
				});
				const stored = await persistEvaluation("transcript", () =>
					store.writeTranscript({
						attemptId: `attempt-${cell.cellId}`,
						text: transcript.text,
					}),
				);
				scans.push(scanPairedTranscript(transcript.text));
				attempt = productAttempt({
					cell,
					benchmark,
					outcome,
					artifact: arm.artifact,
					evaluator,
					hostConfig: studyHostConfigSha256(policy, arm),
					transcript: stored,
					hiddenCorrectness: grade.passed,
					gradeIssues: grade.probes
						.filter((probe) => probe.disposition !== "passed")
						.map((probe) => `${probe.id}: ${probe.detail}`),
					endedBy: ended,
					requested: arm.manager,
					reviewerRequested: studyReviewerModel(arm),
					flow,
					accounting: usage,
					retained: {
						schemaVersion: 1,
						inputs,
						receipt,
						completion: assessCompletionDeclaration(outcome.finalText),
						workflowCompleted: workflowCompleted(outcome),
						containment: grade.containment,
					},
				});
			} catch (error) {
				if (error instanceof EvaluationPersistenceError) throw error;
				failure ??= evaluatorFailure(error);
				try {
					await host?.stop();
				} catch (cleanup) {
					cleanupFailure = cleanup;
				}
				attempt = {
					schemaVersion: 2,
					attemptId: `attempt-${cell.cellId}`,
					cellId: cell.cellId,
					blockId: cell.blockId,
					caseId: cell.caseId,
					caseVersion: cell.caseVersion,
					armToken: cell.armToken,
					repetition: cell.repetition,
					artifact: arm.artifact,
					evaluator,
					hostConfigSha256: studyHostConfigSha256(policy, arm),
					actors: outcome
						? actorsFor(arm.manager, outcome, studyReviewerModel(arm))
						: [],
					instructions: [],
					transcript: null,
					outcome: failureOutcome(failure),
					...(inputs ? { retainedInputs: inputs } : {}),
					usage: {
						durationMs: Date.now() - cellStarted,
						outputTokens: usage.tokens.output,
						costUsd: usage.costUsd,
						accounting: usage,
					},
				};
			} finally {
				try {
					await host?.stop();
				} catch (cleanup) {
					cleanupFailure ??= cleanup;
				}
			}
			await store.writeAttempt(attempt);
			attempts.push(attempt);
			if (cleanupFailure !== undefined) throw cleanupFailure;
			return failure;
		};
		const blocks = pairedBlocks(experiment.plan);
		const runBlock = async (block: ExperimentBlock) => {
			let failure: AttemptFailure<DurableFailureOrigin> | null = null;
			for (const cell of block.cells) {
				if (options.signal?.aborted) {
					cause = "operator";
					break;
				}
				if (
					attempts.length >= study.budget.maxAttempts ||
					attempts.reduce(
						(sum, attempt) => sum + attempt.usage.outputTokens,
						0,
					) >= study.budget.maxOutputTokens ||
					allowanceExhausted(
						accounting(),
						attempts.length,
						Date.now() - Date.parse(startedAt),
						{
							...study.budget,
							maxGeneratedOutputTokens:
								policy.accounting.maxGeneratedOutputTokens,
						},
					)
				) {
					cause = "budget";
					break;
				}
				const current = await runCell(cell);
				failure ??= current;
				if (current && isEvaluatorFailure(current.origin)) break;
			}
			return failure;
		};
		for (const primary of blocks.filter(
			(block) => block.schedule === "primary",
		)) {
			if (cause !== "fixed-target") break;
			let failure = await runBlock(primary);
			for (const reserve of blocks.filter(
				(block) =>
					block.schedule === "replacement-reserve" &&
					block.caseId === primary.caseId &&
					block.caseVersion === primary.caseVersion &&
					block.repetition === primary.repetition,
			)) {
				if (
					!failure?.retryable ||
					isEvaluatorFailure(failure.origin) ||
					cause !== "fixed-target"
				)
					break;
				activatedReserveCellIds.push(
					...reserve.cells.map((cell) => cell.cellId),
				);
				failure = await runBlock(reserve);
			}
			if (cause === "fixed-target" && failure) cause = failure.origin;
			if (budgetExceeded()) cause = "budget";
		}
		if (budgetExceeded()) cause = "budget";
		if (options.signal?.aborted) cause = "operator";
		options.beginFinalization?.();
		const report = await store.finalize({
			reportId: `study-${Date.now()}`,
			completion: {
				status: cause === "fixed-target" ? "complete" : "stopped",
				cause,
				startedAt,
				finishedAt: new Date().toISOString(),
				activatedReserveCellIds,
				preflight,
				preflightWallClockMs,
				observed: {
					attempts: attempts.length,
					outputTokens: attempts.reduce(
						(sum, attempt) => sum + attempt.usage.outputTokens,
						0,
					),
					costUsd: attempts.some((attempt) => attempt.usage.costUsd === null)
						? null
						: attempts.reduce(
								(sum, attempt) => sum + (attempt.usage.costUsd ?? 0),
								0,
							),
					wallClockMs: Math.max(
						Date.now() - Date.parse(startedAt),
						...attempts.map((attempt) => attempt.usage.durationMs),
					),
					accounting: accounting(),
				},
			},
			allocationCommitmentSha256: experiment.allocationCommitmentSha256,
		});
		const masked = freezeMaskedAnalysis({
			report,
			scans,
			frozenAt: new Date().toISOString(),
		});
		await store.writeMaskedAnalysis(masked);
		const revealed = revealPairedAnalysis({
			report,
			masked,
			secret: experiment.secret,
			revealedAt: new Date().toISOString(),
		});
		await store.writeAllocation(revealed.allocation);
		return { report, masked, ...revealed };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

export async function runStudyCommand(argv: readonly string[]): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(
			"usage: bun run benchmark -- --manifest <study.json> [--dry-run]\n",
		);
		return;
	}
	let path: string | undefined;
	let dryRun = false;
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--manifest" && argv[index + 1] && path === undefined)
			path = argv[++index];
		else if (argv[index] === "--dry-run" && !dryRun) dryRun = true;
		else
			throw new Error(
				"Use --manifest <path> [--dry-run] without legacy benchmark flags.",
			);
	}
	if (!path) throw new Error("--manifest is required for a study.");
	const study = await readStudyManifest(path);
	selectStudyCases(study, BENCHMARK_CASES);
	if (dryRun) {
		process.stdout.write(`${JSON.stringify(study.summary, null, 2)}\n`);
		return;
	}
	process.exitCode = await withCampaignSignals(
		async (signal, beginFinalization) => {
			const directory = join(
				import.meta.dir,
				"results",
				`study-${new Date().toISOString().replace(/[:.]/g, "-")}.v2`,
			);
			const result = await executeStudy(study, {
				directory,
				benchmarks: BENCHMARK_CASES,
				signal,
				beginFinalization,
			});
			process.stdout.write(
				`${JSON.stringify(
					{
						directory,
						purpose: study.policy.purpose,
						method: study.policy.method,
						decision: result.decision,
						accounting: result.report.completion.observed.accounting,
						preflight: result.report.completion.preflight,
						budgetSemantics: study.summary.budgetSemantics,
					},
					null,
					2,
				)}\n`,
			);
			return result.report.completion.status === "complete" ? 0 : 1;
		},
	);
}
