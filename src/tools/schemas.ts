import { tool } from "@opencode-ai/plugin";
import type { WorkspaceContext } from "../runtime/application";
import {
	AUDIT_REPORT_ID_MESSAGE,
	AUDIT_REPORT_ID_PATTERN,
	CLOSURE_KINDS,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../runtime/constants";
import {
	OutcomeSchema,
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
export const FlowAuditHistoryArgsShape = {};
export const FlowHistoryShowArgsShape = {
	sessionId: z
		.string()
		.min(1)
		.regex(FEATURE_ID_PATTERN, "Session ids must be lowercase kebab-case"),
};
export const FlowAuditShowArgsShape = {
	reportId: z
		.string()
		.min(1)
		.regex(AUDIT_REPORT_ID_PATTERN, AUDIT_REPORT_ID_MESSAGE),
};
export const FlowAuditCompareArgsShape = {
	leftReportId: z
		.string()
		.min(1)
		.regex(AUDIT_REPORT_ID_PATTERN, AUDIT_REPORT_ID_MESSAGE),
	rightReportId: z
		.string()
		.min(1)
		.regex(AUDIT_REPORT_ID_PATTERN, AUDIT_REPORT_ID_MESSAGE),
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
const jsonPayloadSchema = z.string().trim().min(1);
export const FlowAuditWriteReportArgsShape = {
	reportJson: jsonPayloadSchema,
};
export const FlowPlanContextRecordArgsShape = {
	planningJson: jsonPayloadSchema,
};
export const FlowPlanApplyJsonArgsShape = {
	planJson: jsonPayloadSchema,
};
export const FlowRunCompleteFeatureArgsShape = {
	workerJson: jsonPayloadSchema,
};
export const FlowReviewRecordFeatureJsonArgsShape = {
	decisionJson: jsonPayloadSchema,
};
export const FlowReviewRecordFinalJsonArgsShape = {
	decisionJson: jsonPayloadSchema,
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
export const FlowPlanApplyArgsSchema = z.object(FlowPlanApplyJsonArgsShape);
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
export const FlowDoctorArgsSchema = z.object(FlowDoctorArgsShape);
export const FlowHistoryArgsSchema = z.object(FlowHistoryArgsShape);
export const FlowAuditHistoryArgsSchema = z.object(FlowAuditHistoryArgsShape);
export const FlowHistoryShowArgsSchema = z.object(FlowHistoryShowArgsShape);
export const FlowAuditShowArgsSchema = z.object(FlowAuditShowArgsShape);
export const FlowAuditCompareArgsSchema = z.object(FlowAuditCompareArgsShape);
export const FlowSessionActivateArgsSchema = z.object(
	FlowSessionActivateArgsShape,
);
export const FlowSessionCloseArgsSchema = z.object(FlowSessionCloseArgsShape);
export const FlowAuditWriteReportArgsSchema = z.object(
	FlowAuditWriteReportArgsShape,
);
export const FlowAutoPrepareArgsSchema = z.object(FlowAutoPrepareArgsShape);
export const FlowPlanStartArgsSchema = z.object(FlowPlanStartArgsShape);
export const FlowPlanApproveArgsSchema = z.object(FlowPlanApproveArgsShape);
export const FlowPlanSelectArgsSchema = z.object(FlowPlanSelectArgsShape);
export const FlowRunStartArgsSchema = z.object(FlowRunStartArgsShape);
export const FlowRunCompleteFeatureArgsSchema = z.object(
	FlowRunCompleteFeatureArgsShape,
);
export const FlowReviewRecordFeatureJsonArgsSchema = z.object(
	FlowReviewRecordFeatureJsonArgsShape,
);
export const FlowReviewRecordFinalJsonArgsSchema = z.object(
	FlowReviewRecordFinalJsonArgsShape,
);
export const FlowResetFeatureArgsSchema = z.object(FlowResetFeatureArgsShape);
