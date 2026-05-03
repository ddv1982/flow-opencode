import { tool } from "../../sdk";
import { openCodeToolDescription } from "../../tool-projections.generated";
import type { RuntimeActionBinding } from "../descriptors";
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

export const FLOW_EXECUTION_TOOL_RUNTIME_BINDINGS = {
	flow_run_start: { kind: "mutation", name: "start_run" },
	flow_run_complete_feature: { kind: "mutation", name: "complete_run" },
	flow_reset_feature: { kind: "mutation", name: "reset_feature" },
} as const satisfies Record<
	string,
	Extract<RuntimeActionBinding, { kind: "mutation" }>
>;

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
					return executeGuardedSessionMutation(
						context,
						FLOW_EXECUTION_TOOL_RUNTIME_BINDINGS.flow_run_start.name,
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
					context.metadata?.({
						title: `Complete ${input.featureResult?.featureId ?? "feature"}`,
						metadata: {
							sessionId: null,
							featureId: input.featureResult?.featureId ?? null,
							status: input.status,
						},
					});
					return executeGuardedSessionMutation(
						context,
						FLOW_EXECUTION_TOOL_RUNTIME_BINDINGS.flow_run_complete_feature.name,
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
					context.metadata?.({
						title: `Reset ${input.featureId}`,
						metadata: {
							sessionId: null,
							featureId: input.featureId,
						},
					});
					return executeGuardedSessionMutation(
						context,
						FLOW_EXECUTION_TOOL_RUNTIME_BINDINGS.flow_reset_feature.name,
						{
							featureId: input.featureId,
						},
					);
				},
			),
		}),
	};
}
