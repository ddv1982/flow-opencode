import { tool } from "@opencode-ai/plugin";
import {
	type ReviewRenderView,
	renderReviewReport,
} from "../../audit/report-presenter";
import { ReviewReportSchema } from "../../audit/report-schema";
import {
	errorResponse,
	parseToolArgs,
	toJson,
} from "../../runtime/application";
import { parseStrictJsonObject } from "../../runtime/json/strict-object";
import { withJsonTransportArgs, withParsedArgs } from "../parsed-tool";
import {
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFeatureJsonArgsSchema,
	FlowReviewRecordFeatureJsonArgsShape,
	FlowReviewRecordFinalArgsSchema,
	FlowReviewRecordFinalJsonArgsSchema,
	FlowReviewRecordFinalJsonArgsShape,
	FlowReviewRenderArgsSchema,
	FlowReviewRenderArgsShape,
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
							reviewDepth: input.reviewDepth,
							reviewedSurfaces: input.reviewedSurfaces,
							evidenceSummary: input.evidenceSummary,
						},
					});
					return executeGuardedSessionMutation(context, "record_final_review", {
						decision: input,
					});
				},
			),
		}),

		flow_review_render: tool({
			description:
				"Render a structured Flow review ledger into a human-readable report, structured JSON, or both",
			args: FlowReviewRenderArgsShape,
			execute: withParsedArgs(
				FlowReviewRenderArgsSchema,
				async (input, context: ToolContext) => {
					const parsedJson = parseStrictJsonObject(
						input.reviewJson,
						"reviewJson JSON string",
					);
					if (!parsedJson.ok) {
						return toJson(
							errorResponse(
								"Tool argument validation failed: reviewJson: Expected a valid JSON string payload.",
							),
						);
					}
					const parsedReport = parseToolArgs(
						ReviewReportSchema,
						parsedJson.value,
						"Review report validation failed",
					);
					if (!parsedReport.ok) {
						return parsedReport.response;
					}
					const view = (input.view ?? "human") as ReviewRenderView;
					context.metadata?.({
						title: `Rendered ${parsedReport.value.achievedDepth}`,
						metadata: {
							requestedDepth: parsedReport.value.requestedDepth,
							achievedDepth: parsedReport.value.achievedDepth,
							view,
							findings: parsedReport.value.findings.length,
						},
					});
					return toJson({
						status: "ok",
						summary: "Rendered review report.",
						view,
						requestedDepth: parsedReport.value.requestedDepth,
						achievedDepth: parsedReport.value.achievedDepth,
						findingsCount: parsedReport.value.findings.length,
						report: renderReviewReport(parsedReport.value, view),
					});
				},
			),
		}),
	};
}
