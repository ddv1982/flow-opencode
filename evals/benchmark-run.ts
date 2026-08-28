#!/usr/bin/env bun
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import type { BenchmarkCase } from "./benchmark.js";
import { BENCHMARK_CASES } from "./benchmarks.js";
import { currentBunToolchain } from "./bun-toolchain.js";
import { parseCaseCatalog } from "./catalog.js";
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
	type DurableFailureOrigin,
	EvaluationPersistenceError,
	EvaluationPhaseError,
	evaluationPhase,
	evaluatorFailure,
	failureOutcome,
	isEvaluatorFailure,
	persistEvaluation,
	preservePrimaryFailure,
} from "./failure-origin.js";
import {
	type CommandEnd,
	EvalHost,
	type Outcome,
	packPlugin,
	preparePackageCache,
} from "./harness.js";
import {
	evaluatorIdentity,
	hostConfigSha256,
	inspectArtifact,
	instructionDelivery,
	normalizeRequestedModel,
	redactTranscript,
} from "./provenance.js";
import type {
	ActorIdentity,
	AttemptRecordV2,
	CampaignPlan,
	InstructionDelivery,
	ModelIdentity,
} from "./report.js";
import { createReportStore } from "./report-store.js";

type Options = {
	model: string;
	cases: readonly string[];
	repeat: number;
	seed: string;
	reserves: number;
	maxUsd: number | null;
};
function args(argv: readonly string[]): Options {
	let model = "";
	const cases: string[] = [];
	let repeat = 1;
	let seed = new Date().toISOString().slice(0, 10);
	let reserves = 1;
	let maxUsd: number | null = null;
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		const value = argv[i + 1];
		if (flag === "--model" && value) {
			model = value;
			i += 1;
		} else if (flag === "--case" && value) {
			cases.push(value);
			i += 1;
		} else if (flag === "--repeat" && value) {
			repeat = Number.parseInt(value, 10);
			i += 1;
		} else if (flag === "--seed" && value) {
			seed = value;
			i += 1;
		} else if (flag === "--reserve-pairs" && value) {
			reserves = Number.parseInt(value, 10);
			i += 1;
		} else if (flag === "--max-usd" && value) {
			maxUsd = Number.parseFloat(value);
			i += 1;
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"usage: bun run benchmark -- --model provider/model [--case id] [--repeat n] [--seed text] [--reserve-pairs n] [--max-usd n]",
			);
			process.exit(0);
		} else throw new Error(`Unknown or incomplete argument: ${flag ?? ""}`);
	}
	if (
		!model ||
		!Number.isSafeInteger(repeat) ||
		repeat < 1 ||
		!Number.isSafeInteger(reserves) ||
		reserves < 0 ||
		(maxUsd !== null && (!Number.isFinite(maxUsd) || maxUsd < 0))
	)
		throw new Error("Invalid benchmark arguments.");
	return { model, cases, repeat, seed, reserves, maxUsd };
}
function model(id: string): ModelIdentity {
	const i = id.indexOf("/");
	const routed = id.slice(i + 1);
	return normalizeRequestedModel({
		modelId: id,
		gateway: routed.includes("/") ? id.slice(0, i) : null,
		family: routed,
		revision: null,
	});
}
function catalogFor(cases: readonly BenchmarkCase[]) {
	return cases.map((c) => ({
		caseId: c.id,
		caseVersion: 1,
		evidenceClass: "paired-value" as const,
		oracle: "hidden-executable" as const,
		release: "report-only" as const,
		minProviders: 1,
		minScoredAttempts: 1,
		minPassRate: null,
		reviewerPromotionRecordSha256: null,
	}));
}
function parseCatalog(value: unknown) {
	const parsed = parseCaseCatalog(value);
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
	return parsed.value;
}
function observedActual(outcome: Outcome): ActorIdentity["actualModel"] {
	const actor = outcome.actors?.find((a) => a.role === "manager");
	if (!actor)
		return { kind: "unobserved", reason: "Manager identity was not observed." };
	return actor.actualModel.kind === "observed"
		? {
				kind: "unobserved",
				reason: `Host observed providerID=${actor.actualModel.value.providerID} modelID=${actor.actualModel.value.modelID}; full identity unavailable.`,
			}
		: actor.actualModel;
}
function actorsFor(
	requested: ModelIdentity,
	outcome: Outcome,
): ActorIdentity[] {
	const actor = outcome.actors?.find((a) => a.role === "manager");
	return actor && actor.sessionIds.length > 0
		? [
				{
					role: "manager",
					requestedModel: requested,
					actualModel: observedActual(outcome),
					sessionIds: [...actor.sessionIds],
				},
			]
		: [];
}
function instructionsFor(
	benchmark: BenchmarkCase,
	outcome: Outcome,
): InstructionDelivery[] {
	return [
		instructionDelivery({
			source: "command",
			name: "benchmark-task",
			sequence: 0,
			text: benchmark.prompt,
		}),
		...(outcome.guidanceLoads ?? []).map((load, i) =>
			instructionDelivery({
				source: "guidance",
				name: load.id ?? "guidance",
				sequence: i + 1,
				text: load.rawOutput,
			}),
		),
	];
}
function completionClaim(outcome: Outcome, flow: boolean): boolean {
	const docs = [outcome.session, ...outcome.archives].filter(
		(x): x is Record<string, unknown> => x !== null,
	);
	if (
		docs.some(
			(d) =>
				typeof d.closure === "object" &&
				d.closure !== null &&
				Reflect.get(d.closure, "kind") === "completed",
		)
	)
		return true;
	return !flow && /\b(done|completed|finished)\b/i.test(outcome.finalText);
}
function productAttempt(input: {
	cell: CampaignPlan["cells"][number];
	benchmark: BenchmarkCase;
	outcome: Outcome;
	artifact: AttemptRecordV2["artifact"];
	evaluator: AttemptRecordV2["evaluator"];
	hostConfig: string;
	transcript: { artifact: string; sha256: string };
	hiddenCorrectness: boolean;
	gradeIssues: readonly string[];
	endedBy: CommandEnd;
	requested: ModelIdentity;
	flow: boolean;
}): AttemptRecordV2 {
	const hidden = input.hiddenCorrectness;
	const claim = completionClaim(input.outcome, input.flow);
	const instructions = instructionsFor(input.benchmark, input.outcome);
	return {
		schemaVersion: 2,
		attemptId: `attempt-${input.cell.cellId}`,
		cellId: input.cell.cellId,
		blockId: input.cell.blockId,
		caseId: input.cell.caseId,
		caseVersion: input.cell.caseVersion,
		armToken: input.cell.armToken,
		repetition: input.cell.repetition,
		artifact: input.artifact,
		evaluator: input.evaluator,
		hostConfigSha256: input.hostConfig,
		actors: actorsFor(input.requested, input.outcome),
		instructions,
		transcript: input.transcript,
		outcome: {
			kind: "product",
			passed: hidden,
			endedBy: input.endedBy === "escalated" ? "user-escalation" : "quiet",
			issues: hidden
				? []
				: input.gradeIssues.length > 0
					? [...input.gradeIssues]
					: ["Hidden executable grade failed."],
			evidence: {
				kind: "paired-value",
				hiddenCorrectness: hidden,
				claimedComplete: claim,
				falseCompletion: !hidden && claim,
			},
		},
		usage: {
			durationMs: input.outcome.durationMs,
			outputTokens: input.outcome.tokens.output,
			costUsd: input.outcome.costUsd,
		},
	};
}

export function pairedBudgetExceeded(input: {
	readonly budget: CampaignPlan["budget"];
	readonly attempts: readonly Pick<AttemptRecordV2, "usage">[];
	readonly elapsedMs: number;
}): boolean {
	const outputTokens = input.attempts.reduce(
		(sum, attempt) => sum + attempt.usage.outputTokens,
		0,
	);
	const unknownCost = input.attempts.some(
		(attempt) => attempt.usage.costUsd === null,
	);
	const costUsd = input.attempts.reduce(
		(sum, attempt) => sum + (attempt.usage.costUsd ?? 0),
		0,
	);
	return (
		outputTokens > input.budget.maxOutputTokens ||
		input.elapsedMs > input.budget.maxWallClockMs ||
		input.attempts.length > input.budget.maxAttempts ||
		(input.budget.maxUsd !== null &&
			(unknownCost || costUsd > input.budget.maxUsd))
	);
}

async function main(): Promise<void> {
	const options = args(process.argv.slice(2));
	const toolchain = currentBunToolchain(packageJson.packageManager);
	const selected = options.cases.length
		? BENCHMARK_CASES.filter((c) => options.cases.includes(c.id))
		: BENCHMARK_CASES;
	if (
		selected.length === 0 ||
		options.cases.some(
			(caseId) => !BENCHMARK_CASES.some((entry) => entry.id === caseId),
		)
	) {
		throw new Error("Every requested benchmark case must exist.");
	}
	const requested = model(options.model);
	const root = join(import.meta.dir, "..");
	const opencodeVersion = packageJson.devDependencies["@opencode-ai/plugin"];
	const experiment = createPairedPlan({
		cases: selected.map((c) => ({ caseId: c.id, caseVersion: 1 })),
		model: requested,
		repetitions: options.repeat,
		reservePairsPerBlock: options.reserves,
		randomizationSeed: options.seed,
		allocationSeed:
			process.env.FLOW_EVAL_ALLOCATION_SEED?.trim() ||
			randomBytes(32).toString("hex"),
		commitmentNonce:
			process.env.FLOW_EVAL_COMMITMENT_NONCE?.trim() ||
			randomBytes(32).toString("hex"),
		budget: {
			maxUsd: options.maxUsd,
			unknownCostPolicy: "stop",
			maxOutputTokens: 200_000,
			maxWallClockMs: 3_600_000,
			maxAttempts:
				selected.length * options.repeat * (2 + options.reserves * 2),
		},
	});
	const catalog = parseCatalog(catalogFor(selected));
	const directory = join(
		root,
		"evals",
		"results",
		`paired-${new Date().toISOString().replace(/[:.]/g, "-")}.v2`,
	);
	await persistEvaluation("report-directory", () =>
		mkdir(join(root, "evals", "results"), { recursive: true }),
	);
	const store = createReportStore({ directory, catalog });
	await persistEvaluation("initialize", () =>
		store.initialize(experiment.plan),
	);
	await persistEvaluation("catalog", () => store.writeCatalog(catalog));
	const packDir = await mkdtemp(join(tmpdir(), "flow-paired-pack-"));
	const attempts: AttemptRecordV2[] = [];
	const scans: ReturnType<typeof scanPairedTranscript>[] = [];
	const activatedReserveCellIds: string[] = [];
	let unresolved = false;
	const startedAt = new Date().toISOString();
	try {
		const tarball = await packPlugin(root, packDir, toolchain);
		const artifact = await inspectArtifact({
			repositoryRoot: root,
			tarballPath: tarball,
		});
		await persistEvaluation("artifact", () => store.writeArtifact(tarball));
		const evaluator = evaluatorIdentity({
			sourceCommit: artifact.sourceCommit,
			caseCatalog: selected.map((c) => ({
				id: c.id,
				files: c.files,
				prompt: c.prompt,
			})),
			policyCatalog: catalog,
			graderBundle: {
				benchmarks: await readFile(
					join(root, "evals", "benchmarks.ts"),
					"utf8",
				),
				experiment: await readFile(
					join(root, "evals", "experiment.ts"),
					"utf8",
				),
				power: await readFile(
					join(root, "evals", "experiment-power.ts"),
					"utf8",
				),
				runner: await readFile(join(root, "evals", "benchmark-run.ts"), "utf8"),
				report: await readFile(join(root, "evals", "report.ts"), "utf8"),
				pairing: await readFile(
					join(root, "evals", "report-pairing.ts"),
					"utf8",
				),
			},
		});
		const cache = await preparePackageCache(tarball, packDir, toolchain);
		const preflight = await EvalHost.start({
			toolchain,
			packageCache: cache,
			opencodeVersion,
			files: { "package.json": '{"name":"paired-preflight"}\n' },
			withFlow: false,
		});
		try {
			if (!(await preflight.catalogModels()).includes(options.model)) {
				throw new Error(
					`Model ${options.model} is absent from the host catalog.`,
				);
			}
			const failure = await preflight.probeModel(options.model);
			if (failure)
				throw new Error(`${options.model} would not answer: ${failure}`);
		} finally {
			await preflight.stop();
		}
		const primary = pairedBlocks(experiment.plan).filter(
			(b) => b.schedule === "primary",
		);
		const reserves = pairedBlocks(experiment.plan).filter(
			(b) => b.schedule === "replacement-reserve",
		);
		const reserveBySlot = new Map<string, ExperimentBlock[]>();
		for (const reserve of reserves) {
			const key = `${reserve.caseId}\u0000${reserve.repetition}`;
			reserveBySlot.set(key, [...(reserveBySlot.get(key) ?? []), reserve]);
		}
		const budgetExceeded = (): boolean => {
			return pairedBudgetExceeded({
				budget: experiment.plan.budget,
				attempts,
				elapsedMs: Date.now() - Date.parse(startedAt),
			});
		};
		const runBlock = async (
			block: ExperimentBlock,
		): Promise<{
			readonly nonProduct: boolean;
			readonly budget: boolean;
			readonly origin: DurableFailureOrigin | null;
		}> => {
			let nonProduct = false;
			let blockOrigin: DurableFailureOrigin | null = null;
			for (const cell of block.cells) {
				if (
					attempts.length >= experiment.plan.budget.maxAttempts ||
					budgetExceeded()
				) {
					return { nonProduct: true, budget: true, origin: blockOrigin };
				}
				const benchmark = selected.find((entry) => entry.id === cell.caseId);
				if (!benchmark) throw new Error(`Unknown case ${cell.caseId}.`);
				const flow = armForCell(experiment.secret, cell) === "candidate";
				const cellStarted = Date.now();
				let host: EvalHost | null = null;
				let recorded = false;
				let runFailure: AttemptFailure<DurableFailureOrigin> | null = null;
				let failureUsage: AttemptRecordV2["usage"] = {
					durationMs: 0,
					outputTokens: 0,
					costUsd: null,
				};
				await preservePrimaryFailure(
					async () => {
						try {
							host = await EvalHost.start({
								toolchain,
								packageCache: cache,
								opencodeVersion,
								files: benchmark.files,
								withFlow: flow,
							});
							const activeHost = host;
							const session = await evaluationPhase(
								"host",
								"session-create-failed",
								true,
								() => activeHost.createSession("paired task"),
							);
							let commandEnd: CommandEnd = "quiet";
							try {
								commandEnd = flow
									? await evaluationPhase("host", "command-aborted", true, () =>
											activeHost.runCommand(
												session,
												"flow-auto",
												benchmark.prompt,
												options.model,
											),
										)
									: await evaluationPhase("host", "command-aborted", true, () =>
											activeHost.runPrompt(
												session,
												benchmark.prompt,
												options.model,
											),
										);
							} catch (caught) {
								runFailure = evaluatorFailure(caught, "command-aborted");
							}
							const outcome = await evaluationPhase(
								"evaluator",
								"outcome-collection-threw",
								false,
								() => activeHost.outcome([session], Date.now() - cellStarted),
							);
							failureUsage = {
								durationMs: outcome.durationMs,
								outputTokens: outcome.tokens.output,
								costUsd: outcome.costUsd,
							};
							runFailure ??= outcome.providerError;
							if (runFailure)
								throw new EvaluationPhaseError(runFailure, runFailure);
							const grade = await evaluationPhase(
								"evaluator",
								"benchmark-grade-threw",
								false,
								() => benchmark.grade(activeHost.project),
							);
							const transcript = redactTranscript({
								projectPath: activeHost.project,
								value: {
									calls: outcome.allCalls,
									finalText: outcome.finalText,
								},
							});
							const stored = await persistEvaluation("transcript", () =>
								store.writeTranscript({
									attemptId: `attempt-${cell.cellId}`,
									text: transcript.text,
								}),
							);
							scans.push(scanPairedTranscript(transcript.text));
							const attempt = productAttempt({
								cell,
								benchmark,
								outcome,
								artifact: flow ? artifact : { kind: "ordinary-opencode" },
								evaluator,
								hostConfig: hostConfigSha256({
									opencodeVersion,
									model: options.model,
									flow,
								}),
								transcript: stored,
								requested,
								flow,
								hiddenCorrectness: grade.passed,
								gradeIssues: grade.issues,
								endedBy: commandEnd,
							});
							await persistEvaluation("attempt", () =>
								store.writeAttempt(attempt),
							);
							attempts.push(attempt);
							recorded = true;
						} catch (caught) {
							if (caught instanceof EvaluationPersistenceError) throw caught;
							if (recorded) throw caught;
							const classified = evaluatorFailure(caught);
							const failed =
								classified.origin === "evaluator"
									? classified
									: (runFailure ?? classified);
							const failure: AttemptRecordV2 = {
								schemaVersion: 2,
								attemptId: `attempt-${cell.cellId}`,
								cellId: cell.cellId,
								blockId: cell.blockId,
								caseId: cell.caseId,
								caseVersion: cell.caseVersion,
								armToken: cell.armToken,
								repetition: cell.repetition,
								artifact: flow ? artifact : { kind: "ordinary-opencode" },
								evaluator,
								hostConfigSha256: hostConfigSha256({
									opencodeVersion,
									model: options.model,
									flow,
								}),
								actors: [],
								instructions: [],
								transcript: null,
								outcome: failureOutcome(failed),
								usage:
									failureUsage.durationMs > 0
										? failureUsage
										: {
												durationMs: Date.now() - cellStarted,
												outputTokens: 0,
												costUsd: null,
											},
							};
							await persistEvaluation("attempt", () =>
								store.writeAttempt(failure),
							);
							attempts.push(failure);
							nonProduct = true;
							blockOrigin = failed.origin;
						}
					},
					async () => {
						const cleanupHost = host;
						if (cleanupHost) {
							await evaluationPhase("host", "host-cleanup-failed", true, () =>
								cleanupHost.stop(),
							);
						}
					},
				);
				if (isEvaluatorFailure(blockOrigin)) {
					return { nonProduct: true, budget: false, origin: blockOrigin };
				}
				if (budgetExceeded()) {
					return { nonProduct: true, budget: true, origin: blockOrigin };
				}
			}
			return { nonProduct, budget: false, origin: blockOrigin };
		};
		let budgetStopped = false;
		let incompleteCause: DurableFailureOrigin = "host";
		for (const block of primary) {
			let result = await runBlock(block);
			if (result.origin) incompleteCause = result.origin;
			if (isEvaluatorFailure(result.origin)) {
				unresolved = true;
				break;
			}
			if (result.budget) {
				budgetStopped = true;
				unresolved = true;
				break;
			}
			const reserveQueue = reserveBySlot.get(
				`${block.caseId}\u0000${block.repetition}`,
			);
			while (result.nonProduct) {
				const reserve = reserveQueue?.shift();
				if (!reserve) {
					unresolved = true;
					break;
				}
				activatedReserveCellIds.push(
					...reserve.cells.map((cell) => cell.cellId),
				);
				result = await runBlock(reserve);
				if (result.origin) incompleteCause = result.origin;
				if (isEvaluatorFailure(result.origin)) {
					unresolved = true;
					break;
				}
				if (result.budget) {
					budgetStopped = true;
					unresolved = true;
					break;
				}
			}
			if (budgetStopped || isEvaluatorFailure(result.origin)) break;
		}
		const finishedAt = new Date().toISOString();
		const outputTokens = attempts.reduce(
			(sum, attempt) => sum + attempt.usage.outputTokens,
			0,
		);
		const costUsd = attempts.some((attempt) => attempt.usage.costUsd === null)
			? null
			: attempts.reduce(
					(sum, attempt) => sum + (attempt.usage.costUsd ?? 0),
					0,
				);
		const wallClockMs = Math.max(
			Date.parse(finishedAt) - Date.parse(startedAt),
			...attempts.map((attempt) => attempt.usage.durationMs),
		);
		const finishedBudgetExceeded = budgetStopped || budgetExceeded();
		const attemptsByCell = new Map(
			attempts.map((attempt) => [attempt.cellId, attempt]),
		);
		const activeReserve = new Set(activatedReserveCellIds);
		const completePairs = pairedBlocks(experiment.plan).filter(
			(block) =>
				(block.schedule === "primary" ||
					block.cells.every((cell) => activeReserve.has(cell.cellId))) &&
				block.cells.every(
					(cell) => attemptsByCell.get(cell.cellId)?.outcome.kind === "product",
				),
		).length;
		const complete =
			!unresolved &&
			!finishedBudgetExceeded &&
			completePairs === primary.length;
		const report = await persistEvaluation("finalize", () =>
			store.finalize({
				reportId: `paired-${Date.now()}`,
				completion: {
					status: complete ? "complete" : "stopped",
					cause: complete
						? "fixed-target"
						: finishedBudgetExceeded
							? "budget"
							: incompleteCause,
					startedAt,
					finishedAt,
					activatedReserveCellIds,
					observed: {
						attempts: attempts.length,
						outputTokens,
						costUsd,
						wallClockMs,
					},
				},
				allocationCommitmentSha256: experiment.allocationCommitmentSha256,
			}),
		);
		const masked = freezeMaskedAnalysis({
			report,
			scans,
			frozenAt: new Date().toISOString(),
		});
		await persistEvaluation("masked-analysis", () =>
			store.writeMaskedAnalysis(masked),
		);
		const revealed = revealPairedAnalysis({
			report,
			masked,
			secret: experiment.secret,
			revealedAt: new Date().toISOString(),
		});
		await persistEvaluation("allocation", () =>
			store.writeAllocation(revealed.allocation),
		);
		console.log(`Paired V2 report: ${join(directory, "report.json")}`);
		console.log(`Masked analysis: ${join(directory, "masked-analysis.json")}`);
		console.log(`Allocation: ${join(directory, "allocation.json")}`);
		console.log(`Advisory paired claim: ${revealed.decision.claim}`);
	} finally {
		await rm(packDir, { recursive: true, force: true });
	}
}
if (import.meta.main) await main();
