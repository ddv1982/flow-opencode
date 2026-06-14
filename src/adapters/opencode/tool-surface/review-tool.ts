/**
 * flow_review_record: one tool for both feature-scoped and final reviewer
 * decisions, discriminated by `scope` (replacing flow_review_record_feature,
 * flow_review_record_final, and flow_review_render — rendering folds into
 * record/status output). Validation is structural zod only; review quality
 * judgment lives in the flow-review skill.
 */
import { tool } from "../sdk";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowReviewRecordArgsSchema,
	FlowReviewRecordArgsShape,
	type ToolContext,
} from "./schemas";
import {
	executeGuardedSessionMutation,
	recordToolMetadata,
	resolveFeatureDocDrilldownFromCurrentSession,
} from "./shared";
import { openCodeToolDescription } from "./tool-registry";

export function createReviewTool() {
	return {
		flow_review_record: tool({
			description: openCodeToolDescription("flow_review_record"),
			args: FlowReviewRecordArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordArgsSchema,
				async (decision, context: ToolContext) => {
					if (decision.scope === "feature") {
						const featureDocDrilldown =
							await resolveFeatureDocDrilldownFromCurrentSession(
								context,
								decision.featureId,
							);
						recordToolMetadata(
							context,
							`Feature review requested ${decision.status} — pending Flow persistence: ${decision.featureId}`,
							{
								sessionId: null,
								metadataAuthority: "requested_only",
								authoritativeStatusSource: "tool_result_json",
								mutationState: "pending_guarded_mutation",
								taskOwner: "flow-reviewer",
								taskPhase: "review",
								taskSubject: `Feature review: ${decision.featureId}`,
								taskStatus: "active",
								requestedReviewStatus: decision.status,
								persistedReviewStatus: null,
								featureId: decision.featureId,
								...(featureDocDrilldown ? { featureDocDrilldown } : {}),
							},
						);
						return executeGuardedSessionMutation(
							context,
							"record_feature_review",
							{ decision },
						);
					}

					recordToolMetadata(
						context,
						`Final reviewer requested ${decision.status} — pending Flow persistence`,
						{
							sessionId: null,
							metadataAuthority: "requested_only",
							authoritativeStatusSource: "tool_result_json",
							mutationState: "pending_guarded_mutation",
							taskOwner: "flow-reviewer",
							taskPhase: "final_review",
							taskSubject: "Final session review",
							taskStatus: "active",
							requestedReviewStatus: decision.status,
							persistedReviewStatus: null,
							reviewDepth: decision.reviewDepth,
							reviewedSurfaces: decision.reviewedSurfaces,
							...(decision.evidenceSummary
								? { evidenceSummary: decision.evidenceSummary }
								: {}),
						},
					);
					return executeGuardedSessionMutation(context, "record_final_review", {
						decision,
					});
				},
			),
		}),
	};
}
