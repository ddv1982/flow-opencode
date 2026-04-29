import { tool } from "@opencode-ai/plugin";
import { AUDIT_REPORT_ID_MESSAGE, AUDIT_REPORT_ID_PATTERN } from "../constants";

const z = tool.schema;

export const FlowAuditHistoryArgsShape = {};
export const FlowAuditShowArgsShape = {
	reportId: z
		.string()
		.min(1)
		.regex(AUDIT_REPORT_ID_PATTERN, AUDIT_REPORT_ID_MESSAGE),
};
export const FlowAuditCompareArgsShape = {
	leftReportId: z
		.string()
		.min(1)
		.regex(AUDIT_REPORT_ID_PATTERN, AUDIT_REPORT_ID_MESSAGE),
	rightReportId: z
		.string()
		.min(1)
		.regex(AUDIT_REPORT_ID_PATTERN, AUDIT_REPORT_ID_MESSAGE),
};
const jsonPayloadSchema = z.string().trim().min(1);
export const FlowAuditWriteReportArgsShape = {
	reportJson: jsonPayloadSchema,
};

export const FlowAuditHistoryArgsSchema = z.object(FlowAuditHistoryArgsShape);
export const FlowAuditShowArgsSchema = z.object(FlowAuditShowArgsShape);
export const FlowAuditCompareArgsSchema = z.object(FlowAuditCompareArgsShape);
export const FlowAuditWriteReportArgsSchema = z.object(
	FlowAuditWriteReportArgsShape,
);
