import { tool } from "@opencode-ai/plugin";
import { executeDispatchedSessionMutation } from "../../runtime/application";
import type { WorkerResult } from "../../runtime/schema";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowResetFeatureArgsSchema,
	FlowRunStartArgsSchema,
	type ToolContext,
	WorkerResultArgsSchema,
} from "../schemas";
import { flowRunStartArgsShape, workerResultArgsShape } from "./shared";

export function createExecutionRuntimeTools() {
	return {
		flow_run_start: tool({
			description: "Start the next runnable Flow feature",
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
					return executeDispatchedSessionMutation(context, "start_run", {
						...(input.featureId ? { featureId: input.featureId } : {}),
					});
				},
			),
		}),

		flow_run_complete_feature: tool({
			description: "Persist an already-validated Flow feature execution result",
			args: workerResultArgsShape,
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
					return executeDispatchedSessionMutation(context, "complete_run", {
						worker: input as WorkerResult,
					});
				},
			),
		}),

		flow_reset_feature: tool({
			description: "Reset a Flow feature to pending",
			args:
				// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
				FlowResetFeatureArgsSchema.shape as any,
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
					return executeDispatchedSessionMutation(context, "reset_feature", {
						featureId: input.featureId,
					});
				},
			),
		}),
	};
}
