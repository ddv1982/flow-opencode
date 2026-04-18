import { tool } from "@opencode-ai/plugin";
import type { WorkspaceContext } from "../runtime/application";
import { FEATURE_ID_MESSAGE, FEATURE_ID_PATTERN } from "../runtime/primitives";
import type { PlanArgs, PlanningContextArgs } from "../runtime/schema";
import {
	PlanArgsSchema,
	PlanningContextArgsSchema,
	FlowReviewRecordFeatureArgsSchema as RuntimeFlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema as RuntimeFlowReviewRecordFinalArgsSchema,
	WorkerResultArgsSchema as RuntimeWorkerResultArgsSchema,
} from "../runtime/schema";

const z = tool.schema;
export const featureIdSchema = z
	.string()
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);

export const FlowStatusArgsShape = {};
export const FlowHistoryArgsShape = {};
export const FlowHistoryShowArgsShape = {
	sessionId: z
		.string()
		.min(1)
		.regex(FEATURE_ID_PATTERN, "Session ids must be lowercase kebab-case"),
};
export const FlowSessionActivateArgsShape = {
	sessionId: z
		.string()
		.min(1)
		.regex(FEATURE_ID_PATTERN, "Session ids must be lowercase kebab-case"),
};
export const FlowAutoPrepareArgsShape = {
	argumentString: z.string().optional(),
};
export const FlowPlanStartArgsShape = {
	goal: z.string().trim().min(1).optional(),
	repoProfile: z.array(z.string().min(1)).optional(),
};
export const FlowPlanApplyArgsSchema = z.object({
	plan: PlanArgsSchema.strict(),
	planning: PlanningContextArgsSchema.strict().optional(),
});
export const FlowPlanApproveArgsShape = {
	featureIds: z.array(featureIdSchema).optional(),
};
export const FlowPlanSelectArgsShape = {
	featureIds: z.array(featureIdSchema),
};
export const FlowRunStartArgsShape = {
	featureId: featureIdSchema.optional(),
};
export const FlowResetFeatureArgsShape = {
	featureId: featureIdSchema,
};

export const WorkerResultArgsSchema = RuntimeWorkerResultArgsSchema;
export const FlowReviewRecordFeatureArgsSchema =
	RuntimeFlowReviewRecordFeatureArgsSchema;
export const FlowReviewRecordFinalArgsSchema =
	RuntimeFlowReviewRecordFinalArgsSchema;

export const FlowPlanApplyArgsShape = FlowPlanApplyArgsSchema.shape;
export const FlowReviewRecordFeatureArgsShape = {
	scope: z.literal("feature"),
	featureId: featureIdSchema,
	status: z.enum(["approved", "needs_fix", "blocked"]),
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
} satisfies Readonly<Record<string, unknown>>;
export const FlowReviewRecordFinalArgsShape = {
	scope: z.literal("final"),
	status: z.enum(["approved", "needs_fix", "blocked"]),
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
} satisfies Readonly<Record<string, unknown>>;
export const WorkerResultArgsShape = {
	contractVersion: z.literal("1"),
	status: z.enum(["ok", "needs_input"]),
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
				status: z.enum(["passed", "failed", "failed_existing", "partial"]),
				summary: z.string().min(1),
			}),
		)
		.default([]),
	validationScope: z.enum(["targeted", "broad"]).optional(),
	reviewIterations: z.number().int().nonnegative().optional(),
	decisions: z.array(z.object({ summary: z.string().min(1) })).default([]),
	nextStep: z.string().min(1),
	outcome: z
		.object({
			kind: z.enum([
				"completed",
				"replan_required",
				"blocked_external",
				"needs_operator_input",
				"contract_error",
			]),
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
		verificationStatus: z
			.enum(["passed", "partial", "failed", "not_recorded"])
			.optional(),
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
		status: z.enum(["passed", "failed", "needs_followup"]),
		summary: z.string().min(1),
		blockingFindings: z
			.array(z.object({ summary: z.string().min(1) }))
			.default([]),
	}),
	finalReview: z
		.object({
			status: z.enum(["passed", "failed", "needs_followup"]),
			summary: z.string().min(1),
			blockingFindings: z
				.array(z.object({ summary: z.string().min(1) }))
				.default([]),
		})
		.optional(),
} satisfies Readonly<Record<string, unknown>>;

export const FlowStatusArgsSchema = z.object(FlowStatusArgsShape);
export const FlowHistoryArgsSchema = z.object(FlowHistoryArgsShape);
export const FlowHistoryShowArgsSchema = z.object(FlowHistoryShowArgsShape);
export const FlowSessionActivateArgsSchema = z.object(
	FlowSessionActivateArgsShape,
);
export const FlowAutoPrepareArgsSchema = z.object(FlowAutoPrepareArgsShape);
export const FlowPlanStartArgsSchema = z.object(FlowPlanStartArgsShape);
export const FlowPlanApproveArgsSchema = z.object(FlowPlanApproveArgsShape);
export const FlowPlanSelectArgsSchema = z.object(FlowPlanSelectArgsShape);
export const FlowRunStartArgsSchema = z.object(FlowRunStartArgsShape);
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

export type FlowPlanApplyArgs = {
	plan: PlanArgs;
	planning?: PlanningContextArgs;
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
