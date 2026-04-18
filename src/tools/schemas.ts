import { tool } from "@opencode-ai/plugin";
import type { WorkspaceContext } from "../runtime/application";
import {
	DECOMPOSITION_POLICIES,
	GOAL_MODES,
	OUTCOME_KINDS,
	REVIEW_STATUSES,
	REVIEWER_DECISION_STATUSES,
	VALIDATION_STATUSES,
	VERIFICATION_STATUSES,
	WORKER_STATUSES,
} from "../runtime/contracts";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	FEATURE_REVIEW_SCOPE,
	FINAL_REVIEW_SCOPE,
	VALIDATION_SCOPES,
} from "../runtime/primitives";
import type { Plan, PlanningContext } from "../runtime/schema";

const z = tool.schema;
export const featureIdSchema = z
	.string()
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);

const reviewerDecisionStatusSchema = z.enum(REVIEWER_DECISION_STATUSES);

export const PlanArgsSchema = z.object({
	summary: z.string().min(1),
	overview: z.string().min(1),
	requirements: z.array(z.string().min(1)).default([]),
	architectureDecisions: z.array(z.string().min(1)).default([]),
	features: z
		.array(
			z.object({
				id: featureIdSchema,
				title: z.string().min(1),
				summary: z.string().min(1),
				fileTargets: z.array(z.string().min(1)).default([]),
				verification: z.array(z.string().min(1)).default([]),
				dependsOn: z.array(z.string().min(1)).optional(),
				blockedBy: z.array(z.string().min(1)).optional(),
			}),
		)
		.min(1),
	goalMode: z.enum(GOAL_MODES).optional(),
	decompositionPolicy: z.enum(DECOMPOSITION_POLICIES).optional(),
	completionPolicy: z
		.object({
			minCompletedFeatures: z.number().int().positive().optional(),
			requireFinalReview: z.boolean().optional(),
		})
		.optional(),
	notes: z.array(z.string().min(1)).optional(),
});
export const PlanningContextArgsSchema = z.object({
	repoProfile: z.array(z.string().min(1)).optional(),
	research: z.array(z.string().min(1)).optional(),
	implementationApproach: z
		.object({
			chosenDirection: z.string().min(1),
			keyConstraints: z.array(z.string().min(1)).default([]),
			validationSignals: z.array(z.string().min(1)).default([]),
			sources: z.array(z.string().min(1)).default([]),
		})
		.optional(),
});

export const WorkerResultArgsShape = {
	contractVersion: z.literal("1"),
	status: z.enum(WORKER_STATUSES),
	summary: z.string().min(1),
	artifactsChanged: z
		.array(
			z.object({
				path: z.string().min(1),
				kind: z.string().min(1).optional(),
			}),
		)
		.default([]),
	validationRun: z
		.array(
			z.object({
				command: z.string().min(1),
				status: z.enum(VALIDATION_STATUSES),
				summary: z.string().min(1),
			}),
		)
		.default([]),
	validationScope: z.enum(VALIDATION_SCOPES).optional(),
	reviewIterations: z.number().int().nonnegative().optional(),
	decisions: z
		.array(
			z.object({
				summary: z.string().min(1),
			}),
		)
		.default([]),
	nextStep: z.string().min(1),
	outcome: z
		.object({
			kind: z.enum(OUTCOME_KINDS),
			category: z.string().min(1).optional(),
			summary: z.string().min(1).optional(),
			resolutionHint: z.string().min(1).optional(),
			retryable: z.boolean().optional(),
			autoResolvable: z.boolean().optional(),
			needsHuman: z.boolean().optional(),
		})
		.optional(),
	featureResult: z.object({
		featureId: featureIdSchema,
		verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
		notes: z.array(z.object({ note: z.string().min(1) })).optional(),
		followUps: z
			.array(
				z.object({
					summary: z.string().min(1),
					severity: z.string().min(1).optional(),
				}),
			)
			.optional(),
	}),
	featureReview: z.object({
		status: z.enum(REVIEW_STATUSES),
		summary: z.string().min(1),
		blockingFindings: z
			.array(z.object({ summary: z.string().min(1) }))
			.default([]),
	}),
	finalReview: z
		.object({
			status: z.enum(REVIEW_STATUSES),
			summary: z.string().min(1),
			blockingFindings: z
				.array(z.object({ summary: z.string().min(1) }))
				.default([]),
		})
		.optional(),
};

export const FlowStatusArgsShape = {};
export const FlowHistoryArgsShape = {};
export const FlowHistoryShowArgsShape = {
	sessionId: z.string().min(1),
};
export const FlowSessionActivateArgsShape = {
	sessionId: z.string().min(1),
};
export const FlowAutoPrepareArgsShape = {
	argumentString: z.string().optional(),
};
export const FlowPlanStartArgsShape = {
	goal: z.string().min(1).optional(),
	repoProfile: z.array(z.string().min(1)).optional(),
};
export const FlowPlanApplyArgsShape = {
	plan: PlanArgsSchema,
	planning: PlanningContextArgsSchema.optional(),
};
export const FlowPlanApproveArgsShape = {
	featureIds: z.array(featureIdSchema).optional(),
};
export const FlowPlanSelectArgsShape = {
	featureIds: z.array(featureIdSchema),
};
export const FlowRunStartArgsShape = {
	featureId: featureIdSchema.optional(),
};
export const FlowReviewRecordFeatureArgsShape = {
	scope: z.literal(FEATURE_REVIEW_SCOPE),
	featureId: featureIdSchema,
	status: reviewerDecisionStatusSchema,
	summary: z.string().min(1),
	blockingFindings: z
		.array(z.object({ summary: z.string().min(1) }))
		.default([]),
	followUps: z
		.array(
			z.object({
				summary: z.string().min(1),
				severity: z.string().min(1).optional(),
			}),
		)
		.default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
};
export const FlowReviewRecordFinalArgsShape = {
	scope: z.literal(FINAL_REVIEW_SCOPE),
	status: reviewerDecisionStatusSchema,
	summary: z.string().min(1),
	blockingFindings: z
		.array(z.object({ summary: z.string().min(1) }))
		.default([]),
	followUps: z
		.array(
			z.object({
				summary: z.string().min(1),
				severity: z.string().min(1).optional(),
			}),
		)
		.default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
};
export const FlowResetFeatureArgsShape = {
	featureId: featureIdSchema,
};

export const FlowStatusArgsSchema = z.object(FlowStatusArgsShape);
export const FlowHistoryArgsSchema = z.object(FlowHistoryArgsShape);
export const FlowHistoryShowArgsSchema = z.object(FlowHistoryShowArgsShape);
export const FlowSessionActivateArgsSchema = z.object(
	FlowSessionActivateArgsShape,
);
export const FlowAutoPrepareArgsSchema = z.object(FlowAutoPrepareArgsShape);
export const FlowPlanStartArgsSchema = z.object(FlowPlanStartArgsShape);
export const FlowPlanApplyArgsSchema = z.object(FlowPlanApplyArgsShape);
export const FlowPlanApproveArgsSchema = z.object(FlowPlanApproveArgsShape);
export const FlowPlanSelectArgsSchema = z.object(FlowPlanSelectArgsShape);
export const FlowRunStartArgsSchema = z.object(FlowRunStartArgsShape);
export const WorkerResultArgsSchema = z.object(WorkerResultArgsShape);
export const FlowReviewRecordFeatureArgsSchema = z.object(
	FlowReviewRecordFeatureArgsShape,
);
export const FlowReviewRecordFinalArgsSchema = z.object(
	FlowReviewRecordFinalArgsShape,
);
export const FlowResetFeatureArgsSchema = z.object(FlowResetFeatureArgsShape);

export type FlowHistoryShowArgs = {
	sessionId: string;
};

export type FlowSessionActivateArgs = {
	sessionId: string;
};

export type FlowAutoPrepareArgs = {
	argumentString?: string;
};

export type FlowPlanStartArgs = {
	goal?: string;
	repoProfile?: string[];
};

export type FlowPlanApplyArgs = {
	plan: Plan;
	planning?: Partial<PlanningContext>;
};

export type FlowPlanApproveArgs = {
	featureIds?: string[];
};

export type FlowPlanSelectArgs = {
	featureIds: string[];
};

export type FlowRunStartArgs = {
	featureId?: string;
};

export type FlowResetFeatureArgs = {
	featureId: string;
};

export type ToolContext = WorkspaceContext;
