import { tool } from "../../sdk";
import { openCodeToolDescription } from "../../tool-projections.generated";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowResetFeatureArgsSchema,
	FlowResetFeatureArgsShape,
	FlowRunCompleteFeatureArgsShape,
	FlowRunStartArgsSchema,
	type ToolContext,
	WorkerResultArgsSchema,
} from "../schemas";
import { executeGuardedSessionMutation, flowRunStartArgsShape } from "./shared";

export function createExecutionRuntimeTools() {
	return {
		flow_run_start: tool({
			description: openCodeToolDescription("flow_run_start"),
			args: flowRunStartArgsShape,
			execute: withParsedArgs(
				FlowRunStartArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: input.featureId ? `Start ${input.featureId}` : "Start next",
						metadata: {
							sessionId: null,
							featureId: input.featureId ?? null,
							reason: null,
						},
					});
					return executeGuardedSessionMutation(context, "start_run", {
						...(input.featureId ? { featureId: input.featureId } : {}),
					});
				},
			),
		}),

		flow_run_complete_feature: tool({
			description: openCodeToolDescription("flow_run_complete_feature"),
			args: FlowRunCompleteFeatureArgsShape,
			execute: withParsedArgs(
				WorkerResultArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Complete ${input.featureResult?.featureId ?? "feature"}`,
						metadata: {
							sessionId: null,
							featureId: input.featureResult?.featureId ?? null,
							status: input.status,
						},
					});
					return executeGuardedSessionMutation(context, "complete_run", {
						worker: input,
					});
				},
			),
		}),

		flow_reset_feature: tool({
			description: openCodeToolDescription("flow_reset_feature"),
			args: FlowResetFeatureArgsShape,
			execute: withParsedArgs(
				FlowResetFeatureArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Reset ${input.featureId}`,
						metadata: {
							sessionId: null,
							featureId: input.featureId,
						},
					});
					return executeGuardedSessionMutation(context, "reset_feature", {
						featureId: input.featureId,
					});
				},
			),
		}),
	};
}
