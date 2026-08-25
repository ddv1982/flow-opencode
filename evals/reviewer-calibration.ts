import { z } from "zod";
import { canonicalSha256 } from "./canonical-json.js";
import type { ValidatedCaseCatalog } from "./catalog.js";
import type {
	ArtifactIdentity,
	ModelIdentity,
	ValidatedReport,
} from "./report.js";
import {
	type HumanLabel,
	REVIEWER_CASES,
	type ReviewerTruth,
} from "./reviewer-cases.js";

export type ReviewerObservation = {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly truth: ReviewerTruth;
	readonly verdict: "passed" | "failed" | null;
	readonly submitted: boolean;
};

export type WilsonInterval = readonly [number, number];

export type ReviewerConfusionMatrix = {
	readonly truePositives: number;
	readonly falseNegatives: number;
	readonly falsePositives: number;
	readonly trueNegatives: number;
	readonly unsubmitted: number;
};

export type ReviewerCalibrationAnalysis = {
	readonly matrix: ReviewerConfusionMatrix;
	readonly defectCases: number;
	readonly cleanCases: number;
	readonly detectionRate: number | null;
	readonly detectionInterval95: WilsonInterval | null;
	readonly falsePositiveRate: number | null;
	readonly falsePositiveInterval95: WilsonInterval | null;
};

export type LabelAssignment = HumanLabel & {
	readonly caseId: string;
	readonly caseVersion: number;
};

export type ReviewerPromotionRecord = {
	readonly schemaVersion: 1;
	readonly planSha256: string;
	readonly calibrationReportSha256: string;
	readonly caseCatalogSha256: string;
	readonly humanLabelsSha256: string;
	readonly artifactSha256: string;
	readonly reviewerModels: readonly ModelIdentity[];
	readonly defectCases: number;
	readonly cleanCases: number;
	readonly ratersPerCase: number;
	readonly agreement: {
		readonly method: "krippendorff-alpha";
		readonly value: number;
		readonly minimum: number;
	};
	readonly observed: {
		readonly detectionRate: number;
		readonly detectionInterval95: WilsonInterval;
		readonly falsePositiveRate: number;
		readonly falsePositiveInterval95: WilsonInterval;
	};
	readonly minimumDetectionRate: number;
	readonly maximumFalsePositiveRate: number;
	readonly recordedAt: string;
};

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const TextSchema = z.string().min(1).max(4096).regex(/\S/);
const ModelIdentitySchema = z
	.object({
		routeProvider: TextSchema,
		gateway: TextSchema.nullable(),
		family: TextSchema,
		model: TextSchema,
		revision: TextSchema.nullable(),
	})
	.strict();
export const ReviewerPromotionRecordSchema = z
	.object({
		schemaVersion: z.literal(1),
		planSha256: DigestSchema,
		calibrationReportSha256: DigestSchema,
		caseCatalogSha256: DigestSchema,
		humanLabelsSha256: DigestSchema,
		artifactSha256: DigestSchema,
		reviewerModels: z.array(ModelIdentitySchema).min(1),
		defectCases: z.number().int().positive(),
		cleanCases: z.number().int().positive(),
		ratersPerCase: z.number().int().min(2),
		agreement: z
			.object({
				method: z.literal("krippendorff-alpha"),
				value: z.number().finite().min(-1).max(1),
				minimum: z.number().finite().min(0).max(1),
			})
			.strict(),
		observed: z
			.object({
				detectionRate: z.number().finite().min(0).max(1),
				detectionInterval95: z.tuple([
					z.number().min(0).max(1),
					z.number().min(0).max(1),
				]),
				falsePositiveRate: z.number().finite().min(0).max(1),
				falsePositiveInterval95: z.tuple([
					z.number().min(0).max(1),
					z.number().min(0).max(1),
				]),
			})
			.strict(),
		minimumDetectionRate: z.number().finite().min(0).max(1),
		maximumFalsePositiveRate: z.number().finite().min(0).max(1),
		recordedAt: z.string().datetime({ offset: true }),
	})
	.strict()
	.superRefine((record, context) => {
		for (const [name, interval] of [
			["detectionInterval95", record.observed.detectionInterval95],
			["falsePositiveInterval95", record.observed.falsePositiveInterval95],
		] as const) {
			if (interval[0] > interval[1]) {
				context.addIssue({
					code: "custom",
					path: ["observed", name],
					message: "Interval lower bound must not exceed its upper bound.",
				});
			}
		}
		if (record.agreement.value < record.agreement.minimum) {
			context.addIssue({
				code: "custom",
				message: "Agreement misses its promotion minimum.",
			});
		}
		if (record.observed.detectionInterval95[0] < record.minimumDetectionRate) {
			context.addIssue({
				code: "custom",
				message: "Detection lower bound misses its promotion minimum.",
			});
		}
		if (
			record.observed.falsePositiveInterval95[1] >
			record.maximumFalsePositiveRate
		) {
			context.addIssue({
				code: "custom",
				message: "False-positive upper bound exceeds its promotion maximum.",
			});
		}
	});

function wilson(successes: number, total: number): WilsonInterval | null {
	if (total === 0) return null;
	const zValue = 1.959963984540054;
	const rate = successes / total;
	const square = zValue * zValue;
	const denominator = 1 + square / total;
	const center = (rate + square / (2 * total)) / denominator;
	const margin =
		(zValue / denominator) *
		Math.sqrt((rate * (1 - rate) + square / (4 * total)) / total);
	return [center - margin, center + margin];
}

export function analyzeReviewerCalibration(
	observations: readonly ReviewerObservation[],
): ReviewerCalibrationAnalysis {
	let truePositives = 0;
	let falseNegatives = 0;
	let falsePositives = 0;
	let trueNegatives = 0;
	let unsubmitted = 0;
	for (const observation of observations) {
		if (!observation.submitted || observation.verdict === null) {
			unsubmitted += 1;
			continue;
		}
		if (observation.truth === "defect") {
			if (observation.verdict === "failed") truePositives += 1;
			else falseNegatives += 1;
		} else if (observation.verdict === "failed") falsePositives += 1;
		else trueNegatives += 1;
	}
	const defectCases = truePositives + falseNegatives;
	const cleanCases = falsePositives + trueNegatives;
	return {
		matrix: {
			truePositives,
			falseNegatives,
			falsePositives,
			trueNegatives,
			unsubmitted,
		},
		defectCases,
		cleanCases,
		detectionRate: defectCases === 0 ? null : truePositives / defectCases,
		detectionInterval95: wilson(truePositives, defectCases),
		falsePositiveRate: cleanCases === 0 ? null : falsePositives / cleanCases,
		falsePositiveInterval95: wilson(falsePositives, cleanCases),
	};
}

export function krippendorffNominalAlpha(
	labels: readonly LabelAssignment[],
): number | null {
	const byCase = new Map<string, LabelAssignment[]>();
	for (const label of labels) {
		const key = `${label.caseId}\u0000${label.caseVersion}`;
		const values = byCase.get(key) ?? [];
		values.push(label);
		byCase.set(key, values);
	}
	let observedPairs = 0;
	let disagreements = 0;
	const categories = new Map<ReviewerTruth, number>();
	let total = 0;
	for (const values of byCase.values()) {
		for (const value of values) {
			categories.set(value.truth, (categories.get(value.truth) ?? 0) + 1);
			total += 1;
		}
		for (const left of values) {
			for (const right of values) {
				if (left.raterId === right.raterId) continue;
				observedPairs += 1;
				if (left.truth !== right.truth) disagreements += 1;
			}
		}
	}
	if (observedPairs === 0 || total < 2) return null;
	const expectedAgreement =
		[...categories.values()].reduce(
			(sum, count) => sum + count * (count - 1),
			0,
		) /
		(total * (total - 1));
	const expectedDisagreement = 1 - expectedAgreement;
	if (expectedDisagreement === 0) return 1;
	return 1 - disagreements / observedPairs / expectedDisagreement;
}

function reviewerObservations(
	report: ValidatedReport,
): readonly ReviewerObservation[] {
	return report.attempts.flatMap((attempt) =>
		attempt.outcome.kind === "product" &&
		attempt.outcome.evidence.kind === "reviewer-only"
			? [
					{
						caseId: attempt.caseId,
						caseVersion: attempt.caseVersion,
						truth: attempt.outcome.evidence.truth,
						verdict: attempt.outcome.evidence.verdict,
						submitted: attempt.outcome.evidence.submitted,
					},
				]
			: [],
	);
}

function orderedLabels(
	labels: readonly LabelAssignment[],
): readonly LabelAssignment[] {
	return [...labels].sort((left, right) => {
		const leftKey = [
			left.caseId,
			String(left.caseVersion),
			left.raterId,
			left.truth,
		].join("\u0000");
		const rightKey = [
			right.caseId,
			String(right.caseVersion),
			right.raterId,
			right.truth,
		].join("\u0000");
		return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
	});
}

export function createReviewerPromotion(input: {
	readonly mode: "pilot" | "promotion";
	readonly report: ValidatedReport;
	readonly catalog: ValidatedCaseCatalog;
	readonly labels: readonly LabelAssignment[];
	readonly artifact: ArtifactIdentity;
	readonly reviewerModels: readonly ModelIdentity[];
	readonly minimumDetectionRate: number;
	readonly maximumFalsePositiveRate: number;
	readonly minimumCasesPerTruth: number;
	readonly recordedAt: string;
}):
	| {
			readonly kind: "advisory";
			readonly analysis: ReviewerCalibrationAnalysis;
			readonly reasons: readonly string[];
	  }
	| { readonly kind: "promotion"; readonly record: ReviewerPromotionRecord } {
	const observations = reviewerObservations(input.report);
	const analysis = analyzeReviewerCalibration(observations);
	const alpha = krippendorffNominalAlpha(input.labels);
	const labelsByCase = new Map<string, Set<string>>();
	const labelAssignments = new Set<string>();
	let duplicateRater = false;
	for (const label of input.labels) {
		const key = `${label.caseId}\u0000${label.caseVersion}`;
		const assignment = `${key}\u0000${label.raterId}`;
		if (labelAssignments.has(assignment)) duplicateRater = true;
		labelAssignments.add(assignment);
		const raters = labelsByCase.get(key) ?? new Set<string>();
		raters.add(label.raterId);
		labelsByCase.set(key, raters);
	}
	const minimumRaters =
		labelsByCase.size === 0
			? 0
			: Math.min(...[...labelsByCase.values()].map((raters) => raters.size));
	const plannedCases = new Set(
		input.report.plan.cells.map(
			(cell) => `${cell.caseId}\u0000${cell.caseVersion}`,
		),
	);
	const labelsMatchPlan =
		plannedCases.size === labelsByCase.size &&
		[...plannedCases].every((key) => labelsByCase.has(key));
	const labelsMatchTruth = observations.every((observation) => {
		const key = `${observation.caseId}\u0000${observation.caseVersion}`;
		return input.labels
			.filter((label) => `${label.caseId}\u0000${label.caseVersion}` === key)
			.every((label) => label.truth === observation.truth);
	});
	const registeredLabels = REVIEWER_CASES.filter((entry) =>
		plannedCases.has(`${entry.caseId}\u0000${entry.caseVersion}`),
	).flatMap((entry) =>
		entry.humanLabels.map((label) => ({
			...label,
			caseId: entry.caseId,
			caseVersion: entry.caseVersion,
		})),
	);
	const labelsMatchRegistry =
		canonicalSha256(
			"flow-reviewer-human-labels-v1",
			orderedLabels(input.labels),
		) ===
		canonicalSha256(
			"flow-reviewer-human-labels-v1",
			orderedLabels(registeredLabels),
		);
	const observedReviewerModels = input.report.attempts.flatMap((attempt) =>
		attempt.outcome.kind === "product"
			? attempt.actors.flatMap((actor) =>
					actor.role === "reviewer" && actor.actualModel.kind === "observed"
						? [actor.actualModel.value]
						: [],
				)
			: [],
	);
	const reviewerIdentityComplete =
		observedReviewerModels.length === observations.length &&
		input.reviewerModels.length > 0 &&
		observedReviewerModels.every((observed) =>
			input.reviewerModels.some(
				(expected) =>
					canonicalSha256("flow-reviewer-model-v1", observed) ===
					canonicalSha256("flow-reviewer-model-v1", expected),
			),
		);
	const reasons = [
		...(input.mode === "pilot"
			? ["Pilot runs are advisory by definition."]
			: []),
		...(input.report.plan.analysis.kind !== "reviewer"
			? ["Calibration requires a reviewer campaign plan."]
			: []),
		...(input.report.completion.status !== "complete" ||
		input.report.completion.cause !== "fixed-target"
			? ["Calibration requires complete fixed-target execution."]
			: []),
		...(analysis.matrix.unsubmitted > 0
			? ["Calibration cannot contain unsubmitted reviewer outcomes."]
			: []),
		...(analysis.defectCases < input.minimumCasesPerTruth ||
		analysis.cleanCases < input.minimumCasesPerTruth
			? ["Both truth classes need the preregistered sample size."]
			: []),
		...(minimumRaters < 2
			? ["Every calibration case needs at least two immutable human labels."]
			: []),
		...(duplicateRater
			? ["A calibration case cannot reuse one human rater."]
			: []),
		...(!labelsMatchPlan
			? ["Human labels must name exactly the frozen calibration cases."]
			: []),
		...(!labelsMatchTruth
			? ["Human labels disagree with the executable fixed truth."]
			: []),
		...(!labelsMatchRegistry
			? ["Human labels do not match the preregistered immutable labels."]
			: []),
		...(alpha === null || alpha < 0.8
			? ["Krippendorff nominal alpha is below 0.8."]
			: []),
		...(analysis.detectionInterval95 === null ||
		analysis.detectionInterval95[0] < input.minimumDetectionRate
			? ["Detection lower bound misses its threshold."]
			: []),
		...(analysis.falsePositiveInterval95 === null ||
		analysis.falsePositiveInterval95[1] > input.maximumFalsePositiveRate
			? ["False-positive upper bound exceeds its threshold."]
			: []),
		...(!reviewerIdentityComplete
			? ["Every calibration outcome requires an observed reviewer identity."]
			: []),
		...(input.report.attempts.some(
			(attempt) =>
				canonicalSha256("flow-reviewer-artifact-v1", attempt.artifact) !==
				canonicalSha256("flow-reviewer-artifact-v1", input.artifact),
		)
			? ["Calibration artifact does not exactly match every attempt."]
			: []),
	];
	if (reasons.length > 0) return { kind: "advisory", analysis, reasons };
	const detectionInterval95 = analysis.detectionInterval95;
	const falsePositiveInterval95 = analysis.falsePositiveInterval95;
	const detectionRate = analysis.detectionRate;
	const falsePositiveRate = analysis.falsePositiveRate;
	if (
		!detectionInterval95 ||
		!falsePositiveInterval95 ||
		detectionRate === null ||
		falsePositiveRate === null ||
		alpha === null
	) {
		return {
			kind: "advisory",
			analysis,
			reasons: ["Calibration lacks a finite statistic."],
		};
	}
	const record = {
		schemaVersion: 1 as const,
		planSha256: input.report.plan.planSha256,
		calibrationReportSha256: canonicalSha256(
			"flow-reviewer-calibration-report-v1",
			input.report,
		),
		caseCatalogSha256: canonicalSha256(
			"flow-reviewer-calibration-catalog-v1",
			input.catalog,
		),
		humanLabelsSha256: canonicalSha256(
			"flow-reviewer-human-labels-v1",
			orderedLabels(input.labels),
		),
		artifactSha256: canonicalSha256(
			"flow-reviewer-artifact-v1",
			input.artifact,
		),
		reviewerModels: input.reviewerModels,
		defectCases: analysis.defectCases,
		cleanCases: analysis.cleanCases,
		ratersPerCase: minimumRaters,
		agreement: {
			method: "krippendorff-alpha" as const,
			value: alpha,
			minimum: 0.8,
		},
		observed: {
			detectionRate,
			detectionInterval95,
			falsePositiveRate,
			falsePositiveInterval95,
		},
		minimumDetectionRate: input.minimumDetectionRate,
		maximumFalsePositiveRate: input.maximumFalsePositiveRate,
		recordedAt: input.recordedAt,
	};
	const parsed = ReviewerPromotionRecordSchema.safeParse(record);
	if (!parsed.success)
		return {
			kind: "advisory",
			analysis,
			reasons: ["Promotion record failed strict validation."],
		};
	return { kind: "promotion", record };
}
