import { z } from "zod";
import {
	FINAL_REVIEW_POLICIES,
	FINAL_REVIEW_SURFACES,
	REVIEW_FINDING_CLOSURE_STATUSES,
	REVIEW_SCOPE_ACCOUNTING_STATUSES,
	REVIEW_SCOPE_TARGET_KINDS,
	REVIEW_STATUSES,
} from "./constants";
import {
	isSafeReviewArtifactPath,
	normalizeArtifactPath,
} from "./domain/final-review-coverage-paths";
import {
	BehaviorCheckSchema,
	ReviewDiscoveryReasonSchema,
	RuntimeBehaviorCheckArraySchema,
	RuntimeValidationCoverageArraySchema,
	ValidationCoverageSchema,
} from "./schema-review-behavior";

export {
	BehaviorCheckSchema,
	ValidationCoverageSchema,
} from "./schema-review-behavior";

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

export const ReviewScopeTargetSchema = z
	.object({
		id: z.string().min(1),
		kind: z.enum(REVIEW_SCOPE_TARGET_KINDS),
		target: z.string().min(1),
		description: z.string().min(1).optional(),
	})
	.strict();

const ReviewScopeAccountingStatusSchema = z.enum(
	REVIEW_SCOPE_ACCOUNTING_STATUSES,
);

export const ReviewScopeLedgerEntrySchema = z
	.object({
		scopeId: z.string().min(1),
		status: ReviewScopeAccountingStatusSchema,
		evidenceRefs: z.array(z.string().min(1)).default([]),
		findingRefs: z.array(z.string().min(1)).optional(),
		validationRefs: z.array(z.string().min(1)).optional(),
		residualRisk: z.string().min(1),
		rationale: z.string().min(1).optional(),
	})
	.strict();

export const ReviewFindingSchema = z.object({
	summary: z.string().min(1),
});

const ReviewDepthSchema = z.enum(FINAL_REVIEW_POLICIES);
const ReviewSurfaceSchema = z.enum(FINAL_REVIEW_SURFACES);

const FinalReviewEvidenceRefsInputSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)),
		validationCommands: z.array(z.string().min(1)),
	})
	.strict();

const FinalReviewEvidenceRefsPersistedSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)).default([]),
		validationCommands: z.array(z.string().min(1)).default([]),
	})
	.strict()
	.default({ changedArtifacts: [], validationCommands: [] });

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);
const SafeReviewPathSchema = NonEmptyTrimmedStringSchema.transform(
	normalizeArtifactPath,
).refine(isSafeReviewArtifactPath, {
	message: "must be a safe relative path",
});

const ReviewContextPackSchema = z
	.object({
		task: NonEmptyTrimmedStringSchema,
		compareBase: NonEmptyTrimmedStringSchema.optional(),
		changedFiles: z.array(SafeReviewPathSchema).default([]),
		includedContext: z
			.array(
				z
					.object({
						path: SafeReviewPathSchema,
						reason: ReviewDiscoveryReasonSchema,
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
	integrationChecks: z.array(NonEmptyTrimmedStringSchema).default([]),
	regressionChecks: z.array(NonEmptyTrimmedStringSchema).default([]),
	remainingGaps: z.array(z.string().min(1)).default([]),
	suggestedValidation: z.array(z.string().min(1)).optional(),
	reviewContextPack: ReviewContextPackSchema.optional(),
} as const;

export const finalReviewInputSharedShape = {
	...finalReviewCommonShape,
	evidenceRefs: FinalReviewEvidenceRefsInputSchema,
	behaviorChecks: RuntimeBehaviorCheckArraySchema.optional(),
	validationCoverage: RuntimeValidationCoverageArraySchema.optional(),
} as const;

export const finalReviewPersistedSharedShape = {
	...finalReviewCommonShape,
	evidenceRefs: FinalReviewEvidenceRefsPersistedSchema,
	behaviorChecks: z.array(BehaviorCheckSchema).optional(),
	validationCoverage: z.array(ValidationCoverageSchema).optional(),
} as const;
