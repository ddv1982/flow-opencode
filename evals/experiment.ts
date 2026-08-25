import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import {
	PAIRED_ANALYSIS_VERSION_SHA256,
	PAIRED_BOOTSTRAP_SAMPLES,
	requiredPairedPowerPairs,
} from "./experiment-power.js";
import type { ArtifactIdentity } from "./report.js";
import {
	type CampaignPlan,
	CampaignPlanSchema,
	campaignPlanSha256,
	type ModelIdentity,
	type ScheduledCell,
	type ValidatedReport,
} from "./report.js";

const SCANNER_VERSION_SHA256 = canonicalSha256(
	"flow-paired-transcript-scanner-v1",
	{
		markers: [
			"reserved-arm-label",
			"ground-truth-surface",
			"evaluator-source",
			"measurement-marker",
		],
	},
);

export { PAIRED_ANALYSIS_VERSION_SHA256 } from "./experiment-power.js";

export type Arm = "candidate" | "baseline";
export type ExperimentCase = {
	readonly caseId: string;
	readonly caseVersion: number;
};
export type BlockAllocation = {
	readonly blockId: string;
	readonly caseId: string;
	readonly caseVersion: number;
	readonly repetition: number;
	readonly tokens: readonly [string, string];
	readonly tokenToArm: Readonly<Record<string, Arm>>;
};
export type AllocationSecret = {
	readonly schemaVersion: 1;
	readonly planSha256: string;
	readonly nonce: string;
	readonly blocks: readonly BlockAllocation[];
};
export type TranscriptScan = {
	readonly schemaVersion: 1;
	readonly versionSha256: string;
	readonly transcriptSha256: string;
	readonly passed: boolean;
	readonly findings: readonly string[];
	readonly sha256: string;
};
export type MaskedPairObservation = {
	readonly blockId: string;
	readonly caseId: string;
	readonly caseVersion: number;
	readonly repetition: number;
	readonly armTokens: readonly [string, string];
	readonly outcomes: readonly [boolean, boolean];
};
export type PowerMetadata = {
	readonly method: "conservative-bounded-pair";
	readonly plannedPairs: number;
	readonly requiredPairs: number;
	readonly targetPower: number;
	readonly minimumDetectableEffect: number;
	readonly sufficient: boolean;
};
export type MaskedAnalysisRecord = {
	readonly schemaVersion: 1;
	readonly reportId: string;
	readonly planSha256: string;
	readonly reportSha256: string;
	readonly allocationCommitmentSha256: string;
	readonly analysisPolicySha256: string;
	readonly observations: readonly MaskedPairObservation[];
	readonly completePairs: number;
	readonly unresolvedPairs: number;
	readonly ties: number;
	readonly opaqueEstimate: number | null;
	readonly interval95: readonly [number, number] | null;
	readonly power: PowerMetadata;
	readonly scannerSha256: string;
	readonly scannerPassed: boolean;
	readonly scans: readonly TranscriptScan[];
	readonly gateReasons: readonly string[];
	readonly claimEligible: boolean;
	readonly treatmentBlinding: "flow-tool-presence-visible";
	readonly frozenAt: string;
	readonly sha256: string;
};
export type AllocationRecord = {
	readonly schemaVersion: 1;
	readonly reportId: string;
	readonly planSha256: string;
	readonly reportSha256: string;
	readonly maskedAnalysisSha256: string;
	readonly allocationCommitmentSha256: string;
	readonly nonce: string;
	readonly blocks: readonly BlockAllocation[];
	readonly revealedAt: string;
};
export type PairedDecision = {
	readonly claim: "candidate-better" | "candidate-worse" | "inconclusive";
	readonly reasons: readonly string[];
	readonly candidateMinusBaseline: number | null;
	readonly interval95: readonly [number, number] | null;
	readonly candidateWins: number;
	readonly baselineWins: number;
	readonly ties: number;
	readonly power: PowerMetadata;
};
type ExperimentCell = ValidatedReport["plan"]["cells"][number];
export type ExperimentBlock = {
	readonly blockId: string;
	readonly caseId: string;
	readonly caseVersion: number;
	readonly repetition: number;
	readonly schedule: "primary" | "replacement-reserve";
	readonly cells: readonly [ExperimentCell, ExperimentCell];
};

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const TextSchema = z.string().min(1).max(4096).regex(/\S/);
const ArmSchema = z.enum(["candidate", "baseline"]);
const BlockAllocationSchema = z
	.object({
		blockId: TextSchema,
		caseId: TextSchema,
		caseVersion: z.number().int().safe().positive(),
		repetition: z.number().int().safe().nonnegative(),
		tokens: z.tuple([TextSchema, TextSchema]),
		tokenToArm: z.record(TextSchema, ArmSchema),
	})
	.strict()
	.superRefine((block, context) => {
		const [first, second] = block.tokens;
		if (first === second) {
			context.addIssue({
				code: "custom",
				path: ["tokens"],
				message: "Arm tokens must differ.",
			});
		}
		const keys = Object.keys(block.tokenToArm).sort();
		if (
			keys.length !== 2 ||
			keys[0] !== [...block.tokens].sort()[0] ||
			keys[1] !== [...block.tokens].sort()[1]
		) {
			context.addIssue({
				code: "custom",
				path: ["tokenToArm"],
				message: "Allocation must map exactly both arm tokens.",
			});
		}
		const arms = block.tokens.map((token) => block.tokenToArm[token]).sort();
		if (arms[0] !== "baseline" || arms[1] !== "candidate") {
			context.addIssue({
				code: "custom",
				path: ["tokenToArm"],
				message: "Each block requires one candidate and one baseline arm.",
			});
		}
	});

const AllocationSecretSchema = z
	.object({
		schemaVersion: z.literal(1),
		planSha256: DigestSchema,
		nonce: z.string().min(16).max(4096),
		blocks: z.array(BlockAllocationSchema).min(1),
	})
	.strict()
	.superRefine((secret, context) => {
		const ids = new Set(secret.blocks.map((block) => block.blockId));
		if (ids.size !== secret.blocks.length) {
			context.addIssue({
				code: "custom",
				path: ["blocks"],
				message: "Allocation block ids must be unique.",
			});
		}
	});

const ObservationSchema = z
	.object({
		blockId: TextSchema,
		caseId: TextSchema,
		caseVersion: z.number().int().safe().positive(),
		repetition: z.number().int().safe().nonnegative(),
		armTokens: z.tuple([TextSchema, TextSchema]),
		outcomes: z.tuple([z.boolean(), z.boolean()]),
	})
	.strict();
const IntervalSchema = z
	.tuple([
		z.number().finite().min(-1).max(1),
		z.number().finite().min(-1).max(1),
	])
	.refine((interval) => interval[0] <= interval[1]);
const PowerSchema = z
	.object({
		method: z.literal("conservative-bounded-pair"),
		plannedPairs: z.number().int().safe().nonnegative(),
		requiredPairs: z.number().int().safe().positive(),
		targetPower: z.number().finite().positive().lt(1),
		minimumDetectableEffect: z.number().finite().positive().max(1),
		sufficient: z.boolean(),
	})
	.strict()
	.refine(
		(power) => power.sufficient === power.plannedPairs >= power.requiredPairs,
	);
const TranscriptScanSchema = z
	.object({
		schemaVersion: z.literal(1),
		versionSha256: DigestSchema,
		transcriptSha256: DigestSchema,
		passed: z.boolean(),
		findings: z.array(TextSchema),
		sha256: DigestSchema,
	})
	.strict();

export const MaskedAnalysisRecordSchema = z
	.object({
		schemaVersion: z.literal(1),
		reportId: TextSchema,
		planSha256: DigestSchema,
		reportSha256: DigestSchema,
		allocationCommitmentSha256: DigestSchema,
		analysisPolicySha256: DigestSchema,
		observations: z.array(ObservationSchema),
		completePairs: z.number().int().safe().nonnegative(),
		unresolvedPairs: z.number().int().safe().nonnegative(),
		ties: z.number().int().safe().nonnegative(),
		opaqueEstimate: z.number().finite().min(-1).max(1).nullable(),
		interval95: IntervalSchema.nullable(),
		power: PowerSchema,
		scannerSha256: DigestSchema,
		scannerPassed: z.boolean(),
		scans: z.array(TranscriptScanSchema),
		gateReasons: z.array(TextSchema),
		claimEligible: z.boolean(),
		treatmentBlinding: z.literal("flow-tool-presence-visible"),
		frozenAt: z.string().datetime({ offset: true }),
		sha256: DigestSchema,
	})
	.strict()
	.superRefine((record, context) => {
		if (record.completePairs !== record.observations.length) {
			context.addIssue({
				code: "custom",
				path: ["completePairs"],
				message: "Complete-pair count must match observations.",
			});
		}
		if ((record.opaqueEstimate === null) !== (record.interval95 === null)) {
			context.addIssue({
				code: "custom",
				path: ["interval95"],
				message: "Estimate and interval must be present together.",
			});
		}
		if (record.claimEligible !== (record.gateReasons.length === 0)) {
			context.addIssue({
				code: "custom",
				path: ["claimEligible"],
				message: "Claim eligibility must match gate reasons.",
			});
		}
	});

export const AllocationRecordSchema = z
	.object({
		schemaVersion: z.literal(1),
		reportId: TextSchema,
		planSha256: DigestSchema,
		reportSha256: DigestSchema,
		maskedAnalysisSha256: DigestSchema,
		allocationCommitmentSha256: DigestSchema,
		nonce: z.string().min(16).max(4096),
		blocks: z.array(BlockAllocationSchema).min(1),
		revealedAt: z.string().datetime({ offset: true }),
	})
	.strict()
	.superRefine((record, context) => {
		const ids = new Set(record.blocks.map((block) => block.blockId));
		if (ids.size !== record.blocks.length) {
			context.addIssue({
				code: "custom",
				path: ["blocks"],
				message: "Allocation record block ids must be unique.",
			});
		}
	});

function seededRandom(seed: string): () => number {
	let state = 0x811c9dc5;
	for (const character of seed) {
		state = Math.imul(state ^ (character.codePointAt(0) ?? 0), 0x01000193);
	}
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function allocationCommitmentSha256(secret: AllocationSecret): string {
	const parsed = AllocationSecretSchema.safeParse(secret);
	if (!parsed.success) throw new Error("Allocation secret is invalid.");
	return canonicalSha256("flow-paired-allocation-commitment-v1", parsed.data);
}

export function pairedReportSha256(report: ValidatedReport): string {
	return canonicalSha256("flow-paired-report-v1", report);
}

export function maskedAnalysisSha256(record: MaskedAnalysisRecord): string {
	const { sha256: _sha256, ...withoutHash } = record;
	return canonicalSha256("flow-masked-analysis-v1", withoutHash);
}

function blockId(input: {
	readonly task: ExperimentCase;
	readonly repetition: number;
	readonly seed: string;
}): string {
	return `block-${canonicalSha256("flow-paired-block-v1", input).slice(7)}`;
}

function tokensFor(block: string): readonly [string, string] {
	return [
		`arm-${canonicalSha256("flow-paired-token-v1", { block, index: 0 }).slice(7)}`,
		`arm-${canonicalSha256("flow-paired-token-v1", { block, index: 1 }).slice(7)}`,
	];
}

function allocationFor(input: {
	readonly blockId: string;
	readonly caseId: string;
	readonly caseVersion: number;
	readonly repetition: number;
	readonly tokens: readonly [string, string];
	readonly candidateFirst: boolean;
}): BlockAllocation {
	return {
		blockId: input.blockId,
		caseId: input.caseId,
		caseVersion: input.caseVersion,
		repetition: input.repetition,
		tokens: input.tokens,
		tokenToArm: {
			[input.tokens[0]]: input.candidateFirst ? "candidate" : "baseline",
			[input.tokens[1]]: input.candidateFirst ? "baseline" : "candidate",
		},
	};
}

export function createPairedPlan(input: {
	readonly cases: readonly ExperimentCase[];
	readonly model: ModelIdentity;
	readonly repetitions: number;
	readonly reservePairsPerBlock: number;
	readonly randomizationSeed: string;
	readonly allocationSeed: string;
	readonly commitmentNonce: string;
	readonly budget: CampaignPlan["budget"];
}): {
	readonly plan: CampaignPlan;
	readonly secret: AllocationSecret;
	readonly allocationCommitmentSha256: string;
} {
	if (
		input.cases.length === 0 ||
		!Number.isSafeInteger(input.repetitions) ||
		input.repetitions < 1 ||
		!Number.isSafeInteger(input.reservePairsPerBlock) ||
		input.reservePairsPerBlock < 0 ||
		!input.randomizationSeed.trim() ||
		!input.allocationSeed.trim() ||
		input.commitmentNonce.length < 16
	) {
		throw new Error("Paired plan inputs are invalid.");
	}
	const knownCases = new Set(
		input.cases.map((entry) => `${entry.caseId}\u0000${entry.caseVersion}`),
	);
	if (knownCases.size !== input.cases.length) {
		throw new Error("Paired cases must be unique by id and version.");
	}
	const flip = seededRandom(input.allocationSeed);
	const cells: ScheduledCell[] = [];
	const allocations: BlockAllocation[] = [];
	for (const task of input.cases) {
		for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
			const primaryId = blockId({
				task,
				repetition,
				seed: input.randomizationSeed,
			});
			const tokens = tokensFor(primaryId);
			const candidateFirst = flip() < 0.5;
			for (
				let reserve = 0;
				reserve <= input.reservePairsPerBlock;
				reserve += 1
			) {
				const currentBlockId =
					reserve === 0 ? primaryId : `${primaryId}-reserve-${reserve}`;
				const schedule = reserve === 0 ? "primary" : "replacement-reserve";
				allocations.push(
					allocationFor({
						blockId: currentBlockId,
						caseId: task.caseId,
						caseVersion: task.caseVersion,
						repetition,
						tokens,
						candidateFirst,
					}),
				);
				for (const armToken of tokens) {
					cells.push({
						cellId: `cell-${canonicalSha256("flow-paired-cell-v1", { currentBlockId, armToken }).slice(7)}`,
						blockId: currentBlockId,
						caseId: task.caseId,
						caseVersion: task.caseVersion,
						armToken,
						repetition,
						managerModel: input.model,
						reviewerModel: null,
						schedule,
					});
				}
			}
		}
	}
	const primaryPairs = input.cases.length * input.repetitions;
	if (input.budget.maxAttempts < primaryPairs * 2) {
		throw new Error("Attempt budget cannot cover every primary pair.");
	}
	const plan: CampaignPlan = {
		schemaVersion: 1,
		planId: "paired-value-v1",
		planSha256: `sha256:${"0".repeat(64)}`,
		randomizationSeed: input.randomizationSeed,
		cells,
		abortPolicy: {
			retry: "whole-pair",
			maxReplacementBlocks: primaryPairs * input.reservePairsPerBlock,
		},
		stoppingRule: { kind: "fixed-complete-pairs", count: primaryPairs },
		analysis: {
			kind: "paired",
			primaryOutcome: "hidden-correctness",
			estimand: "candidate-minus-baseline-risk-difference",
			interval: "task-stratified-paired-bootstrap",
			alpha: 0.05,
			targetPower: 0.8,
			minimumDetectableEffect: 0.2,
			tieRule: "zero-difference",
			bootstrapSeed: canonicalSha256(
				"flow-paired-bootstrap-seed-v1",
				input.randomizationSeed,
			),
			versionSha256: PAIRED_ANALYSIS_VERSION_SHA256,
		},
		budget: input.budget,
	};
	plan.planSha256 = campaignPlanSha256(plan);
	const parsedPlan = CampaignPlanSchema.safeParse(plan);
	if (!parsedPlan.success) throw new Error("Generated paired plan is invalid.");
	const secret: AllocationSecret = {
		schemaVersion: 1,
		planSha256: plan.planSha256,
		nonce: input.commitmentNonce,
		blocks: allocations,
	};
	return {
		plan,
		secret,
		allocationCommitmentSha256: allocationCommitmentSha256(secret),
	};
}

export function pairedBlocks(plan: {
	readonly cells: readonly ExperimentCell[];
}): readonly ExperimentBlock[] {
	const grouped = new Map<string, ExperimentCell[]>();
	for (const cell of plan.cells) {
		grouped.set(cell.blockId, [...(grouped.get(cell.blockId) ?? []), cell]);
	}
	return [...grouped.entries()].map(([currentBlockId, cells]) => {
		const first = cells[0];
		const second = cells[1];
		if (!first || !second || cells.length !== 2) {
			throw new Error(`Invalid experiment block ${currentBlockId}.`);
		}
		return {
			blockId: currentBlockId,
			caseId: first.caseId,
			caseVersion: first.caseVersion,
			repetition: first.repetition,
			schedule: first.schedule,
			cells: [first, second],
		};
	});
}

export function armForCell(
	secret: AllocationSecret,
	cell: ExperimentCell,
): Arm {
	const parsed = AllocationSecretSchema.safeParse(secret);
	if (!parsed.success) throw new Error("Allocation secret is invalid.");
	const block = parsed.data.blocks.find(
		(entry) => entry.blockId === cell.blockId,
	);
	const arm = cell.armToken ? block?.tokenToArm[cell.armToken] : undefined;
	if (!arm) throw new Error("Plan cell is absent from the allocation secret.");
	return arm;
}

export function scanPairedTranscript(text: string): TranscriptScan {
	const markers = [
		{
			code: "reserved-arm-label",
			pattern:
				/\b(candidate\s+(?:(?:and|versus|vs\.?)\s+)?baseline|baseline\s+(?:(?:and|versus|vs\.?)\s+)?candidate|candidate arm|baseline arm|candidate allocation|baseline allocation|ordinary control|flow candidate|control arm|treatment arm)\b/i,
		},
		{
			code: "ground-truth-surface",
			pattern: /\b(ground.?truth|hidden.?correctness|hidden.?grader)\b/i,
		},
		{
			code: "evaluator-source",
			pattern: /(?:evals\/|benchmarks\.ts|\bgrade\s*\()/i,
		},
		{
			code: "measurement-marker",
			pattern: /BENCHMARK_STATUS|paired benchmark/i,
		},
	];
	const findings = markers.flatMap((marker) =>
		marker.pattern.test(text) ? [marker.code] : [],
	);
	const transcriptSha256 = `sha256:${createHash("sha256")
		.update(text, "utf8")
		.digest("hex")}`;
	const base = {
		schemaVersion: 1 as const,
		versionSha256: SCANNER_VERSION_SHA256,
		transcriptSha256,
		passed: findings.length === 0,
		findings,
	};
	return {
		...base,
		sha256: canonicalSha256("flow-paired-transcript-scan-v1", base),
	};
}

function slotKey(input: {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly repetition: number;
}): string {
	return `${input.caseId}\u0000${input.caseVersion}\u0000${input.repetition}`;
}

function observations(report: ValidatedReport): {
	readonly complete: readonly MaskedPairObservation[];
	readonly unresolved: number;
} {
	const activated = new Set(report.completion.activatedReserveCellIds);
	const attempts = new Map(
		report.attempts.map((attempt) => [attempt.cellId, attempt]),
	);
	const bySlot = new Map<string, ExperimentBlock[]>();
	for (const block of pairedBlocks(report.plan)) {
		if (
			block.schedule === "replacement-reserve" &&
			!block.cells.every((cell) => activated.has(cell.cellId))
		) {
			continue;
		}
		const key = slotKey(block);
		bySlot.set(key, [...(bySlot.get(key) ?? []), block]);
	}
	const complete: MaskedPairObservation[] = [];
	let unresolved = 0;
	for (const blocks of bySlot.values()) {
		let selected: MaskedPairObservation | null = null;
		for (const block of blocks) {
			const outcomes = block.cells.map((cell) => {
				const attempt = attempts.get(cell.cellId);
				return attempt?.outcome.kind === "product" &&
					attempt.outcome.evidence.kind === "paired-value"
					? attempt.outcome.evidence.hiddenCorrectness
					: null;
			});
			const firstToken = block.cells[0].armToken;
			const secondToken = block.cells[1].armToken;
			if (
				outcomes[0] !== null &&
				outcomes[0] !== undefined &&
				outcomes[1] !== null &&
				outcomes[1] !== undefined &&
				firstToken !== null &&
				secondToken !== null
			) {
				selected = {
					blockId: block.blockId,
					caseId: block.caseId,
					caseVersion: block.caseVersion,
					repetition: block.repetition,
					armTokens: [firstToken, secondToken],
					outcomes: [outcomes[0], outcomes[1]],
				};
				break;
			}
		}
		if (selected) complete.push(selected);
		else unresolved += 1;
	}
	return { complete, unresolved };
}

function macroDifference(values: readonly MaskedPairObservation[]): number {
	const byTask = new Map<string, MaskedPairObservation[]>();
	for (const pair of values) {
		const key = `${pair.caseId}\u0000${pair.caseVersion}`;
		byTask.set(key, [...(byTask.get(key) ?? []), pair]);
	}
	const taskMeans = [...byTask.values()].map(
		(pairs) =>
			pairs.reduce(
				(sum, pair) =>
					sum + Number(pair.outcomes[0]) - Number(pair.outcomes[1]),
				0,
			) / pairs.length,
	);
	return taskMeans.reduce((sum, value) => sum + value, 0) / taskMeans.length;
}

export function taskStratifiedPairedBootstrap(input: {
	readonly observations: readonly MaskedPairObservation[];
	readonly seed: string;
	readonly samples?: number;
}): {
	readonly estimate: number | null;
	readonly interval95: readonly [number, number] | null;
} {
	const sampleCount = input.samples ?? PAIRED_BOOTSTRAP_SAMPLES;
	if (
		!Number.isSafeInteger(sampleCount) ||
		sampleCount < 1 ||
		sampleCount > 100_000
	) {
		throw new Error("Bootstrap samples must be a positive bounded integer.");
	}
	if (input.observations.length === 0)
		return { estimate: null, interval95: null };
	const byTask = new Map<string, MaskedPairObservation[]>();
	for (const pair of input.observations) {
		const key = `${pair.caseId}\u0000${pair.caseVersion}`;
		byTask.set(key, [...(byTask.get(key) ?? []), pair]);
	}
	const draw = seededRandom(input.seed);
	const samples: number[] = [];
	for (let sample = 0; sample < sampleCount; sample += 1) {
		const selected: MaskedPairObservation[] = [];
		for (const pairs of byTask.values()) {
			for (let index = 0; index < pairs.length; index += 1) {
				const pair = pairs[Math.floor(draw() * pairs.length)];
				if (!pair) throw new Error("Bootstrap stratum is empty.");
				selected.push(pair);
			}
		}
		samples.push(macroDifference(selected));
	}
	samples.sort((left, right) => left - right);
	const lower = samples[Math.floor((samples.length - 1) * 0.025)];
	const upper = samples[Math.ceil((samples.length - 1) * 0.975)];
	if (lower === undefined || upper === undefined)
		throw new Error("Bootstrap produced no samples.");
	return {
		estimate: macroDifference(input.observations),
		interval95: [lower, upper],
	};
}

function policyReasons(report: ValidatedReport): string[] {
	if (report.plan.analysis.kind !== "paired") return ["policy-kind-invalid"];
	return report.plan.analysis.versionSha256 === PAIRED_ANALYSIS_VERSION_SHA256
		? []
		: ["policy-version-invalid"];
}

function scanSha256(scan: TranscriptScan): string {
	const { sha256: _sha256, ...withoutHash } = scan;
	return canonicalSha256("flow-paired-transcript-scan-v1", withoutHash);
}

function scanBindingsMatch(
	report: ValidatedReport,
	scans: readonly TranscriptScan[],
): boolean {
	const transcripts = report.attempts
		.flatMap((attempt) =>
			attempt.transcript ? [attempt.transcript.sha256] : [],
		)
		.sort();
	const scanned = scans.map((scan) => scan.transcriptSha256).sort();
	return canonicalJson(transcripts) === canonicalJson(scanned);
}

function maskedBase(input: {
	readonly report: ValidatedReport;
	readonly scans: readonly TranscriptScan[];
	readonly frozenAt: string;
}): Omit<MaskedAnalysisRecord, "sha256"> {
	if (
		input.report.plan.analysis.kind !== "paired" ||
		!input.report.allocationCommitmentSha256
	) {
		throw new Error("Masked analysis requires a paired report and commitment.");
	}
	const selected = observations(input.report);
	const bootstrap = taskStratifiedPairedBootstrap({
		observations: selected.complete,
		seed: input.report.plan.analysis.bootstrapSeed,
	});
	const primaryPairs = new Set(
		input.report.plan.cells
			.filter((cell) => cell.schedule === "primary")
			.map((cell) => cell.blockId),
	).size;
	const required = requiredPairedPowerPairs(input.report.plan.analysis);
	const power: PowerMetadata = {
		method: "conservative-bounded-pair",
		plannedPairs: primaryPairs,
		requiredPairs: required,
		targetPower: input.report.plan.analysis.targetPower,
		minimumDetectableEffect: input.report.plan.analysis.minimumDetectableEffect,
		sufficient: primaryPairs >= required,
	};
	const scansValid = input.scans.every(
		(scan) =>
			TranscriptScanSchema.safeParse(scan).success &&
			scan.sha256 === scanSha256(scan),
	);
	const bindingMatches = scanBindingsMatch(input.report, input.scans);
	const scannerPassed =
		scansValid && bindingMatches && input.scans.every((scan) => scan.passed);
	const gateReasons = [
		...(input.report.completion.status === "complete"
			? []
			: ["report-incomplete"]),
		...(selected.unresolved === 0 ? [] : ["unresolved-pairs"]),
		...(scansValid && input.scans.every((scan) => scan.passed)
			? []
			: ["scan-failed"]),
		...(bindingMatches ? [] : ["scan-binding-mismatch"]),
		...policyReasons(input.report),
		...(power.sufficient ? [] : ["power-insufficient"]),
	];
	return {
		schemaVersion: 1 as const,
		reportId: input.report.reportId,
		planSha256: input.report.plan.planSha256,
		reportSha256: pairedReportSha256(input.report),
		allocationCommitmentSha256: input.report.allocationCommitmentSha256,
		analysisPolicySha256: canonicalSha256(
			"flow-paired-policy-v1",
			input.report.plan.analysis,
		),
		observations: selected.complete,
		completePairs: selected.complete.length,
		unresolvedPairs: selected.unresolved,
		ties: selected.complete.filter(
			(pair) => pair.outcomes[0] === pair.outcomes[1],
		).length,
		opaqueEstimate: bootstrap.estimate,
		interval95: bootstrap.interval95,
		power,
		scannerSha256: canonicalSha256("flow-paired-scans-v1", input.scans),
		scannerPassed,
		scans: input.scans,
		gateReasons,
		claimEligible: gateReasons.length === 0,
		treatmentBlinding: "flow-tool-presence-visible" as const,
		frozenAt: input.frozenAt,
	};
}

export function freezeMaskedAnalysis(input: {
	readonly report: ValidatedReport;
	readonly scans: readonly TranscriptScan[];
	readonly frozenAt: string;
}): MaskedAnalysisRecord {
	const base = maskedBase(input);
	const record: MaskedAnalysisRecord = {
		...base,
		sha256: canonicalSha256("flow-masked-analysis-v1", base),
	};
	const parsed = MaskedAnalysisRecordSchema.safeParse(record);
	if (!parsed.success || canonicalJson(record).match(/candidate|baseline/i)) {
		throw new Error(
			"Masked analysis record is invalid or leaks allocation labels.",
		);
	}
	return record;
}

export function validateMaskedAnalysis(
	report: ValidatedReport,
	record: MaskedAnalysisRecord,
): boolean {
	const parsed = MaskedAnalysisRecordSchema.safeParse(record);
	if (!parsed.success || record.sha256 !== maskedAnalysisSha256(record)) {
		return false;
	}
	const expected = freezeMaskedAnalysis({
		report,
		scans: record.scans,
		frozenAt: record.frozenAt,
	});
	return canonicalJson(expected) === canonicalJson(record);
}

function isOrdinaryArtifact(
	artifact: ArtifactIdentity | { readonly kind: "ordinary-opencode" },
): boolean {
	return "kind" in artifact && artifact.kind === "ordinary-opencode";
}

function validateRevealBindings(input: {
	readonly report: ValidatedReport;
	readonly masked: MaskedAnalysisRecord;
	readonly secret: AllocationSecret;
}): void {
	if (
		!validateMaskedAnalysis(input.report, input.masked) ||
		input.masked.sha256 !== maskedAnalysisSha256(input.masked) ||
		input.masked.reportId !== input.report.reportId ||
		input.masked.reportSha256 !== pairedReportSha256(input.report) ||
		input.masked.planSha256 !== input.report.plan.planSha256 ||
		input.secret.planSha256 !== input.report.plan.planSha256 ||
		input.masked.allocationCommitmentSha256 !==
			allocationCommitmentSha256(input.secret) ||
		input.masked.allocationCommitmentSha256 !==
			input.report.allocationCommitmentSha256
	) {
		throw new Error(
			"Reveal does not bind the exact plan, report, masked record, and allocation.",
		);
	}
	const secret = AllocationSecretSchema.safeParse(input.secret);
	if (!secret.success) throw new Error("Allocation secret is invalid.");
	const planBlocks = pairedBlocks(input.report.plan);
	if (planBlocks.length !== secret.data.blocks.length) {
		throw new Error("Allocation does not cover every planned block.");
	}
	for (const block of planBlocks) {
		const allocated = secret.data.blocks.find(
			(entry) => entry.blockId === block.blockId,
		);
		if (
			!allocated ||
			allocated.caseId !== block.caseId ||
			allocated.caseVersion !== block.caseVersion ||
			allocated.repetition !== block.repetition ||
			canonicalJson([...allocated.tokens].sort()) !==
				canonicalJson(block.cells.map((cell) => cell.armToken).sort())
		) {
			throw new Error("Allocation does not match every planned block.");
		}
	}
	for (const attempt of input.report.attempts) {
		const block = secret.data.blocks.find(
			(entry) => entry.blockId === attempt.blockId,
		);
		const arm = attempt.armToken
			? block?.tokenToArm[attempt.armToken]
			: undefined;
		if (!arm || (arm === "baseline") !== isOrdinaryArtifact(attempt.artifact)) {
			throw new Error(
				"Attempt artifacts do not match the revealed allocation.",
			);
		}
	}
}

function directedObservations(
	masked: MaskedAnalysisRecord,
	secret: AllocationSecret,
): MaskedPairObservation[] {
	return masked.observations.map((observation) => {
		const block = secret.blocks.find(
			(entry) => entry.blockId === observation.blockId,
		);
		if (!block)
			throw new Error("Masked observation is absent from allocation.");
		const candidateFirst =
			block.tokenToArm[observation.armTokens[0]] === "candidate";
		return {
			...observation,
			outcomes: candidateFirst
				? observation.outcomes
				: [observation.outcomes[1], observation.outcomes[0]],
		};
	});
}

export function revealPairedAnalysis(input: {
	readonly report: ValidatedReport;
	readonly masked: MaskedAnalysisRecord;
	readonly secret: AllocationSecret;
	readonly revealedAt: string;
}): {
	readonly allocation: AllocationRecord;
	readonly decision: PairedDecision;
} {
	validateRevealBindings(input);
	const allocation: AllocationRecord = {
		schemaVersion: 1,
		reportId: input.report.reportId,
		planSha256: input.report.plan.planSha256,
		reportSha256: pairedReportSha256(input.report),
		maskedAnalysisSha256: input.masked.sha256,
		allocationCommitmentSha256: allocationCommitmentSha256(input.secret),
		nonce: input.secret.nonce,
		blocks: input.secret.blocks,
		revealedAt: input.revealedAt,
	};
	if (!AllocationRecordSchema.safeParse(allocation).success) {
		throw new Error("Allocation record is invalid.");
	}
	const directed = directedObservations(input.masked, input.secret);
	const estimate = taskStratifiedPairedBootstrap({
		observations: directed,
		seed:
			input.report.plan.analysis.kind === "paired"
				? input.report.plan.analysis.bootstrapSeed
				: "invalid",
	});
	const candidateWins = directed.filter(
		(pair) => pair.outcomes[0] && !pair.outcomes[1],
	).length;
	const baselineWins = directed.filter(
		(pair) => !pair.outcomes[0] && pair.outcomes[1],
	).length;
	const reasons = [...input.masked.gateReasons];
	if (
		estimate.interval95 &&
		input.report.plan.analysis.kind === "paired" &&
		estimate.interval95[1] - estimate.interval95[0] >
			2 * input.report.plan.analysis.minimumDetectableEffect
	) {
		reasons.push("interval-too-wide");
	}
	let claim: PairedDecision["claim"] = "inconclusive";
	if (
		input.masked.claimEligible &&
		reasons.length === 0 &&
		estimate.interval95
	) {
		if (estimate.interval95[0] > 0) claim = "candidate-better";
		else if (estimate.interval95[1] < 0) claim = "candidate-worse";
		else reasons.push("interval-crosses-zero");
	} else if (estimate.interval95 === null) {
		reasons.push("interval-unavailable");
	}
	return {
		allocation,
		decision: {
			claim,
			reasons,
			candidateMinusBaseline: estimate.estimate,
			interval95: estimate.interval95,
			candidateWins,
			baselineWins,
			ties: input.masked.ties,
			power: input.masked.power,
		},
	};
}
