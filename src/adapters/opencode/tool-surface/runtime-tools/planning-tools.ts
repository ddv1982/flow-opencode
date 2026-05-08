import {
	resolveMutableSessionRoot,
	toJson,
} from "../../../../runtime/application";
import {
	type StackStandardsProfileCacheValue,
	writeStackStandardsProfileCache,
} from "../../../../runtime/application/stack-standards-profile";
import type { Session } from "../../../../runtime/schema";
import { tool } from "../../sdk";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowPlanApplyArgsSchema,
	FlowPlanApplyArgsShape,
	FlowPlanApproveArgsSchema,
	FlowPlanContextRecordArgsSchema,
	FlowPlanContextRecordArgsShape,
	FlowPlanSelectArgsSchema,
	type ToolContext,
} from "../schemas";
import {
	openCodeToolDescription,
	openCodeToolRuntimeActionName,
} from "../tool-registry";
import {
	executeGuardedSessionMutation,
	flowPlanApproveArgsShape,
	flowPlanSelectArgsShape,
	parseFeatureIds,
	runGuardedSessionMutationAction,
} from "./shared";

function stackStandardsProfileCacheValue(
	planning: Pick<Session["planning"], "stackProfile" | "standardsProfile">,
): StackStandardsProfileCacheValue {
	return {
		...(planning.stackProfile ? { stackProfile: planning.stackProfile } : {}),
		...(planning.standardsProfile
			? { standardsProfile: planning.standardsProfile }
			: {}),
	};
}

export function createPlanningRuntimeTools() {
	return {
		flow_plan_context_record: tool({
			description: openCodeToolDescription("flow_plan_context_record"),
			args: FlowPlanContextRecordArgsShape,
			execute: withParsedArgs(
				FlowPlanContextRecordArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Planning context record requested",
						metadata: {
							sessionId: null,
							taskOwner: "flow-planner",
							taskPhase: "planning",
							taskSubject: "Planning context",
							taskStatus: "active",
							repoProfileCount: input.repoProfile?.length ?? 0,
							researchCount: input.research?.length ?? 0,
							decisionCount: input.decisionLog?.length ?? 0,
						},
					});
					const planning = Object.fromEntries(
						Object.entries(input).filter(([, value]) => value !== undefined),
					);
					const result = await runGuardedSessionMutationAction(
						context,
						openCodeToolRuntimeActionName(
							"flow_plan_context_record",
							"mutation",
						),
						planning,
					);
					if (result.kind === "success") {
						await writeStackStandardsProfileCache(
							resolveMutableSessionRoot(context).root,
							context.directory,
							{
								packageManager: result.savedSession.planning.packageManager,
								ambiguous: result.savedSession.planning.packageManagerAmbiguous,
							},
							stackStandardsProfileCacheValue(result.savedSession.planning),
						);
					}
					return toJson(result.response);
				},
			),
		}),

		flow_plan_apply: tool({
			description: openCodeToolDescription("flow_plan_apply"),
			args: FlowPlanApplyArgsShape,
			execute: withParsedArgs(
				FlowPlanApplyArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Draft plan apply requested",
						metadata: {
							sessionId: null,
							taskOwner: "flow-planner",
							taskPhase: "planning",
							taskSubject: "Draft plan",
							taskStatus: "active",
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
					const appliedResult = await runGuardedSessionMutationAction(
						context,
						openCodeToolRuntimeActionName("flow_plan_apply", "mutation"),
						planning === undefined
							? { plan: input.plan }
							: { plan: input.plan, planning },
					);
					if (appliedResult.kind === "success") {
						await writeStackStandardsProfileCache(
							resolveMutableSessionRoot(context).root,
							context.directory,
							{
								packageManager:
									appliedResult.savedSession.planning.packageManager,
								ambiguous:
									appliedResult.savedSession.planning.packageManagerAmbiguous,
							},
							stackStandardsProfileCacheValue(
								appliedResult.savedSession.planning,
							),
						);
					}
					return toJson(appliedResult.response);
				},
			),
		}),

		flow_plan_approve: tool({
			description: openCodeToolDescription("flow_plan_approve"),
			args: flowPlanApproveArgsShape,
			execute: withParsedArgs(
				FlowPlanApproveArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Plan approval requested",
						metadata: {
							sessionId: null,
							taskOwner: "flow-planner",
							taskPhase: "planning",
							taskSubject: "Plan approval",
							taskStatus: "active",
							requestedTaskStatus: "completed",
							requestedApprovalStatus: "approved",
							persistedTaskStatus: null,
							persistedApprovalStatus: null,
							approvedCount: parseFeatureIds(input.featureIds).length || null,
						},
					});
					return executeGuardedSessionMutation(
						context,
						openCodeToolRuntimeActionName("flow_plan_approve", "mutation"),
						{
							featureIds: parseFeatureIds(input.featureIds),
						},
					);
				},
			),
		}),

		flow_plan_select_features: tool({
			description: openCodeToolDescription("flow_plan_select_features"),
			args: flowPlanSelectArgsShape,
			execute: withParsedArgs(
				FlowPlanSelectArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Feature selection requested",
						metadata: {
							sessionId: null,
							taskOwner: "flow-planner",
							taskPhase: "planning",
							taskSubject: "Feature selection",
							taskStatus: "active",
							selectedCount: parseFeatureIds(input.featureIds).length,
						},
					});
					return executeGuardedSessionMutation(
						context,
						openCodeToolRuntimeActionName(
							"flow_plan_select_features",
							"mutation",
						),
						{ featureIds: parseFeatureIds(input.featureIds) },
					);
				},
			),
		}),
	};
}
