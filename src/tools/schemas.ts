import { tool } from "@opencode-ai/plugin";
import type { WorkspaceContext } from "../runtime/application";
import { REVIEWER_DECISION_STATUSES, WORKER_STATUSES } from "../runtime/contracts";
import { FEATURE_REVIEW_SCOPE, FINAL_REVIEW_SCOPE, VALIDATION_SCOPES } from "../runtime/primitives";
import { buildSharedSchemas } from "../runtime/shared-schema";
import type { PlanningContext } from "../runtime/schema";

const z = tool.schema;
const sharedSchemas = buildSharedSchemas(z, {
  includeFeatureStatus: false,
  defaultGoalMode: false,
  defaultDecompositionPolicy: false,
  defaultPlanningArrays: false,
});

export const featureIdSchema = sharedSchemas.featureIdSchema;

const reviewerDecisionStatusSchema = z.enum(REVIEWER_DECISION_STATUSES);

export const PlanArgsSchema = sharedSchemas.planSchema;
export const PlanningContextArgsSchema = sharedSchemas.planningContextSchema;

export const WorkerResultArgsShape = {
  contractVersion: z.literal("1"),
  status: z.enum(WORKER_STATUSES),
  summary: z.string().min(1),
  artifactsChanged: z.array(sharedSchemas.artifactSchema).default([]),
  validationRun: z.array(sharedSchemas.validationRunSchema).default([]),
  validationScope: z.enum(VALIDATION_SCOPES).optional(),
  reviewIterations: z.number().int().nonnegative().optional(),
  decisions: z.array(sharedSchemas.decisionSchema).default([]),
  nextStep: z.string().min(1),
  outcome: sharedSchemas.outcomeSchema.optional(),
  featureResult: sharedSchemas.featureResultSchema,
  featureReview: sharedSchemas.reviewSchema,
  finalReview: sharedSchemas.reviewSchema.optional(),
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
  blockingFindings: z.array(sharedSchemas.reviewFindingSchema).default([]),
  followUps: z.array(sharedSchemas.followUpSchema).default([]),
  suggestedValidation: z.array(z.string().min(1)).default([]),
};
export const FlowReviewRecordFinalArgsShape = {
  scope: z.literal(FINAL_REVIEW_SCOPE),
  status: reviewerDecisionStatusSchema,
  summary: z.string().min(1),
  blockingFindings: z.array(sharedSchemas.reviewFindingSchema).default([]),
  followUps: z.array(sharedSchemas.followUpSchema).default([]),
  suggestedValidation: z.array(z.string().min(1)).default([]),
};
export const FlowResetFeatureArgsShape = {
  featureId: featureIdSchema,
};

export const FlowStatusArgsSchema = z.object(FlowStatusArgsShape);
export const FlowHistoryArgsSchema = z.object(FlowHistoryArgsShape);
export const FlowHistoryShowArgsSchema = z.object(FlowHistoryShowArgsShape);
export const FlowSessionActivateArgsSchema = z.object(FlowSessionActivateArgsShape);
export const FlowAutoPrepareArgsSchema = z.object(FlowAutoPrepareArgsShape);
export const FlowPlanStartArgsSchema = z.object(FlowPlanStartArgsShape);
export const FlowPlanApplyArgsSchema = z.object(FlowPlanApplyArgsShape);
export const FlowPlanApproveArgsSchema = z.object(FlowPlanApproveArgsShape);
export const FlowPlanSelectArgsSchema = z.object(FlowPlanSelectArgsShape);
export const FlowRunStartArgsSchema = z.object(FlowRunStartArgsShape);
export const WorkerResultArgsSchema = z.object(WorkerResultArgsShape);
export const FlowReviewRecordFeatureArgsSchema = z.object(FlowReviewRecordFeatureArgsShape);
export const FlowReviewRecordFinalArgsSchema = z.object(FlowReviewRecordFinalArgsShape);
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
  plan: unknown;
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
