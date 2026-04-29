/**
 * Session tool boundary: saved audit browsing only.
 * Keep response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";
import {
	auditComparisonResponse,
	auditHistoryResponse,
	missingAuditComparisonResponse,
	missingAuditReportResponse,
	storedAuditReportResponse,
} from "../../runtime/application";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowAuditCompareArgsSchema,
	FlowAuditCompareArgsShape,
	FlowAuditHistoryArgsSchema,
	FlowAuditHistoryArgsShape,
	FlowAuditShowArgsSchema,
	FlowAuditShowArgsShape,
	type ToolContext,
} from "../schemas";
import {
	nextCommandForAuditComparison,
	nextCommandForAuditHistory,
	nextCommandForMissingAuditReport,
	nextCommandForStoredAudit,
} from "./next-command-policy";
import { readToolSessionValue, recordToolMetadata } from "./shared";

export function createAuditHistorySessionTools() {
	return {
		flow_audit_history: tool({
			description: "Show saved Flow audit report history",
			args: FlowAuditHistoryArgsShape,
			execute: withParsedArgs(
				FlowAuditHistoryArgsSchema,
				async (_input, context: ToolContext) => {
					const history = await readToolSessionValue(
						context,
						"list_audit_reports",
						undefined,
					);
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
					const found = await readToolSessionValue(
						context,
						"load_audit_report",
						{ reportId: input.reportId },
					);
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
					const comparison = await readToolSessionValue(
						context,
						"compare_audit_reports",
						{
							leftReportId: input.leftReportId,
							rightReportId: input.rightReportId,
						},
					);
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
