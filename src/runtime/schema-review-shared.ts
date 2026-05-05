import { z } from "zod";
import {
	FINAL_REVIEW_POLICIES,
	FINAL_REVIEW_SURFACES,
	REVIEW_FINDING_CLOSURE_STATUSES,
	REVIEW_STATUSES,
} from "./constants";
import {
	isSafeReviewArtifactPath,
	normalizeArtifactPath,
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

export const FinalReviewEvidenceRefsSchema = z
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

export const finalReviewSharedShape = {
	reviewDepth: ReviewDepthSchema,
	reviewedSurfaces: z.array(ReviewSurfaceSchema).default([]),
	evidenceSummary: z.string().min(1).optional(),
	validationAssessment: z.string().min(1).optional(),
	evidenceRefs: FinalReviewEvidenceRefsSchema,
	integrationChecks: z.array(z.string().min(1)).default([]),
	regressionChecks: z.array(z.string().min(1)).default([]),
	remainingGaps: z.array(z.string().min(1)).default([]),
	reviewContextPack: ReviewContextPackSchema.optional(),
} as const;
