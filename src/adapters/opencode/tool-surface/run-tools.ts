/**
 * flow_run_start and flow_feature_complete: the consolidated execution
 * surface. flow_feature_complete persists a validated worker result, or
 * resets a feature to pending when called with reset=true (replacing
 * flow_run_complete_feature + flow_reset_feature).
 */
import { tool } from "../sdk";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowFeatureCompleteArgsSchema,
	FlowFeatureCompleteArgsShape,
	FlowRunStartArgsSchema,
	FlowRunStartArgsShape,
	type ToolContext,
} from "./schemas";
import {
	executeGuardedSessionMutation,
	recordToolMetadata,
	resolveFeatureDocDrilldownFromCurrentSession,
} from "./shared";
import { openCodeToolDescription } from "./tool-registry";

export function createRunTools() {
	return {
		flow_run_start: tool({
			description: openCodeToolDescription("flow_run_start"),
			args: FlowRunStartArgsShape,
			execute: withParsedArgs(
				FlowRunStartArgsSchema,
				async (input, context: ToolContext) => {
					const featureDocDrilldown =
						await resolveFeatureDocDrilldownFromCurrentSession(
							context,
							input.featureId,
						);
					recordToolMetadata(
						context,
						input.featureId
							? `Run start requested: ${input.featureId}`
							: "Run start requested: next approved feature",
						{
							sessionId: null,
							taskOwner: "flow-run",
							taskPhase: "execution",
							taskSubject: input.featureId ?? "Next approved feature",
							taskStatus: "active",
							featureId: input.featureId ?? null,
							...(featureDocDrilldown ? { featureDocDrilldown } : {}),
						},
					);
					return executeGuardedSessionMutation(context, "start_run", {
						...(input.featureId ? { featureId: input.featureId } : {}),
					});
				},
			),
		}),

		flow_feature_complete: tool({
			description: openCodeToolDescription("flow_feature_complete"),
			args: FlowFeatureCompleteArgsShape,
			execute: withParsedArgs(
				FlowFeatureCompleteArgsSchema,
				async (input, context: ToolContext) => {
					if (input.reset) {
						const featureDocDrilldown =
							await resolveFeatureDocDrilldownFromCurrentSession(
								context,
								input.featureId,
							);
						recordToolMetadata(
							context,
							`Feature reset requested: ${input.featureId}`,
							{
								sessionId: null,
								taskOwner: "flow-runtime",
								taskPhase: "recovery",
								taskSubject: input.featureId,
								taskStatus: "active",
								featureId: input.featureId,
								...(featureDocDrilldown ? { featureDocDrilldown } : {}),
							},
						);
						return executeGuardedSessionMutation(context, "reset_feature", {
							featureId: input.featureId,
						});
					}

					const worker = input.worker;
					const featureDocDrilldown =
						await resolveFeatureDocDrilldownFromCurrentSession(
							context,
							worker.featureResult?.featureId,
						);
					recordToolMetadata(
						context,
						`Feature completion requested — pending Flow validation: ${worker.featureResult?.featureId ?? "feature"}`,
						{
							sessionId: null,
							metadataAuthority: "requested_only",
							authoritativeStatusSource: "tool_result_json",
							mutationState: "pending_guarded_mutation",
							taskOwner: "flow-run",
							taskPhase: "execution",
							taskSubject:
								worker.featureResult?.featureId ?? "Feature completion",
							taskStatus: "active",
							requestedTaskStatus:
								worker.status === "ok" ? "completed" : "needs_input",
							requestedWorkerStatus: worker.status,
							persistedTaskStatus: null,
							persistedWorkerStatus: null,
							featureId: worker.featureResult?.featureId ?? null,
							validationCount: worker.validationRun.length,
							reviewIterations: worker.reviewIterations ?? null,
							hasFinalReview: worker.finalReview !== undefined,
							...(featureDocDrilldown ? { featureDocDrilldown } : {}),
						},
					);
					return executeGuardedSessionMutation(context, "complete_run", {
						worker,
					});
				},
			),
		}),
	};
}
