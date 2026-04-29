/**
 * Audit tool boundary: saved audit browsing only.
 */
import { tool } from "@opencode-ai/plugin";
import { withParsedArgs } from "../../tools/parsed-tool";
import type { ToolContext } from "../../tools/schemas";
import { recordToolMetadata } from "../../tools/session-tools/shared";
import {
	auditComparisonResponse,
	auditHistoryResponse,
	missingAuditComparisonResponse,
	missingAuditReportResponse,
	nextCommandForAuditComparison,
	nextCommandForAuditHistory,
	nextCommandForMissingAuditReport,
	nextCommandForStoredAudit,
	runDispatchedAuditReadAction,
	storedAuditReportResponse,
} from "../application";
import {
	FlowAuditCompareArgsSchema,
	FlowAuditCompareArgsShape,
	FlowAuditHistoryArgsSchema,
	FlowAuditHistoryArgsShape,
	FlowAuditShowArgsSchema,
	FlowAuditShowArgsShape,
} from "./schemas";

export function createAuditHistorySessionTools() {
	return {
		flow_audit_history: tool({
			description: "Show saved Flow audit report history",
			args: FlowAuditHistoryArgsShape,
			execute: withParsedArgs(
				FlowAuditHistoryArgsSchema,
				async (_input, context: ToolContext) => {
					const history = (
						await runDispatchedAuditReadAction(
							context,
							"list_audit_reports",
							undefined,
						)
					).value;
					const response = auditHistoryResponse(
						history,
						nextCommandForAuditHistory(history),
					);
					recordToolMetadata(context, "Flow audit history", response.metadata);
					return response.payload;
				},
			),
		}),
		flow_audit_show: tool({
			description: "Show a specific saved Flow audit report by id",
			args: FlowAuditShowArgsShape,
			execute: withParsedArgs(
				FlowAuditShowArgsSchema,
				async (input, context: ToolContext) => {
					const found = (
						await runDispatchedAuditReadAction(context, "load_audit_report", {
							reportId: input.reportId,
						})
					).value;
					recordToolMetadata(context, `Show audit ${input.reportId}`, {
						reportId: input.reportId,
						found: Boolean(found),
					});
					if (!found) {
						return missingAuditReportResponse(
							input.reportId,
							nextCommandForMissingAuditReport(),
						);
					}
					return storedAuditReportResponse(
						input.reportId,
						found,
						nextCommandForStoredAudit(input.reportId, found),
					);
				},
			),
		}),
		flow_audit_compare: tool({
			description: "Compare two saved Flow audit reports by id",
			args: FlowAuditCompareArgsShape,
			execute: withParsedArgs(
				FlowAuditCompareArgsSchema,
				async (input, context: ToolContext) => {
					const comparison = (
						await runDispatchedAuditReadAction(
							context,
							"compare_audit_reports",
							{
								leftReportId: input.leftReportId,
								rightReportId: input.rightReportId,
							},
						)
					).value;
					recordToolMetadata(
						context,
						`Compare audits ${input.leftReportId} and ${input.rightReportId}`,
						{
							leftReportId: input.leftReportId,
							rightReportId: input.rightReportId,
							foundLeft: Boolean(comparison.left),
							foundRight: Boolean(comparison.right),
							hasComparison: Boolean(comparison.comparison),
						},
					);
					if (!comparison.comparison) {
						return missingAuditComparisonResponse(
							comparison,
							nextCommandForAuditComparison(comparison),
						);
					}
					const response = auditComparisonResponse(
						comparison.comparison,
						nextCommandForAuditComparison(comparison),
					);
					recordToolMetadata(
						context,
						"Flow audit comparison",
						response.metadata,
					);
					return response.payload;
				},
			),
		}),
	};
}
