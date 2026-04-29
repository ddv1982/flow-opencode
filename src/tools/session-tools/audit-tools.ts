/**
 * Session tool boundary: audit artifact export only.
 * Keep persistence and normalization in runtime/application.
 */
import { tool } from "@opencode-ai/plugin";
import {
	type AuditReportArgs,
	AuditReportBaseSchema,
	AuditReportSchema,
} from "../../runtime/schema";
import { withJsonTransportArgs } from "../parsed-tool";
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
				"Persist a normalized Flow audit report as JSON and Markdown artifacts from a JSON payload",
			args: FlowAuditWriteReportArgsShape,
			execute: withJsonTransportArgs(
				{
					transportSchema: FlowAuditWriteReportArgsSchema,
					field: "reportJson",
					payloadSchema: {
						parse: (input: unknown) =>
							AuditReportSchema.safeParse(input).success
								? AuditReportSchema.parse(input)
								: AuditReportBaseSchema.strict().parse(input),
					},
					legacySchema: {
						parse: (input: unknown) => {
							const value = (input as { report?: unknown } | null)?.report;
							if (value === undefined) {
								return AuditReportSchema.parse(input) as AuditReportArgs;
							}
							return AuditReportSchema.safeParse(value).success
								? AuditReportSchema.parse(value)
								: AuditReportBaseSchema.strict().parse(value);
						},
					},
				},
				async (report, context: ToolContext) => {
					recordToolMetadata(context, "Write audit report", {
						requestedDepth: report.requestedDepth,
						achievedDepth: report.achievedDepth,
						discoveredSurfaceCount: report.discoveredSurfaces.length,
						findingCount: report.findings?.length ?? 0,
					});
					return executeToolWorkspaceAction(context, "write_audit_report", {
						report,
					});
				},
			),
		}),
	};
}
