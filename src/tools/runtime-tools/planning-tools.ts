import { tool } from "@opencode-ai/plugin";
import {
	missingSessionResponse,
	withPersistedTransition,
} from "../../runtime/application";
import { FLOW_PLAN_WITH_GOAL_COMMAND } from "../../runtime/constants";
import { PlanningContextArgsSchema } from "../../runtime/schema";
import { summarizeSession } from "../../runtime/summary";
import {
	applyPlan,
	approvePlan,
	selectPlanFeatures,
} from "../../runtime/transitions";
import { succeed } from "../../runtime/transitions/shared";
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
			args:
				// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against bundled plugin Zod while this shape comes from runtime schema.
				PlanningContextArgsSchema.shape as any,
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
					) as Parameters<typeof applyPlan>[2];
					const nextPlanning = planning ?? {};
					return withPersistedTransition(
						context,
						(session) =>
							succeed({
								...session,
								planning: {
									repoProfile:
										nextPlanning.repoProfile ?? session.planning.repoProfile,
									research: nextPlanning.research ?? session.planning.research,
									implementationApproach:
										nextPlanning.implementationApproach ??
										session.planning.implementationApproach,
									decisionLog:
										nextPlanning.decisionLog ?? session.planning.decisionLog,
									replanLog:
										nextPlanning.replanLog ?? session.planning.replanLog,
								},
							}),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Planning context recorded.",
								session: summarizeSession(saved).session,
							}),
						},
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
								) as Parameters<typeof applyPlan>[2]);
					return withPersistedTransition(
						context,
						(session) => applyPlan(session, { ...input.plan }, planning),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Draft plan saved.",
								session: summarizeSession(saved).session,
							}),
							missingResponse: missingSessionResponse(
								"No active Flow planning session exists.",
								FLOW_PLAN_WITH_GOAL_COMMAND,
							),
						},
					);
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
					return withPersistedTransition(
						context,
						(session) =>
							approvePlan(session, parseFeatureIds(input.featureIds)),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Plan approved.",
								session: summarizeSession(saved).session,
							}),
						},
					);
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
					return withPersistedTransition(
						context,
						(session) =>
							selectPlanFeatures(session, parseFeatureIds(input.featureIds)),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Draft plan narrowed.",
								session: summarizeSession(saved).session,
							}),
						},
					);
				},
			),
		}),
	};
}
