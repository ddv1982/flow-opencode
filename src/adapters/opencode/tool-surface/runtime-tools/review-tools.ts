import { normalizeReviewReport } from "../../../../audit/report-normalizer";
import {
	type ReviewRenderView,
	renderReviewReport,
} from "../../../../audit/report-presenter";
import { ReviewReportSchema } from "../../../../audit/report-schema";
import { toJson } from "../../../../runtime/application/workspace-runtime";
import { tool } from "../../sdk";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFeatureArgsShape,
	FlowReviewRecordFinalArgsSchema,
	FlowReviewRecordFinalArgsShape,
	FlowReviewRenderArgsSchema,
	FlowReviewRenderArgsShape,
	type ToolContext,
} from "../schemas";
import {
	openCodeToolDescription,
	openCodeToolRuntimeActionName,
} from "../tool-registry";
import {
	executeGuardedSessionMutation,
	resolveFeatureDocDrilldownFromCurrentSession,
} from "./shared";

export function createReviewRuntimeTools() {
	return {
		flow_review_record_feature: tool({
			description: openCodeToolDescription("flow_review_record_feature"),
			args: FlowReviewRecordFeatureArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFeatureArgsSchema,
				async (input, context: ToolContext) => {
					const featureDocDrilldown =
						await resolveFeatureDocDrilldownFromCurrentSession(
							context,
							input.featureId,
						);
					context.metadata?.({
						title: `Reviewer ${input.status} ${input.featureId}`,
						metadata: {
							sessionId: null,
							taskOwner: "flow-reviewer",
							taskPhase: "review",
							taskSubject: `Feature review: ${input.featureId}`,
							taskStatus: "active",
							requestedTaskStatus: input.status,
							featureId: input.featureId,
							status: input.status,
							...(featureDocDrilldown ? { featureDocDrilldown } : {}),
						},
					});
					return executeGuardedSessionMutation(
						context,
						openCodeToolRuntimeActionName(
							"flow_review_record_feature",
							"mutation",
						),
						{ decision: input },
					);
				},
			),
		}),

		flow_review_record_final: tool({
			description: openCodeToolDescription("flow_review_record_final"),
			args: FlowReviewRecordFinalArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFinalArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Final reviewer ${input.status}`,
						metadata: {
							sessionId: null,
							taskOwner: "flow-reviewer",
							taskPhase: "final_review",
							taskSubject: "Final session review",
							taskStatus: "active",
							requestedTaskStatus: input.status,
							status: input.status,
							reviewDepth: input.reviewDepth,
							reviewedSurfaces: input.reviewedSurfaces,
							evidenceSummary: input.evidenceSummary,
							behaviorCheckCount: input.behaviorChecks?.length ?? 0,
							behaviorGapCount: (input.behaviorChecks ?? []).filter(
								(check) => check.result === "gap_recorded",
							).length,
							validationCoverageCount: input.validationCoverage?.length ?? 0,
							reviewScopeLedgerCount: input.reviewScopeLedger?.length ?? 0,
							reviewScopeLedgerStatusCounts: (
								input.reviewScopeLedger ?? []
							).reduce(
								(acc, entry) => {
									acc[entry.status] = (acc[entry.status] ?? 0) + 1;
									return acc;
								},
								{} as Record<string, number>,
							),
						},
					});
					return executeGuardedSessionMutation(
						context,
						openCodeToolRuntimeActionName(
							"flow_review_record_final",
							"mutation",
						),
						{
							decision: input,
						},
					);
				},
			),
		}),

		flow_review_render: tool({
			description: openCodeToolDescription("flow_review_render"),
			args: FlowReviewRenderArgsShape,
			execute: withParsedArgs(
				FlowReviewRenderArgsSchema,
				async (input, context: ToolContext) => {
					const { view: requestedView, ...report } = input;
					const normalizedReport = normalizeReviewReport(
						ReviewReportSchema.parse(report),
					);
					const view = (requestedView ?? "human") as ReviewRenderView;
					context.metadata?.({
						title: `Rendered ${normalizedReport.achievedDepth}`,
						metadata: {
							requestedDepth: normalizedReport.requestedDepth,
							achievedDepth: normalizedReport.achievedDepth,
							view,
							findings: normalizedReport.findings.length,
						},
					});
					return toJson({
						status: "ok",
						summary: "Rendered review report.",
						view,
						requestedDepth: normalizedReport.requestedDepth,
						achievedDepth: normalizedReport.achievedDepth,
						findingsCount: normalizedReport.findings.length,
						report: renderReviewReport(normalizedReport, view),
					});
				},
			),
		}),
	};
}
