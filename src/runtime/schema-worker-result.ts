import { z } from "zod";
import { VALIDATION_SCOPES } from "./constants";
import { ReplanRecordSchema } from "./schema-plan";
import {
	FinalReviewSchema,
	ReviewerDecisionSchema,
} from "./schema-review-decisions";
import { ReviewSchema } from "./schema-review-shared";
import {
	addReplanRequiredIssueIfNeeded,
	isNeedsInputOutcomeKind,
} from "./schema-worker-result-refinements";
import {
	ArtifactSchema,
	DecisionSchema,
	FeatureResultSchema,
	OutcomeSchema,
	ValidationRunSchema,
} from "./schema-worker-result-shared";

export const WorkerResultBaseSchema = z
	.object({
		contractVersion: z.literal("1"),
		summary: z.string().min(1),
		artifactsChanged: z.array(ArtifactSchema).default([]),
		validationRun: z.array(ValidationRunSchema).default([]),
		validationScope: z.enum(VALIDATION_SCOPES).optional(),
		reviewIterations: z.number().int().nonnegative().optional(),
		decisions: z.array(DecisionSchema).default([]),
		nextStep: z.string().min(1),
		featureResult: FeatureResultSchema,
		featureReview: ReviewSchema,
		finalReview: FinalReviewSchema.optional(),
	})
	.strict();

export const WorkerResultSchema = z
	.discriminatedUnion("status", [
		WorkerResultBaseSchema.extend({
			status: z.literal("ok"),
			outcome: z
				.object({
					kind: z.literal("completed"),
					category: z.string().min(1).optional(),
					summary: z.string().min(1).optional(),
					resolutionHint: z.string().min(1).optional(),
					retryable: z.boolean().optional(),
					autoResolvable: z.boolean().optional(),
					needsHuman: z.boolean().optional(),
				})
				.optional(),
		}),
		WorkerResultBaseSchema.extend({
			status: z.literal("needs_input"),
			outcome: OutcomeSchema.refine(
				(value) => isNeedsInputOutcomeKind(value.kind),
				{
					message: "needs_input outcomes must not use 'completed'.",
				},
			),
		}),
	])
	.superRefine((value, context) => {
		addReplanRequiredIssueIfNeeded(value, context);
	});

const WorkerResultOkArgsSchema = WorkerResultBaseSchema.extend({
	status: z.literal("ok"),
	outcome: OutcomeSchema.optional(),
});

const WorkerResultNeedsInputArgsSchema = WorkerResultBaseSchema.extend({
	status: z.literal("needs_input"),
	outcome: OutcomeSchema,
});

export const WorkerResultArgsSchema = z
	.discriminatedUnion("status", [
		WorkerResultOkArgsSchema,
		WorkerResultNeedsInputArgsSchema,
	])
	.superRefine((value, context) => {
		addReplanRequiredIssueIfNeeded(value, context);
	});

export const LatestFailedFlowAttemptSchema = z
	.object({
		tool: z.string().min(1),
		phase: z.enum(["review", "final_review", "execution"]),
		status: z.literal("error"),
		failureCategory: z.string().min(1),
		summary: z.string().min(1),
		recoveryHint: z.string().min(1).optional(),
		occurredAt: z.string().min(1).optional(),
		sameCategoryFailureCount: z.number().int().positive().optional(),
	})
	.strict();

export const ExecutionHistoryEntrySchema = z
	.object({
		featureId: z.string().min(1),
		status: z.string().min(1),
		summary: z.string().min(1),
		recordedAt: z.string().min(1),
		outcomeKind: z.string().min(1).nullable().optional(),
		outcome: OutcomeSchema.nullable().optional(),
		nextStep: z.string().min(1).nullable().optional(),
		validationRun: z.array(ValidationRunSchema).default([]),
		artifactsChanged: z.array(ArtifactSchema).default([]),
		decisions: z.array(DecisionSchema).default([]),
		featureResult: FeatureResultSchema.optional(),
		replanRecord: ReplanRecordSchema.optional(),
		reviewerDecision: ReviewerDecisionSchema.nullable().optional(),
		featureReview: ReviewSchema.optional(),
		finalReview: FinalReviewSchema.optional(),
	})
	.strict();
