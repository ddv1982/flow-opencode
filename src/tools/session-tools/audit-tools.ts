/**
 * Session tool boundary: audit artifact export only.
 * Keep persistence and normalization in runtime/application.
 */
import { tool } from "@opencode-ai/plugin";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowAuditWriteReportArgsSchema,
	FlowAuditWriteReportArgsShape,
	type ToolContext,
} from "../schemas";
import { executeToolWorkspaceAction, recordToolMetadata } from "./shared";

export function createAuditSessionTools() {
	return {
		flow_audit_write_report: tool({
			description:
				"Persist a normalized Flow audit report as JSON and Markdown artifacts",
			args: FlowAuditWriteReportArgsShape,
			execute: withParsedArgs(
				FlowAuditWriteReportArgsSchema,
				async (input, context: ToolContext) => {
					recordToolMetadata(context, "Write audit report", {
						requestedDepth: input.report.requestedDepth,
						achievedDepth: input.report.achievedDepth,
						discoveredSurfaceCount: input.report.discoveredSurfaces.length,
						findingCount: input.report.findings.length,
					});
					return executeToolWorkspaceAction(context, "write_audit_report", {
						report: input.report,
					});
				},
			),
		}),
	};
}
