import { z } from "zod";
import {
	ApprovalStatusSchema,
	ClosureSchema,
	PlanningContextSchema,
	PlanSchema,
	SessionStatusSchema,
} from "./schema-plan";
import { ReviewerDecisionSchema } from "./schema-review-decisions";
import {
	ExecutionHistoryEntrySchema,
	LatestFailedFlowAttemptSchema,
} from "./schema-worker-result";
import {
	ArtifactSchema,
	FeatureResultSchema,
	OutcomeSchema,
	ValidationRunSchema,
} from "./schema-worker-result-shared";

export const SessionSchema = z.object({
	version: z.literal(1),
	id: z.string().min(1),
	goal: z.string().min(1),
	status: SessionStatusSchema,
	approval: ApprovalStatusSchema,
	planning: PlanningContextSchema,
	plan: PlanSchema.nullable(),
	execution: z.object({
		activeFeatureId: z.string().min(1).nullable(),
		lastFeatureId: z.string().min(1).nullable(),
		lastSummary: z.string().min(1).nullable(),
		lastOutcomeKind: z.string().min(1).nullable(),
		lastOutcome: OutcomeSchema.nullable().default(null),
		lastNextStep: z.string().min(1).nullable().default(null),
		lastFeatureResult: FeatureResultSchema.nullable().default(null),
		lastReviewerDecision: ReviewerDecisionSchema.nullable().default(null),
		lastValidationRun: z.array(ValidationRunSchema).default([]),
		lastFailedMutation: LatestFailedFlowAttemptSchema.nullable().default(null),
		history: z.array(ExecutionHistoryEntrySchema).default([]),
	}),
	closure: ClosureSchema.nullable().default(null),
	notes: z.array(z.string().min(1)).default([]),
	artifacts: z.array(ArtifactSchema).default([]),
	timestamps: z.object({
		createdAt: z.string().min(1),
		updatedAt: z.string().min(1),
		approvedAt: z.string().min(1).nullable(),
		completedAt: z.string().min(1).nullable(),
	}),
});

export type Session = z.infer<typeof SessionSchema>;
