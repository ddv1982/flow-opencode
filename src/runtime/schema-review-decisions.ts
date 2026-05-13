import { z } from "zod";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	REVIEW_PURPOSES,
	REVIEWER_DECISION_STATUSES,
} from "./constants";
import {
	EvidencePacketArraySchema,
	EvidencePacketReferenceArraySchema,
} from "./schema-evidence-packets";
import {
	FollowUpSchema,
	finalReviewInputSharedShape,
	finalReviewPersistedSharedShape,
	ReviewFindingSchema,
	ReviewSchema,
	ReviewScopeLedgerEntrySchema,
} from "./schema-review-shared";

function addApprovedBehaviorDecisionConsistencyChecks(
	value: {
		status: string;
		behaviorChecks?: Array<{ result: string }> | undefined;
	},
	context: z.RefinementCtx,
): void {
	if (
		value.status === "approved" &&
		value.behaviorChecks?.some((check) => check.result === "needs_fix")
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["behaviorChecks"],
			message:
				"Approved final decisions cannot include behaviorChecks with result 'needs_fix'.",
		});
	}
}

export const FinalReviewSchema = ReviewSchema.extend({
	...finalReviewInputSharedShape,
	evidencePackets: EvidencePacketArraySchema.optional(),
});

export const PersistedFinalReviewSchema = ReviewSchema.extend({
	...finalReviewPersistedSharedShape,
	evidencePackets: EvidencePacketArraySchema.optional(),
});

export const FeatureReviewerDecisionSchema = z.object({
	scope: z.literal("feature"),
	featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
	reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
	status: z.enum(REVIEWER_DECISION_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
	followUps: z.array(FollowUpSchema).default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
	evidencePackets: EvidencePacketReferenceArraySchema.optional(),
});

export const FinalReviewerDecisionSchema = z
	.object({
		scope: z.literal("final"),
		reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
		status: z.enum(REVIEWER_DECISION_STATUSES),
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
		followUps: z.array(FollowUpSchema).default([]),
		...finalReviewInputSharedShape,
		reviewScopeLedger: z.array(ReviewScopeLedgerEntrySchema).optional(),
		evidencePackets: EvidencePacketArraySchema.optional(),
	})
	.strict()
	.superRefine(addApprovedBehaviorDecisionConsistencyChecks);

export const PersistedFinalReviewerDecisionSchema = z
	.object({
		scope: z.literal("final"),
		reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
		status: z.enum(REVIEWER_DECISION_STATUSES),
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
		followUps: z.array(FollowUpSchema).default([]),
		...finalReviewPersistedSharedShape,
		reviewScopeLedger: z.array(ReviewScopeLedgerEntrySchema).optional(),
		evidencePackets: EvidencePacketArraySchema.optional(),
	})
	.strict()
	.superRefine(addApprovedBehaviorDecisionConsistencyChecks);

export const ReviewerDecisionSchema = z.discriminatedUnion("scope", [
	FeatureReviewerDecisionSchema,
	PersistedFinalReviewerDecisionSchema,
]);

export const FlowReviewRecordFeatureArgsSchema =
	FeatureReviewerDecisionSchema.strict();

export const FlowReviewRecordFinalArgsSchema = FinalReviewerDecisionSchema;
