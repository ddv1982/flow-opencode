import type { z as zod } from "zod";
import type { WorkspaceContext } from "../../../runtime/application";
import {
	CLOSURE_KINDS,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	REVIEWER_DECISION_STATUSES,
} from "../../../runtime/constants";
import {
	FinalReviewerDecisionSchema as RuntimeFinalReviewerDecisionSchema,
	OutcomeSchema as RuntimeOutcomeSchema,
	PlanArgsSchema as RuntimePlanArgsSchema,
	PlanningContextArgsSchema as RuntimePlanningContextArgsSchema,
	ReviewerDecisionSchema as RuntimeReviewerDecisionSchema,
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
const sessionIdSchema = z
	.string()
	.min(1)
	.regex(FEATURE_ID_PATTERN, "Session ids must be lowercase kebab-case");

// flow_status
export const FlowStatusArgsShape = {
	view: FlowStatusViewSchema.optional(),
};
export const FlowStatusArgsSchema = z.object(FlowStatusArgsShape);

// flow_plan_save
export const FlowPlanSaveArgsShape = {
	goal: z.string().trim().min(1).optional(),
	planning: RuntimePlanningContextArgsSchema.optional(),
	plan: RuntimePlanArgsSchema.optional(),
};
export const FlowPlanSaveArgsSchema = z.object(FlowPlanSaveArgsShape);

// flow_plan_approve
export const FlowPlanApproveArgsShape = {
	featureIds: z.array(featureIdSchema).optional(),
};
export const FlowPlanApproveArgsSchema = z.object(FlowPlanApproveArgsShape);

// flow_run_start
export const FlowRunStartArgsShape = {
	featureId: featureIdSchema.optional(),
};
export const FlowRunStartArgsSchema = z.object(FlowRunStartArgsShape);

// flow_feature_complete — either a worker completion payload or a reset request.
export const FlowFeatureCompleteArgsShape = {
	...RuntimeWorkerResultBaseSchema.partial().shape,
	status: z.enum(["ok", "needs_input"]).optional(),
	outcome: RuntimeOutcomeSchema.optional(),
	reset: z.boolean().optional(),
	featureId: featureIdSchema.optional(),
};

const FlowFeatureCompleteResetArgsSchema = z
	.object({
		reset: z.literal(true),
		featureId: featureIdSchema,
	})
	.strict();

export type FlowFeatureCompleteArgs =
	| { reset: true; featureId: string }
	| {
			reset: false;
			worker: zod.output<typeof RuntimeWorkerResultArgsSchema>;
	  };

export const FlowFeatureCompleteArgsSchema = {
	parse(input: unknown): FlowFeatureCompleteArgs {
		if (
			input !== null &&
			typeof input === "object" &&
			(input as { reset?: unknown }).reset === true
		) {
			const parsed = FlowFeatureCompleteResetArgsSchema.parse(input);
			return { reset: true, featureId: parsed.featureId };
		}
		const { reset: _reset, ...workerInput } = (input ?? {}) as Record<
			string,
			unknown
		>;
		return {
			reset: false,
			worker: RuntimeWorkerResultArgsSchema.parse(workerInput),
		};
	},
};

// flow_review_record — one tool for both feature and final reviewer decisions,
// discriminated by `scope`. Validation is structural only; review quality
// judgment lives in the flow-review skill.
export const FlowReviewRecordArgsShape = {
	scope: z.enum(["feature", "final"]),
	featureId: featureIdSchema.optional(),
	...RuntimeFinalReviewerDecisionSchema.omit({ scope: true }).partial().shape,
	status: z.enum(REVIEWER_DECISION_STATUSES),
	summary: z.string().min(1),
};
export const FlowReviewRecordArgsSchema = RuntimeReviewerDecisionSchema;

// flow_session
const FLOW_SESSION_ACTIONS = ["activate", "close", "history", "show"] as const;
export const FlowSessionArgsShape = {
	action: z.enum(FLOW_SESSION_ACTIONS),
	sessionId: sessionIdSchema.optional(),
	kind: z.enum(CLOSURE_KINDS).optional(),
	summary: z.string().trim().min(1).optional(),
};
export const FlowSessionArgsSchema = z
	.object(FlowSessionArgsShape)
	.superRefine((input, ctx) => {
		if (
			(input.action === "activate" || input.action === "show") &&
			!input.sessionId
		) {
			ctx.addIssue({
				code: "custom",
				path: ["sessionId"],
				message: `sessionId is required when action is '${input.action}'.`,
			});
		}
		if (input.action === "close" && !input.kind) {
			ctx.addIssue({
				code: "custom",
				path: ["kind"],
				message:
					"kind ('completed', 'deferred', or 'abandoned') is required when action is 'close'.",
			});
		}
	});
