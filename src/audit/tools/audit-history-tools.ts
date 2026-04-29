/**
 * Audit tool boundary: saved audit browsing only.
 */
import { tool } from "@opencode-ai/plugin";
import { errorResponse, toJson } from "../../runtime/application";
import { withParsedArgs } from "../../tools/parsed-tool";
import type { ToolContext } from "../../tools/schemas";
import { recordToolMetadata } from "../../tools/session-tools/shared";
import {
	FlowAuditReportsArgsSchema,
	FlowAuditReportsArgsShape,
} from "./schemas";

export function createAuditHistorySessionTools() {
	return {
		flow_audit_reports: tool({
			description:
				"Inspect saved Flow audit reports by listing history, showing one report, or comparing two reports",
			args: FlowAuditReportsArgsShape,
			execute: withParsedArgs(
				FlowAuditReportsArgsSchema,
				async (input, context: ToolContext) => {
					const application = await import("../application");
					switch (input.action) {
						case "history": {
							const history = (
								await application.runDispatchedAuditReadAction(
									context,
									"list_audit_reports",
									undefined,
								)
							).value;
							const response = application.auditHistoryResponse(
								history,
								application.nextCommandForAuditHistory(history),
							);
							recordToolMetadata(
								context,
								"Flow audit history",
								response.metadata,
							);
							return response.payload;
						}
						case "show": {
							const reportId = input.reportId;
							if (!reportId) {
								return toJson(
									errorResponse(
										"Tool argument validation failed: reportId is required when action is 'show'.",
									),
								);
							}
							const found = (
								await application.runDispatchedAuditReadAction(
									context,
									"load_audit_report",
									{ reportId },
								)
							).value;
							recordToolMetadata(context, `Show audit ${reportId}`, {
								reportId,
								found: Boolean(found),
							});
							if (!found) {
								return application.missingAuditReportResponse(
									reportId,
									application.nextCommandForMissingAuditReport(),
								);
							}
							return application.storedAuditReportResponse(
								reportId,
								found,
								application.nextCommandForStoredAudit(reportId, found),
							);
						}
						case "compare": {
							const leftReportId = input.leftReportId;
							const rightReportId = input.rightReportId;
							if (!leftReportId || !rightReportId) {
								return toJson(
									errorResponse(
										"Tool argument validation failed: leftReportId and rightReportId are required when action is 'compare'.",
									),
								);
							}
							const comparison = (
								await application.runDispatchedAuditReadAction(
									context,
									"compare_audit_reports",
									{
										leftReportId,
										rightReportId,
									},
								)
							).value;
							recordToolMetadata(
								context,
								`Compare audits ${leftReportId} and ${rightReportId}`,
								{
									leftReportId,
									rightReportId,
									foundLeft: Boolean(comparison.left),
									foundRight: Boolean(comparison.right),
									hasComparison: Boolean(comparison.comparison),
								},
							);
							if (!comparison.comparison) {
								return application.missingAuditComparisonResponse(
									comparison,
									application.nextCommandForAuditComparison(comparison),
								);
							}
							const response = application.auditComparisonResponse(
								comparison.comparison,
								application.nextCommandForAuditComparison(comparison),
							);
							recordToolMetadata(
								context,
								"Flow audit comparison",
								response.metadata,
							);
							return response.payload;
						}
					}
				},
			),
		}),
	};
}
