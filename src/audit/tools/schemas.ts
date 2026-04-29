import { tool } from "@opencode-ai/plugin";
import { AUDIT_REPORT_ID_MESSAGE, AUDIT_REPORT_ID_PATTERN } from "../constants";

const z = tool.schema;
const auditReportIdSchema = z
	.string()
	.min(1)
	.regex(AUDIT_REPORT_ID_PATTERN, AUDIT_REPORT_ID_MESSAGE);
const jsonPayloadSchema = z.string().trim().min(1);

export const FlowAuditReportsActionSchema = z.enum([
	"history",
	"show",
	"compare",
]);
export const FlowAuditReportsArgsShape = {
	action: FlowAuditReportsActionSchema,
	reportId: auditReportIdSchema.optional(),
	leftReportId: auditReportIdSchema.optional(),
	rightReportId: auditReportIdSchema.optional(),
};
export const FlowAuditReportsTransportArgsShape = {
	requestJson: jsonPayloadSchema,
};
export const FlowAuditWriteReportArgsShape = {
	reportJson: jsonPayloadSchema,
};

export const FlowAuditReportsArgsSchema = z
	.object(FlowAuditReportsArgsShape)
	.superRefine((value, context) => {
		if (value.action === "show" && !value.reportId) {
			context.addIssue({
				code: "custom",
				message: "reportId is required when action is 'show'.",
				path: ["reportId"],
			});
		}
		if (
			value.action === "compare" &&
			(!value.leftReportId || !value.rightReportId)
		) {
			if (!value.leftReportId) {
				context.addIssue({
					code: "custom",
					message: "leftReportId is required when action is 'compare'.",
					path: ["leftReportId"],
				});
			}
			if (!value.rightReportId) {
				context.addIssue({
					code: "custom",
					message: "rightReportId is required when action is 'compare'.",
					path: ["rightReportId"],
				});
			}
		}
	});
export const FlowAuditReportsTransportArgsSchema = z.object(
	FlowAuditReportsTransportArgsShape,
);
export const FlowAuditWriteReportArgsSchema = z.object(
	FlowAuditWriteReportArgsShape,
);
