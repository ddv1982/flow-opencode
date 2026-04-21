import { tool } from "@opencode-ai/plugin";
import {
	executeDispatchedSessionMutation,
	runDispatchedSessionMutationAction,
	toJson,
} from "../../runtime/application";
import { PlanningContextArgsSchema, type Session } from "../../runtime/schema";
import { summarizeSession } from "../../runtime/summary";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowPlanApplyArgsSchema,
	FlowPlanApproveArgsSchema,
	FlowPlanSelectArgsSchema,
	type ToolContext,
} from "../schemas";
import {
	flowPlanApplyArgsShape,
	flowPlanApproveArgsShape,
	flowPlanSelectArgsShape,
	parseFeatureIds,
} from "./shared";

export function createPlanningRuntimeTools() {
	return {
		flow_plan_context_record: tool({
			description:
				"Persist repo profile, research, implementation approach, and optional planning decisions into the active Flow session",
			args: PlanningContextArgsSchema.shape,
			execute: withParsedArgs(
				PlanningContextArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Record planning context",
						metadata: {
							sessionId: null,
							repoProfileCount: input.repoProfile?.length ?? 0,
							researchCount: input.research?.length ?? 0,
							decisionCount: input.decisionLog?.length ?? 0,
						},
					});
					const planning = Object.fromEntries(
						Object.entries(input).filter(([, value]) => value !== undefined),
					);
					return executeDispatchedSessionMutation(
						context,
						"record_planning_context",
						planning,
					);
				},
			),
		}),

		flow_plan_apply: tool({
			description: "Persist a Flow draft plan into the active session",
			args: flowPlanApplyArgsShape,
			execute: withParsedArgs(
				FlowPlanApplyArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Apply draft plan",
						metadata: {
							sessionId: null,
							featureCount: input.plan.features.length,
						},
					});
					const planning =
						input.planning === undefined
							? undefined
							: (Object.fromEntries(
									Object.entries(input.planning).filter(
										([, value]) => value !== undefined,
									),
								) as Partial<Session["planning"]>);
					const appliedResult = await runDispatchedSessionMutationAction(
						context,
						"apply_plan",
						planning === undefined
							? { plan: input.plan }
							: { plan: input.plan, planning },
					);
					if (appliedResult.kind !== "success") {
						return toJson(appliedResult.response);
					}

					const summary = summarizeSession(appliedResult.savedSession);
					if (summary.session?.operator.lane === "lite") {
						const approvedResult = await runDispatchedSessionMutationAction(
							context,
							"auto_approve_lite_plan",
							undefined,
						);
						return toJson(approvedResult.response);
					}

					return toJson(appliedResult.response);
				},
			),
		}),

		flow_plan_approve: tool({
			description: "Approve the active Flow draft plan",
			args: flowPlanApproveArgsShape,
			execute: withParsedArgs(
				FlowPlanApproveArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Approve plan",
						metadata: {
							sessionId: null,
							approvedCount: parseFeatureIds(input.featureIds).length || null,
						},
					});
					return executeDispatchedSessionMutation(context, "approve_plan", {
						featureIds: parseFeatureIds(input.featureIds),
					});
				},
			),
		}),

		flow_plan_select_features: tool({
			description: "Keep only selected features in the active Flow draft plan",
			args: flowPlanSelectArgsShape,
			execute: withParsedArgs(
				FlowPlanSelectArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Narrow plan",
						metadata: {
							sessionId: null,
							selectedCount: parseFeatureIds(input.featureIds).length,
						},
					});
					return executeDispatchedSessionMutation(
						context,
						"select_plan_features",
						{ featureIds: parseFeatureIds(input.featureIds) },
					);
				},
			),
		}),
	};
}
