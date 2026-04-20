import { tool } from "@opencode-ai/plugin";
import { executeDispatchedSessionMutation } from "../../runtime/application";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema,
	type ToolContext,
} from "../schemas";
import {
	flowReviewRecordFeatureArgsShape,
	flowReviewRecordFinalArgsShape,
} from "./shared";

export function createReviewRuntimeTools() {
	return {
		flow_review_record_feature: tool({
			description:
				"Record an already-validated reviewer decision for the active feature",
			args: flowReviewRecordFeatureArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFeatureArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Reviewer ${input.status} ${input.featureId}`,
						metadata: {
							sessionId: null,
							featureId: input.featureId,
							status: input.status,
						},
					});
					return executeDispatchedSessionMutation(
						context,
						"record_feature_review",
						{ decision: input },
					);
				},
			),
		}),

		flow_review_record_final: tool({
			description:
				"Record an already-validated reviewer decision for final cross-feature validation",
			args: flowReviewRecordFinalArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFinalArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Final reviewer ${input.status}`,
						metadata: {
							sessionId: null,
							status: input.status,
						},
					});
					return executeDispatchedSessionMutation(
						context,
						"record_final_review",
						{ decision: input },
					);
				},
			),
		}),
	};
}
