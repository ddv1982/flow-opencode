import { ReviewReportSchema } from "../../../audit/report-schema";
import type { WorkspaceContext } from "../../../runtime/application";
import {
	CLOSURE_KINDS,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../../../runtime/constants";
import {
	FinalReviewerDecisionSchema as RuntimeFinalReviewerDecisionSchema,
	FlowReviewRecordFeatureArgsSchema as RuntimeFlowReviewRecordFeatureArgsSchema,
	OutcomeSchema as RuntimeOutcomeSchema,
	PlanArgsSchema as RuntimePlanArgsSchema,
	PlanningContextArgsSchema as RuntimePlanningContextArgsSchema,
	WorkerResultArgsSchema as RuntimeWorkerResultArgsSchema,
	WorkerResultBaseSchema as RuntimeWorkerResultBaseSchema,
} from "../../../runtime/schema";
import type { ToolContext as OpenCodeToolContext } from "../sdk";
import { tool } from "../sdk";

const z = tool.schema;
// Production OpenCode ToolContext requires these fields. This local adapter
// shape keeps them optional so defensive wrappers and focused unit tests can
// exercise missing-context branches without constructing a full host context.
export type ToolContext = WorkspaceContext &
	Partial<
		Omit<OpenCodeToolContext, keyof WorkspaceContext | "metadata" | "ask">
	> & {
		metadata?: OpenCodeToolContext["metadata"];
		ask?: OpenCodeToolContext["ask"];
	};
const FlowStatusViewSchema = z.enum(["compact", "detailed"]);
const featureIdSchema = z
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
	RuntimeFinalReviewerDecisionSchema.shape;
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
export const FlowPlanContextRecordArgsSchema = RuntimePlanningContextArgsSchema;
export const FlowPlanApplyArgsSchema = z
	.object(FlowPlanApplyArgsShape)
	.strict();
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
export const FlowReviewRecordFeatureArgsSchema =
	RuntimeFlowReviewRecordFeatureArgsSchema;
export const FinalReviewerDecisionSchema = RuntimeFinalReviewerDecisionSchema;
export const FlowReviewRenderArgsSchema = z.object(FlowReviewRenderArgsShape);
export const FlowResetFeatureArgsSchema = z.object(FlowResetFeatureArgsShape);

type FlowToolPayloadSchemaRegistration = {
	argsShape: object;
	argsSchema: object;
	payloadSchemaOwners: readonly string[];
};

export const FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY = {
	flow_status: {
		argsShape: FlowStatusArgsShape,
		argsSchema: FlowStatusArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_doctor: {
		argsShape: FlowDoctorArgsShape,
		argsSchema: FlowDoctorArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_history: {
		argsShape: FlowHistoryArgsShape,
		argsSchema: FlowHistoryArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_history_show: {
		argsShape: FlowHistoryShowArgsShape,
		argsSchema: FlowHistoryShowArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_session_activate: {
		argsShape: FlowSessionActivateArgsShape,
		argsSchema: FlowSessionActivateArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_plan_start: {
		argsShape: FlowPlanStartArgsShape,
		argsSchema: FlowPlanStartArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_auto_prepare: {
		argsShape: FlowAutoPrepareArgsShape,
		argsSchema: FlowAutoPrepareArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_session_close: {
		argsShape: FlowSessionCloseArgsShape,
		argsSchema: FlowSessionCloseArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_plan_context_record: {
		argsShape: FlowPlanContextRecordArgsShape,
		argsSchema: FlowPlanContextRecordArgsSchema,
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
	},
	flow_plan_apply: {
		argsShape: FlowPlanApplyArgsShape,
		argsSchema: FlowPlanApplyArgsSchema,
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
	},
	flow_plan_approve: {
		argsShape: FlowPlanApproveArgsShape,
		argsSchema: FlowPlanApproveArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_plan_select_features: {
		argsShape: FlowPlanSelectArgsShape,
		argsSchema: FlowPlanSelectArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_run_start: {
		argsShape: FlowRunStartArgsShape,
		argsSchema: FlowRunStartArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_run_complete_feature: {
		argsShape: FlowRunCompleteFeatureArgsShape,
		argsSchema: WorkerResultArgsSchema,
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
	},
	flow_reset_feature: {
		argsShape: FlowResetFeatureArgsShape,
		argsSchema: FlowResetFeatureArgsSchema,
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
	},
	flow_review_record_feature: {
		argsShape: FlowReviewRecordFeatureArgsShape,
		argsSchema: FlowReviewRecordFeatureArgsSchema,
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
	},
	flow_review_record_final: {
		argsShape: FlowReviewRecordFinalArgsShape,
		argsSchema: FinalReviewerDecisionSchema,
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
	},
	flow_review_render: {
		argsShape: FlowReviewRenderArgsShape,
		argsSchema: FlowReviewRenderArgsSchema,
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/audit/report-schema.ts",
		],
	},
} as const satisfies Record<string, FlowToolPayloadSchemaRegistration>;

export const FLOW_TOOL_PAYLOAD_SCHEMA_OWNERS: Record<
	string,
	readonly string[]
> = Object.fromEntries(
	Object.entries(FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY).map(
		([toolName, registration]) => [toolName, registration.payloadSchemaOwners],
	),
);
