import { ReviewReportSchema } from "../../../audit/report-schema";
import type { WorkspaceContext } from "../../../runtime/application";
import {
	CLOSURE_KINDS,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../../../runtime/constants";
import {
	FlowReviewRecordFeatureArgsSchema as RuntimeFlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema as RuntimeFlowReviewRecordFinalArgsSchema,
	OutcomeSchema as RuntimeOutcomeSchema,
	PlanArgsSchema as RuntimePlanArgsSchema,
	PlanningContextArgsSchema as RuntimePlanningContextArgsSchema,
	WorkerResultArgsSchema as RuntimeWorkerResultArgsSchema,
	WorkerResultBaseSchema as RuntimeWorkerResultBaseSchema,
} from "../../../runtime/schema";
import { tool } from "../sdk";

const z = tool.schema;
export type ToolMetadataPayload = {
	title: string;
	metadata: Record<string, unknown>;
};

export type ToolPermissionAskInput = {
	permission: string;
	patterns: string[];
	always: string[];
	metadata: Record<string, unknown>;
};

export type ToolContext = WorkspaceContext & {
	metadata?: (payload: ToolMetadataPayload) => void;
	ask?: (input: ToolPermissionAskInput) => Promise<void>;
};
export const FlowStatusViewSchema = z.enum(["compact", "detailed"]);
export const featureIdSchema = z
	.string()
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);

export const FlowStatusArgsShape = {
	view: FlowStatusViewSchema.optional(),
};
export const FlowDoctorArgsShape = {
	view: FlowStatusViewSchema.optional(),
};
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
export const FlowPlanContextRecordArgsShape =
	RuntimePlanningContextArgsSchema.shape;
export const FlowPlanApplyArgsShape = {
	plan: RuntimePlanArgsSchema,
	planning: RuntimePlanningContextArgsSchema.optional(),
};
export const FlowRunCompleteFeatureArgsShape = {
	...RuntimeWorkerResultBaseSchema.shape,
	status: z.enum(["ok", "needs_input"]),
	outcome: RuntimeOutcomeSchema.optional(),
};
export const FlowReviewRecordFeatureArgsShape =
	RuntimeFlowReviewRecordFeatureArgsSchema.shape;
export const FlowReviewRecordFinalArgsShape =
	RuntimeFlowReviewRecordFinalArgsSchema.shape;
export const FlowReviewRenderArgsShape = {
	...ReviewReportSchema.shape,
	view: z.enum(["human", "structured", "both"]).optional(),
};
export const FlowAutoPrepareArgsShape = {
	argumentString: z.string().optional(),
};
export const FlowPlanStartArgsShape = {
	goal: z.string().trim().min(1).optional(),
	repoProfile: z.array(z.string().min(1)).optional(),
};
export const FlowPlanContextRecordArgsSchema = z.object(
	FlowPlanContextRecordArgsShape,
);
export const FlowPlanApplyArgsSchema = z.object(FlowPlanApplyArgsShape);
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
export const RuntimeWorkerResultBaseShape = RuntimeWorkerResultBaseSchema.shape;
export const RuntimeFlowReviewRecordFeatureArgsShape =
	RuntimeFlowReviewRecordFeatureArgsSchema.shape;
export const RuntimeFlowReviewRecordFinalArgsShape =
	RuntimeFlowReviewRecordFinalArgsSchema.shape;

export const FlowStatusArgsSchema = z.object(FlowStatusArgsShape);
export const FlowDoctorArgsSchema = z.object(FlowDoctorArgsShape);
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
export const FlowRunCompleteFeatureArgsSchema = z.object(
	FlowRunCompleteFeatureArgsShape,
);
export const FlowReviewRecordFeatureArgsSchema =
	RuntimeFlowReviewRecordFeatureArgsSchema;
export const FlowReviewRecordFinalArgsSchema =
	RuntimeFlowReviewRecordFinalArgsSchema;
export const FlowReviewRenderArgsSchema = z.object(FlowReviewRenderArgsShape);
export const FlowResetFeatureArgsSchema = z.object(FlowResetFeatureArgsShape);
