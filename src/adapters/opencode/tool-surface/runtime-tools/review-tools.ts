import { normalizeReviewReport } from "../../../../audit/report-normalizer";
import {
	type ReviewRenderView,
	renderReviewReport,
} from "../../../../audit/report-presenter";
import { ReviewReportSchema } from "../../../../audit/report-schema";
import { toJson } from "../../../../runtime/application/workspace-runtime";
import { tool } from "../../sdk";
import { openCodeToolDescription } from "../../tool-projections.generated";
import type { RuntimeActionBinding } from "../descriptors";
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
import { executeGuardedSessionMutation } from "./shared";

export const FLOW_REVIEW_TOOL_RUNTIME_BINDINGS = {
	flow_review_record_feature: {
		kind: "mutation",
		name: "record_feature_review",
	},
	flow_review_record_final: { kind: "mutation", name: "record_final_review" },
} as const satisfies Record<
	string,
	Extract<RuntimeActionBinding, { kind: "mutation" }>
>;

export function createReviewRuntimeTools() {
	return {
		flow_review_record_feature: tool({
			description: openCodeToolDescription("flow_review_record_feature"),
			args: FlowReviewRecordFeatureArgsShape,
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
					return executeGuardedSessionMutation(
						context,
						FLOW_REVIEW_TOOL_RUNTIME_BINDINGS.flow_review_record_feature.name,
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
						FLOW_REVIEW_TOOL_RUNTIME_BINDINGS.flow_review_record_final.name,
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
