import { z } from "zod";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	FINAL_REVIEW_POLICIES,
	FINAL_REVIEW_SURFACES,
	REVIEW_PURPOSES,
	REVIEWER_DECISION_STATUSES,
} from "./constants";
import {
	FinalReviewEvidenceRefsSchema,
	FinalReviewSchema,
	FollowUpSchema,
	ReviewFindingSchema,
} from "./schema-review-shared";

export { FinalReviewSchema };

const reviewerDecisionCommonShape = {
	reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
	status: z.enum(REVIEWER_DECISION_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
	followUps: z.array(FollowUpSchema).default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
} as const;

// Both decision shapes are non-strict so decisions persisted by Flow v2 (with
// reviewScopeLedger, behaviorChecks, reviewContextPack, ...) load with the
// retired accounting keys stripped.
const FeatureReviewerDecisionSchema = z.object({
	scope: z.literal("feature"),
	featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
	...reviewerDecisionCommonShape,
});

export const FinalReviewerDecisionSchema = z.object({
	scope: z.literal("final"),
	...reviewerDecisionCommonShape,
	reviewDepth: z.enum(FINAL_REVIEW_POLICIES),
	reviewedSurfaces: z.array(z.enum(FINAL_REVIEW_SURFACES)).default([]),
	evidenceSummary: z.string().min(1).optional(),
	validationAssessment: z.string().min(1).optional(),
	remainingGaps: z.array(z.string().min(1)).default([]),
	evidenceRefs: FinalReviewEvidenceRefsSchema,
});

export const ReviewerDecisionSchema = z.discriminatedUnion("scope", [
	FeatureReviewerDecisionSchema,
	FinalReviewerDecisionSchema,
]);

export const FlowReviewRecordFeatureArgsSchema = FeatureReviewerDecisionSchema;
