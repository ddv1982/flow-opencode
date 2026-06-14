import type { z as zod } from "zod";
import type { WorkspaceContext } from "../../../runtime/application";
import {
	CLOSURE_KINDS,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../../../runtime/constants";
import {
	type ReviewerDecision,
	FlowReviewRecordFeatureArgsSchema as RuntimeFeatureReviewerDecisionSchema,
	FinalReviewerDecisionSchema as RuntimeFinalReviewerDecisionSchema,
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
const FlowContextViewSchema = z.enum(["summary", "features", "full"]);
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

// flow_context
export const FlowContextArgsShape = {
	view: FlowContextViewSchema.optional(),
	includeProjectStructure: z.boolean().optional(),
};
export const FlowContextArgsSchema = z.object(FlowContextArgsShape);

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

type FlowFeatureCompleteArgs =
	| { reset: true; featureId: string }
	| {
			reset: false;
			worker: zod.output<typeof RuntimeWorkerResultArgsSchema>;
	  };

function parseWorkerFeatureIdEnvelope(
	topLevelFeatureId: unknown,
	workerFeatureId: string,
): void {
	z.object({ featureId: featureIdSchema.optional() })
		.superRefine((input, ctx) => {
			if (
				input.featureId !== undefined &&
				input.featureId !== workerFeatureId
			) {
				ctx.addIssue({
					code: "custom",
					path: ["featureId"],
					message:
						"top-level featureId must match featureResult.featureId for worker completions.",
				});
			}
		})
		.parse({ featureId: topLevelFeatureId });
}

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
		const {
			reset: _reset,
			featureId: topLevelFeatureId,
			...workerInput
		} = (input ?? {}) as Record<string, unknown>;
		const worker = RuntimeWorkerResultArgsSchema.parse(workerInput);
		parseWorkerFeatureIdEnvelope(
			topLevelFeatureId,
			worker.featureResult.featureId,
		);
		return { reset: false, worker };
	},
};

const FlowReviewRecordFeaturePayloadSchema =
	RuntimeFeatureReviewerDecisionSchema.omit({ scope: true });
const FlowReviewRecordFinalPayloadSchema =
	RuntimeFinalReviewerDecisionSchema.omit({ scope: true });

// flow_review_record — one tool for both feature and final reviewer decisions,
// discriminated by `scope`, with the matching nested payload. Validation is
// structural only; review quality judgment lives in the flow-review skill.
export const FlowReviewRecordArgsShape = {
	scope: z.enum(["feature", "final"]),
	featureReview: FlowReviewRecordFeaturePayloadSchema.nullable().optional(),
	finalReview: FlowReviewRecordFinalPayloadSchema.nullable().optional(),
};

const FlowReviewRecordScopeSchema = z.object({
	scope: z.enum(["feature", "final"]),
});

const FlowReviewRecordFeatureEnvelopeSchema = z
	.object({
		scope: z.literal("feature"),
		featureReview: FlowReviewRecordFeaturePayloadSchema,
		finalReview: z.null().optional(),
	})
	.strict();

const FlowReviewRecordFinalEnvelopeSchema = z
	.object({
		scope: z.literal("final"),
		featureReview: z.null().optional(),
		finalReview: FlowReviewRecordFinalPayloadSchema,
	})
	.strict();

export const FlowReviewRecordArgsSchema = {
	parse(input: unknown): ReviewerDecision {
		const { scope } = FlowReviewRecordScopeSchema.parse(input);
		if (scope === "feature") {
			const parsed = FlowReviewRecordFeatureEnvelopeSchema.parse(input);
			return RuntimeFeatureReviewerDecisionSchema.parse({
				scope,
				...parsed.featureReview,
			});
		}

		const parsed = FlowReviewRecordFinalEnvelopeSchema.parse(input);
		return RuntimeFinalReviewerDecisionSchema.parse({
			scope,
			...parsed.finalReview,
		});
	},
};

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
