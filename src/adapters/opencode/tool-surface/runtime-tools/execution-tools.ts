import { tool } from "../../sdk";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowResetFeatureArgsSchema,
	FlowResetFeatureArgsShape,
	FlowRunCompleteFeatureArgsShape,
	FlowRunStartArgsSchema,
	type ToolContext,
	WorkerResultArgsSchema,
} from "../schemas";
import {
	openCodeToolDescription,
	openCodeToolRuntimeActionName,
} from "../tool-registry";
import {
	executeGuardedSessionMutation,
	flowRunStartArgsShape,
	resolveFeatureDocDrilldownFromCurrentSession,
} from "./shared";

export function createExecutionRuntimeTools() {
	return {
		flow_run_start: tool({
			description: openCodeToolDescription("flow_run_start"),
			args: flowRunStartArgsShape,
			execute: withParsedArgs(
				FlowRunStartArgsSchema,
				async (input, context: ToolContext) => {
					const featureDocDrilldown =
						await resolveFeatureDocDrilldownFromCurrentSession(
							context,
							input.featureId,
						);
					context.metadata?.({
						title: input.featureId ? `Start ${input.featureId}` : "Start next",
						metadata: {
							sessionId: null,
							taskOwner: "flow-worker",
							taskPhase: "execution",
							taskSubject: input.featureId ?? "Next approved feature",
							taskStatus: "active",
							featureId: input.featureId ?? null,
							reason: null,
							...(featureDocDrilldown ? { featureDocDrilldown } : {}),
						},
					});
					return executeGuardedSessionMutation(
						context,
						openCodeToolRuntimeActionName("flow_run_start", "mutation"),
						{
							...(input.featureId ? { featureId: input.featureId } : {}),
						},
					);
				},
			),
		}),

		flow_run_complete_feature: tool({
			description: openCodeToolDescription("flow_run_complete_feature"),
			args: FlowRunCompleteFeatureArgsShape,
			execute: withParsedArgs(
				WorkerResultArgsSchema,
				async (input, context: ToolContext) => {
					const featureDocDrilldown =
						await resolveFeatureDocDrilldownFromCurrentSession(
							context,
							input.featureResult?.featureId,
						);
					context.metadata?.({
						title: `Complete ${input.featureResult?.featureId ?? "feature"}`,
						metadata: {
							sessionId: null,
							taskOwner: "flow-worker",
							taskPhase: "execution",
							taskSubject:
								input.featureResult?.featureId ?? "Feature completion",
							taskStatus: "active",
							requestedTaskStatus:
								input.status === "ok" ? "completed" : "needs_input",
							featureId: input.featureResult?.featureId ?? null,
							status: input.status,
							validationCount: input.validationRun.length,
							reviewIterations: input.reviewIterations ?? null,
							hasFinalReview: input.finalReview !== undefined,
							...(featureDocDrilldown ? { featureDocDrilldown } : {}),
						},
					});
					return executeGuardedSessionMutation(
						context,
						openCodeToolRuntimeActionName(
							"flow_run_complete_feature",
							"mutation",
						),
						{
							worker: input,
						},
					);
				},
			),
		}),

		flow_reset_feature: tool({
			description: openCodeToolDescription("flow_reset_feature"),
			args: FlowResetFeatureArgsShape,
			execute: withParsedArgs(
				FlowResetFeatureArgsSchema,
				async (input, context: ToolContext) => {
					const featureDocDrilldown =
						await resolveFeatureDocDrilldownFromCurrentSession(
							context,
							input.featureId,
						);
					context.metadata?.({
						title: `Reset ${input.featureId}`,
						metadata: {
							sessionId: null,
							taskOwner: "flow-runtime",
							taskPhase: "recovery",
							taskSubject: input.featureId,
							taskStatus: "active",
							featureId: input.featureId,
							...(featureDocDrilldown ? { featureDocDrilldown } : {}),
						},
					});
					return executeGuardedSessionMutation(
						context,
						openCodeToolRuntimeActionName("flow_reset_feature", "mutation"),
						{
							featureId: input.featureId,
						},
					);
				},
			),
		}),
	};
}
