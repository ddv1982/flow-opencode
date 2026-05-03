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
import { openCodeToolDescription } from "../../tool-projections.generated";
import type { RuntimeActionBinding } from "../descriptors";
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
	executeGuardedSessionMutation,
	flowPlanApproveArgsShape,
	flowPlanSelectArgsShape,
	parseFeatureIds,
	runGuardedSessionMutationAction,
} from "./shared";

export const FLOW_PLANNING_RUNTIME_TOOL_RUNTIME_BINDINGS = {
	flow_plan_context_record: {
		kind: "mutation",
		name: "record_planning_context",
	},
	flow_plan_apply: { kind: "mutation", name: "apply_plan" },
	flow_plan_approve: { kind: "mutation", name: "approve_plan" },
	flow_plan_select_features: {
		kind: "mutation",
		name: "select_plan_features",
	},
} as const satisfies Record<
	string,
	Extract<RuntimeActionBinding, { kind: "mutation" }>
>;

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
					const result = await runGuardedSessionMutationAction(
						context,
						FLOW_PLANNING_RUNTIME_TOOL_RUNTIME_BINDINGS.flow_plan_context_record
							.name,
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
					const appliedResult = await runGuardedSessionMutationAction(
						context,
						FLOW_PLANNING_RUNTIME_TOOL_RUNTIME_BINDINGS.flow_plan_apply.name,
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
						title: "Approve plan",
						metadata: {
							sessionId: null,
							approvedCount: parseFeatureIds(input.featureIds).length || null,
						},
					});
					return executeGuardedSessionMutation(
						context,
						FLOW_PLANNING_RUNTIME_TOOL_RUNTIME_BINDINGS.flow_plan_approve.name,
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
						title: "Narrow plan",
						metadata: {
							sessionId: null,
							selectedCount: parseFeatureIds(input.featureIds).length,
						},
					});
					return executeGuardedSessionMutation(
						context,
						FLOW_PLANNING_RUNTIME_TOOL_RUNTIME_BINDINGS
							.flow_plan_select_features.name,
						{ featureIds: parseFeatureIds(input.featureIds) },
					);
				},
			),
		}),
	};
}
