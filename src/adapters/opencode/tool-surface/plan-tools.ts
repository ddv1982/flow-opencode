/**
 * flow_plan_save and flow_plan_approve: the consolidated planning surface.
 * flow_plan_save replaces flow_plan_start + flow_plan_context_record +
 * flow_plan_apply; flow_plan_approve folds feature-subset selection into
 * approval (replacing flow_plan_select_features).
 */
import { toJson } from "../../../runtime/application";
import type { Session } from "../../../runtime/schema";
import { tool } from "../sdk";
import { nextCommandForMissingGoal } from "./next-command-policy";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowPlanApproveArgsSchema,
	FlowPlanApproveArgsShape,
	FlowPlanSaveArgsSchema,
	FlowPlanSaveArgsShape,
	type ToolContext,
} from "./schemas";
import {
	executeGuardedSessionMutation,
	parseFeatureIds,
	recordToolMetadata,
	runToolWorkspaceAction,
} from "./shared";
import { openCodeToolDescription } from "./tool-registry";

function definedPlanningEntries(
	planning: Record<string, unknown> | undefined,
): Partial<Session["planning"]> | undefined {
	if (planning === undefined) {
		return undefined;
	}
	return Object.fromEntries(
		Object.entries(planning).filter(([, value]) => value !== undefined),
	) as Partial<Session["planning"]>;
}

export function createPlanTools() {
	return {
		flow_plan_save: tool({
			description: openCodeToolDescription("flow_plan_save"),
			args: FlowPlanSaveArgsShape,
			execute: withParsedArgs(
				FlowPlanSaveArgsSchema,
				async (input, context: ToolContext) => {
					const planning = definedPlanningEntries(input.planning);
					recordToolMetadata(context, "Plan save requested", {
						sessionId: null,
						taskOwner: "flow-plan",
						taskPhase: "planning",
						taskSubject: "Plan save",
						taskStatus: "active",
						goal: input.goal ?? null,
						hasPlanningContext: planning !== undefined,
						featureCount: input.plan?.features.length ?? null,
					});

					const saved = await runToolWorkspaceAction(context, "plan_save", {
						...(input.goal ? { goal: input.goal } : {}),
						...(planning !== undefined ? { planning } : {}),
						...(context.directory ? { directory: context.directory } : {}),
						missingGoalNextCommand: nextCommandForMissingGoal(),
					});

					if (!input.plan || saved.value.status === "missing_goal") {
						return toJson(saved.response);
					}

					return executeGuardedSessionMutation(context, "apply_plan", {
						plan: input.plan,
					});
				},
			),
		}),

		flow_plan_approve: tool({
			description: openCodeToolDescription("flow_plan_approve"),
			args: FlowPlanApproveArgsShape,
			execute: withParsedArgs(
				FlowPlanApproveArgsSchema,
				async (input, context: ToolContext) => {
					const featureIds = parseFeatureIds(input.featureIds);
					recordToolMetadata(context, "Plan approval requested", {
						sessionId: null,
						taskOwner: "flow-plan",
						taskPhase: "planning",
						taskSubject: "Plan approval",
						taskStatus: "active",
						requestedApprovalStatus: "approved",
						approvedCount: featureIds.length || null,
					});
					return executeGuardedSessionMutation(context, "approve_plan", {
						featureIds,
					});
				},
			),
		}),
	};
}
