import {
	FLOW_AUDIT_COMMAND,
	FLOW_AUDITS_COMMAND,
	flowAuditsCompareCommand,
} from "../constants";
import type { AuditReadValueMap } from "./audit-actions";
import type {
	AuditReportComparisonLookup,
	StoredAuditReport,
} from "./audit-engine";

type AuditHistory = AuditReadValueMap["list_audit_reports"];

export function nextCommandForMissingAuditReport() {
	return FLOW_AUDITS_COMMAND;
}

export function nextCommandForAuditHistory(history: AuditHistory) {
	return history.latest
		? `${FLOW_AUDITS_COMMAND} show latest`
		: FLOW_AUDIT_COMMAND;
}

export function nextCommandForStoredAudit(
	requestedReportId: string,
	found: StoredAuditReport,
) {
	if (found.report.achievedDepth === "full_audit") {
		return FLOW_AUDIT_COMMAND;
	}
	return requestedReportId === "latest"
		? FLOW_AUDIT_COMMAND
		: flowAuditsCompareCommand(requestedReportId, "latest");
}

export function nextCommandForAuditComparison(
	comparison: AuditReportComparisonLookup,
) {
	if (comparison.comparison) {
		return `${FLOW_AUDITS_COMMAND} show ${comparison.comparison.right.reportId}`;
	}
	if (comparison.left && !comparison.right) {
		return `${FLOW_AUDITS_COMMAND} show ${comparison.left.reportId}`;
	}
	if (!comparison.left && comparison.right) {
		return `${FLOW_AUDITS_COMMAND} show ${comparison.right.reportId}`;
	}
	return FLOW_AUDIT_COMMAND;
}
