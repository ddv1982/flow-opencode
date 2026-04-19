import { tool } from "@opencode-ai/plugin";
import type { WorkspaceContext } from "../runtime/application";
import {
	CLOSURE_KINDS,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../runtime/constants";
import type { PlanArgs, PlanningContextArgs } from "../runtime/schema";
import {
	OutcomeSchema,
	PlanArgsSchema,
	PlanningContextArgsSchema,
	FlowReviewRecordFeatureArgsSchema as RuntimeFlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema as RuntimeFlowReviewRecordFinalArgsSchema,
	WorkerResultArgsSchema as RuntimeWorkerResultArgsSchema,
	WorkerResultBaseSchema as RuntimeWorkerResultBaseSchema,
} from "../runtime/schema";

const z = tool.schema;
export type ToolMetadataPayload = {
	title: string;
	metadata: Record<string, unknown>;
};

export type ToolContext = WorkspaceContext & {
	metadata?: (payload: ToolMetadataPayload) => void;
};
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
export const FlowSessionCloseArgsShape = {
	kind: z.enum(CLOSURE_KINDS),
	summary: z.string().trim().min(1).optional(),
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
export const RuntimeWorkerResultBaseShape = RuntimeWorkerResultBaseSchema.shape;
export const RuntimeFlowReviewRecordFeatureArgsShape =
	RuntimeFlowReviewRecordFeatureArgsSchema.shape;
export const RuntimeFlowReviewRecordFinalArgsShape =
	RuntimeFlowReviewRecordFinalArgsSchema.shape;

export const FlowPlanApplyArgsShape = FlowPlanApplyArgsSchema.shape;
export const FlowReviewRecordFeatureArgsShape =
	RuntimeFlowReviewRecordFeatureArgsShape;
export const FlowReviewRecordFinalArgsShape =
	RuntimeFlowReviewRecordFinalArgsShape;
export const WorkerResultArgsShape = {
	...RuntimeWorkerResultBaseShape,
	status: z.enum(["ok", "needs_input"]),
	outcome: OutcomeSchema.optional(),
} satisfies Readonly<Record<string, unknown>>;

export const FlowStatusArgsSchema = z.object(FlowStatusArgsShape);
export const FlowHistoryArgsSchema = z.object(FlowHistoryArgsShape);
export const FlowHistoryShowArgsSchema = z.object(FlowHistoryShowArgsShape);
export const FlowSessionActivateArgsSchema = z.object(
	FlowSessionActivateArgsShape,
);
export const FlowSessionCloseArgsSchema = z.object(FlowSessionCloseArgsShape);
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

export type FlowSessionCloseArgs = {
	kind: (typeof CLOSURE_KINDS)[number];
	summary?: string;
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
