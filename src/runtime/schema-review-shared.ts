import { z } from "zod";
import {
	FINAL_REVIEW_POLICIES,
	FINAL_REVIEW_SURFACES,
	REVIEW_SCOPE_TARGET_KINDS,
	REVIEW_STATUSES,
} from "./constants";

export const FollowUpSchema = z.object({
	summary: z.string().min(1),
	severity: z.string().min(1).optional(),
});

// Plan features may declare review focus targets. The runtime treats them as
// reviewer guidance only; coverage judgment lives in the flow-review skill.
export const ReviewScopeTargetSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(REVIEW_SCOPE_TARGET_KINDS),
	target: z.string().min(1),
	description: z.string().min(1).optional(),
});

export const ReviewFindingSchema = z.object({
	summary: z.string().min(1),
});

export const ReviewSchema = z
	.object({
		status: z.enum(REVIEW_STATUSES),
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
	})
	.strict();

export const FinalReviewEvidenceRefsSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)).default([]),
		validationCommands: z.array(z.string().min(1)).default([]),
	})
	.default({ changedArtifacts: [], validationCommands: [] });

export const FinalReviewSchema = ReviewSchema.extend({
	reviewDepth: z.enum(FINAL_REVIEW_POLICIES),
	reviewedSurfaces: z.array(z.enum(FINAL_REVIEW_SURFACES)).default([]),
	evidenceSummary: z.string().min(1).optional(),
	validationAssessment: z.string().min(1).optional(),
	remainingGaps: z.array(z.string().min(1)).default([]),
	suggestedValidation: z.array(z.string().min(1)).optional(),
	evidenceRefs: FinalReviewEvidenceRefsSchema,
}).strict();
