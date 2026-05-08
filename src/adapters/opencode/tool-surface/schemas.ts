import { ReviewReportSchema } from "../../../audit/report-schema";
import type { WorkspaceContext } from "../../../runtime/application";
import {
	CLOSURE_KINDS,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../../../runtime/constants";
import {
	FinalReviewSchema as RuntimeFinalReviewSchema,
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
	title?: string;
	metadata?: Record<string, unknown>;
};

export type ToolPermissionAskInput = {
	permission: string;
	patterns: string[];
	always: string[];
	metadata: Record<string, unknown>;
};

// Production OpenCode ToolContext requires these fields. This local adapter
// shape keeps them optional so defensive wrappers and focused unit tests can
// exercise missing-context branches without constructing a full host context.
export type ToolContext = WorkspaceContext & {
	sessionID?: string;
	messageID?: string;
	agent?: string;
	abort?: AbortSignal;
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

const CompactReviewContextPackArgSchema = z
	.object({
		task: z.string().min(1),
		compareBase: z.string().optional(),
		changedFiles: z.array(z.string()).optional(),
		includedContext: z.array(z.unknown()).optional(),
		relationships: z.array(z.unknown()).optional(),
		validationEvidence: z.array(z.unknown()).optional(),
		suggestedValidation: z.array(z.string()).optional(),
		coverageGaps: z.array(z.string()).optional(),
		reviewedSurfaces: z.array(z.string()).optional(),
	})
	.strict()
	.optional();
const RuntimeFinalReviewRawArgsSchema = RuntimeFinalReviewSchema.extend({
	reviewContextPack: CompactReviewContextPackArgSchema,
});

export const FlowPlanApplyArgsShape = {
	plan: RuntimePlanArgsSchema,
	planning: RuntimePlanningContextArgsSchema.optional(),
};
export const FlowRunCompleteFeatureArgsShape = {
	...RuntimeWorkerResultBaseSchema.shape,
	status: z.enum(["ok", "needs_input"]),
	outcome: RuntimeOutcomeSchema.optional(),
	finalReview: RuntimeFinalReviewRawArgsSchema.optional(),
};
export const FlowReviewRecordFeatureArgsShape =
	RuntimeFlowReviewRecordFeatureArgsSchema.shape;
export const FlowReviewRecordFinalArgsShape = {
	...RuntimeFlowReviewRecordFinalArgsSchema.shape,
	reviewContextPack: CompactReviewContextPackArgSchema,
};
export const FlowReviewRenderArgsShape = {
	...ReviewReportSchema.shape,
	view: z.enum(["human", "structured", "both"]).optional(),
};
const FlowAttachmentSelectorSchema = z
	.object({
		id: z.string().trim().min(1).optional(),
		filename: z.string().trim().min(1).optional(),
	})
	.strict()
	.refine((selector) => selector.id || selector.filename, {
		message: "Attachment selectors require id or filename",
	});

export const FlowAttachmentsMaterializeArgsShape = {
	attachments: z.array(FlowAttachmentSelectorSchema).optional(),
	destinationDirectory: z.string().trim().min(1),
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
export const FlowAttachmentsMaterializeArgsSchema = z
	.object(FlowAttachmentsMaterializeArgsShape)
	.strict();
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
	flow_attachments_materialize: {
		argsShape: FlowAttachmentsMaterializeArgsShape,
		argsSchema: FlowAttachmentsMaterializeArgsSchema,
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
		argsSchema: FlowReviewRecordFinalArgsSchema,
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
