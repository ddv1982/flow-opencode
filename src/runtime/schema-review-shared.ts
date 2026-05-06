import { z } from "zod";
import {
	FINAL_REVIEW_POLICIES,
	FINAL_REVIEW_SURFACES,
	REVIEW_FINDING_CLOSURE_STATUSES,
	REVIEW_STATUSES,
} from "./constants";
import {
	isSafeReviewArtifactPath,
	isSafeReviewArtifactRef,
	normalizeArtifactPath,
	normalizeReviewArtifactRef,
} from "./domain/final-review-coverage-paths";
import { REVIEW_DISCOVERY_REASONS } from "./domain/review-content-discovery";

export const FollowUpSchema = z.object({
	summary: z.string().min(1),
	severity: z.string().min(1).optional(),
});

export const ReviewFindingClosureSchema = z
	.object({
		findingRef: z.string().min(1),
		status: z.enum(REVIEW_FINDING_CLOSURE_STATUSES),
		fixRefs: z.array(z.string().min(1)).default([]),
		testRefs: z.array(z.string().min(1)).default([]),
		validationRefs: z.array(z.string().min(1)).default([]),
		residualRisk: z.string().min(1),
	})
	.strict();

export const ReviewFindingSchema = z.object({
	summary: z.string().min(1),
});

export const ReviewDepthSchema = z.enum(FINAL_REVIEW_POLICIES);
export const ReviewSurfaceSchema = z.enum(FINAL_REVIEW_SURFACES);

export const FinalReviewEvidenceRefsInputSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)),
		validationCommands: z.array(z.string().min(1)),
	})
	.strict();

export const FinalReviewEvidenceRefsPersistedSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)).default([]),
		validationCommands: z.array(z.string().min(1)).default([]),
	})
	.strict()
	.default({ changedArtifacts: [], validationCommands: [] });

export const FinalReviewEvidenceRefsSchema =
	FinalReviewEvidenceRefsPersistedSchema;

export const BehaviorRiskClassSchema = z.enum([
	"async_event_ordering",
	"lifecycle_reentrancy",
	"state_commit_rollback",
	"persistence_recovery",
	"interaction_geometry",
	"accessibility_semantics",
	"test_oracle_authenticity",
]);

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);
const SafeReviewRefSchema = NonEmptyTrimmedStringSchema.transform(
	normalizeReviewArtifactRef,
).refine(isSafeReviewArtifactRef, {
	message: "must be a safe relative path reference",
});
const SafeReviewPathSchema = NonEmptyTrimmedStringSchema.transform(
	normalizeArtifactPath,
).refine(isSafeReviewArtifactPath, {
	message: "must be a safe relative path",
});

export const BehaviorCheckResultSchema = z.enum([
	"passed",
	"gap_recorded",
	"not_applicable",
	"needs_fix",
]);

const behaviorCheckShape = {
	riskClass: BehaviorRiskClassSchema,
	result: BehaviorCheckResultSchema,
	invariant: z.string().min(1),
	entrypointRefs: z.array(z.string().min(1)).default([]),
	stateOwnerRefs: z.array(z.string().min(1)).default([]),
	lifecycleOwnerRefs: z.array(z.string().min(1)).default([]),
	failurePath: z.string().min(1),
	oracleRefs: z.array(z.string().min(1)).default([]),
	validationRefs: z.array(z.string().min(1)).default([]),
	remainingGap: z.string().min(1).optional(),
} as const;

function addGapRecordedRemainingGapIssue(
	value: { result: string; remainingGap?: string | undefined },
	context: z.RefinementCtx,
): void {
	if (value.result === "gap_recorded" && !value.remainingGap?.trim()) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["remainingGap"],
			message: "gap_recorded behavior checks must include remainingGap.",
		});
	}
}

export const BehaviorCheckSchema = z
	.object(behaviorCheckShape)
	.strict()
	.superRefine(addGapRecordedRemainingGapIssue);

const runtimeBehaviorCheckShape = {
	...behaviorCheckShape,
	entrypointRefs: z.array(SafeReviewRefSchema).default([]),
	stateOwnerRefs: z.array(SafeReviewRefSchema).default([]),
	lifecycleOwnerRefs: z.array(SafeReviewRefSchema).default([]),
	oracleRefs: z.array(SafeReviewRefSchema).default([]),
} as const;

export const RuntimeBehaviorCheckSchema = z
	.object(runtimeBehaviorCheckShape)
	.strict()
	.superRefine(addGapRecordedRemainingGapIssue);

const validationCoverageShape = {
	command: z.string().min(1),
	behaviorClasses: z.array(BehaviorRiskClassSchema).default([]),
	proves: z.array(z.string().min(1)).default([]),
	gaps: z.array(z.string().min(1)).default([]),
	oracleRefs: z.array(z.string().min(1)).default([]),
} as const;

export const ValidationCoverageSchema = z
	.object(validationCoverageShape)
	.strict();

export const RuntimeValidationCoverageSchema = z
	.object({
		...validationCoverageShape,
		oracleRefs: z.array(SafeReviewRefSchema).default([]),
	})
	.strict();

export const ReviewContextPackSchema = z
	.object({
		task: NonEmptyTrimmedStringSchema,
		compareBase: NonEmptyTrimmedStringSchema.optional(),
		changedFiles: z.array(SafeReviewPathSchema).default([]),
		includedContext: z
			.array(
				z
					.object({
						path: SafeReviewPathSchema,
						reason: z.enum(REVIEW_DISCOVERY_REASONS),
						surface: ReviewSurfaceSchema.optional(),
						summary: NonEmptyTrimmedStringSchema.optional(),
					})
					.strict(),
			)
			.default([]),
		relationships: z
			.array(
				z
					.object({
						from: SafeReviewPathSchema,
						to: SafeReviewPathSchema,
						kind: NonEmptyTrimmedStringSchema,
						summary: NonEmptyTrimmedStringSchema,
					})
					.strict(),
			)
			.default([]),
		validationEvidence: z
			.array(
				z
					.object({
						command: NonEmptyTrimmedStringSchema,
						status: NonEmptyTrimmedStringSchema.optional(),
						summary: NonEmptyTrimmedStringSchema.optional(),
					})
					.strict(),
			)
			.default([]),
		suggestedValidation: z.array(NonEmptyTrimmedStringSchema).default([]),
		coverageGaps: z.array(NonEmptyTrimmedStringSchema).default([]),
		reviewedSurfaces: z.array(ReviewSurfaceSchema).default([]),
	})
	.strict();

export const ReviewSchema = z.object({
	status: z.enum(REVIEW_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
});

const finalReviewCommonShape = {
	reviewDepth: ReviewDepthSchema,
	reviewedSurfaces: z.array(ReviewSurfaceSchema).default([]),
	evidenceSummary: z.string().min(1).optional(),
	validationAssessment: z.string().min(1).optional(),
	integrationChecks: z.array(z.string().min(1)).default([]),
	regressionChecks: z.array(z.string().min(1)).default([]),
	remainingGaps: z.array(z.string().min(1)).default([]),
	suggestedValidation: z.array(z.string().min(1)).optional(),
	reviewContextPack: ReviewContextPackSchema.optional(),
} as const;

export const finalReviewInputSharedShape = {
	...finalReviewCommonShape,
	evidenceRefs: FinalReviewEvidenceRefsInputSchema,
	behaviorChecks: z.array(RuntimeBehaviorCheckSchema).optional(),
	validationCoverage: z.array(RuntimeValidationCoverageSchema).optional(),
} as const;

export const finalReviewPersistedSharedShape = {
	...finalReviewCommonShape,
	evidenceRefs: FinalReviewEvidenceRefsPersistedSchema,
	behaviorChecks: z.array(BehaviorCheckSchema).optional(),
	validationCoverage: z.array(ValidationCoverageSchema).optional(),
} as const;

export const finalReviewSharedShape = finalReviewPersistedSharedShape;
