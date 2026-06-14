import {
	flowFeatureComplete,
	flowFeatureReset,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
	flowSessionClose,
	flowStatus,
} from "../../runtime/api";
import { resolveWorkspaceRoot } from "../../runtime/workspace";
import { createFlowLog } from "./logging";
import { type ToolContext, tool } from "./sdk";

const z = tool.schema;

function toJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function toolError(error: unknown): string {
	return toJson({
		status: "error",
		summary: error instanceof Error ? error.message : String(error),
	});
}

async function execute(
	context: ToolContext,
	handler: (worktree: string) => Promise<Record<string, unknown>>,
): Promise<string> {
	try {
		return toJson(await handler(resolveWorkspaceRoot(context)));
	} catch (error) {
		return toolError(error);
	}
}

export function createTools(ctx: unknown) {
	createFlowLog(ctx)("info", "Creating minimal Flow v4 tool surface.");
	return {
		flow_status: tool({
			description: "Show the active Flow session and next action",
			args: {},
			execute: (_args, context) => execute(context, flowStatus),
		}),
		flow_plan_save: tool({
			description: "Create or update a draft Flow plan for the active goal",
			args: {
				goal: z.string().optional(),
				plan: z.any().optional(),
			},
			execute: (args, context) =>
				execute(context, (worktree) => flowPlanSave(worktree, args)),
		}),
		flow_plan_approve: tool({
			description: "Approve the current draft Flow plan",
			args: {},
			execute: (_args, context) => execute(context, flowPlanApprove),
		}),
		flow_run_start: tool({
			description: "Start the next runnable approved Flow feature",
			args: {
				featureId: z.string().optional(),
			},
			execute: (args, context) =>
				execute(context, (worktree) => flowRunStart(worktree, args)),
		}),
		flow_feature_complete: tool({
			description:
				"Record a completed or blocked active feature with validation and review evidence",
			args: {
				status: z.enum(["ok", "needs_input"]),
				featureId: z.string(),
				summary: z.string(),
				artifactsChanged: z.array(z.object({ path: z.string() })).optional(),
				validationRun: z
					.array(
						z.object({
							command: z.string(),
							status: z.enum(["passed", "failed"]),
							summary: z.string(),
						}),
					)
					.optional(),
				validationScope: z.enum(["targeted", "broad"]).optional(),
				featureReview: z.any().optional(),
				finalReview: z.any().optional(),
				outcome: z.any().optional(),
			},
			execute: (args, context) =>
				execute(context, (worktree) => flowFeatureComplete(worktree, args)),
		}),
		flow_feature_reset: tool({
			description: "Reset one feature and its dependents to pending",
			args: {
				featureId: z.string(),
			},
			execute: (args, context) =>
				execute(context, (worktree) => flowFeatureReset(worktree, args)),
		}),
		flow_session_close: tool({
			description: "Close and archive the active Flow session",
			args: {
				kind: z.enum(["completed", "deferred", "abandoned"]),
				summary: z.string().optional(),
			},
			execute: (args, context) =>
				execute(context, (worktree) => flowSessionClose(worktree, args)),
		}),
	};
}
