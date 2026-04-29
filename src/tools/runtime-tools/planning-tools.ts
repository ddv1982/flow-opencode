import { tool } from "@opencode-ai/plugin";
import { toJson } from "../../runtime/application";
import {
	PlanArgsSchema,
	PlanningContextArgsSchema,
	type Session,
} from "../../runtime/schema";
import { withJsonTransportArgs, withParsedArgs } from "../parsed-tool";
import {
	FlowPlanApplyArgsSchema,
	FlowPlanApplyJsonArgsShape,
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

export function createPlanningRuntimeTools() {
	return {
		flow_plan_context_record: tool({
			description:
				"Persist repo profile, research, implementation approach, and optional planning decisions into the active Flow session from a JSON payload",
			args: FlowPlanContextRecordArgsShape,
			execute: withJsonTransportArgs(
				{
					transportSchema: FlowPlanContextRecordArgsSchema,
					field: "planningJson",
					payloadSchema: PlanningContextArgsSchema,
					legacySchema: PlanningContextArgsSchema,
				},
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
					return executeGuardedSessionMutation(
						context,
						"record_planning_context",
						planning,
					);
				},
			),
		}),

		flow_plan_apply: tool({
			description:
				"Persist a Flow draft plan into the active session from a JSON payload",
			args: FlowPlanApplyJsonArgsShape,
			execute: withJsonTransportArgs(
				{
					transportSchema: FlowPlanApplyArgsSchema,
					field: "planJson",
					payloadSchema: {
						parse: (input: unknown) =>
							tool.schema
								.object({
									plan: PlanArgsSchema.strict(),
									planning: PlanningContextArgsSchema.strict().optional(),
								})
								.parse(input),
					},
					legacySchema: {
						parse: (input: unknown) =>
							tool.schema
								.object({
									plan: PlanArgsSchema.strict(),
									planning: PlanningContextArgsSchema.strict().optional(),
								})
								.parse(input),
					},
				},
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
						"apply_plan",
						planning === undefined
							? { plan: input.plan }
							: { plan: input.plan, planning },
					);
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
					return executeGuardedSessionMutation(context, "approve_plan", {
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
					return executeGuardedSessionMutation(
						context,
						"select_plan_features",
						{ featureIds: parseFeatureIds(input.featureIds) },
					);
				},
			),
		}),
	};
}
