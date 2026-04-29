import { tool } from "@opencode-ai/plugin";
import { withJsonTransportArgs } from "../parsed-tool";
import {
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFeatureJsonArgsSchema,
	FlowReviewRecordFeatureJsonArgsShape,
	FlowReviewRecordFinalArgsSchema,
	FlowReviewRecordFinalJsonArgsSchema,
	FlowReviewRecordFinalJsonArgsShape,
	type ToolContext,
} from "../schemas";
import { executeGuardedSessionMutation } from "./shared";

export function createReviewRuntimeTools() {
	return {
		flow_review_record_feature: tool({
			description:
				"Record an already-validated reviewer decision for the active feature from a JSON payload",
			args: FlowReviewRecordFeatureJsonArgsShape,
			execute: withJsonTransportArgs(
				{
					transportSchema: FlowReviewRecordFeatureJsonArgsSchema,
					field: "decisionJson",
					payloadSchema: FlowReviewRecordFeatureArgsSchema,
					legacySchema: FlowReviewRecordFeatureArgsSchema,
				},
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Reviewer ${input.status} ${input.featureId}`,
						metadata: {
							sessionId: null,
							featureId: input.featureId,
							status: input.status,
						},
					});
					return executeGuardedSessionMutation(
						context,
						"record_feature_review",
						{ decision: input },
					);
				},
			),
		}),

		flow_review_record_final: tool({
			description:
				"Record an already-validated reviewer decision for final cross-feature validation from a JSON payload",
			args: FlowReviewRecordFinalJsonArgsShape,
			execute: withJsonTransportArgs(
				{
					transportSchema: FlowReviewRecordFinalJsonArgsSchema,
					field: "decisionJson",
					payloadSchema: FlowReviewRecordFinalArgsSchema,
					legacySchema: FlowReviewRecordFinalArgsSchema,
				},
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Final reviewer ${input.status}`,
						metadata: {
							sessionId: null,
							status: input.status,
						},
					});
					return executeGuardedSessionMutation(context, "record_final_review", {
						decision: input,
					});
				},
			),
		}),
	};
}
