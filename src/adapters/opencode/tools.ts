import { getFlowSkillSetupStatus } from "../../distribution/sync";
import {
	FlowFeatureCompleteToolSchema,
	FlowFeatureResetSchema,
	FlowPlanSaveSchema,
	FlowRunStartSchema,
	FlowSessionCloseSchema,
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

async function flowStatusWithSetup(
	worktree: string,
): Promise<Record<string, unknown>> {
	const result = await flowStatus(worktree);
	const setup = getFlowSkillSetupStatus();
	if (!setup) return result;
	return {
		...result,
		setup: {
			skills: setup,
		},
	};
}

export function createTools(ctx: unknown) {
	createFlowLog(ctx)("info", "Creating minimal Flow v4 tool surface.");
	return {
		flow_status: tool({
			description: "Show the active Flow session and next action",
			args: {},
			execute: (_args, context) => execute(context, flowStatusWithSetup),
		}),
		flow_plan_save: tool({
			description: "Create or update a draft Flow plan for the active goal",
			args: FlowPlanSaveSchema.shape,
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
			args: FlowRunStartSchema.shape,
			execute: (args, context) =>
				execute(context, (worktree) => flowRunStart(worktree, args)),
		}),
		flow_feature_complete: tool({
			description:
				"Record a completed or blocked active feature with validation and review evidence",
			args: FlowFeatureCompleteToolSchema.shape,
			execute: (args, context) =>
				execute(context, (worktree) => flowFeatureComplete(worktree, args)),
		}),
		flow_feature_reset: tool({
			description: "Reset one feature and its dependents to pending",
			args: FlowFeatureResetSchema.shape,
			execute: (args, context) =>
				execute(context, (worktree) => flowFeatureReset(worktree, args)),
		}),
		flow_session_close: tool({
			description: "Close and archive the active Flow session",
			args: FlowSessionCloseSchema.shape,
			execute: (args, context) =>
				execute(context, (worktree) => flowSessionClose(worktree, args)),
		}),
	};
}
