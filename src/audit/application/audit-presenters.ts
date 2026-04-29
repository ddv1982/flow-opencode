import {
	toJson,
	type WorkspaceContextSummary,
} from "../../runtime/application/workspace-runtime";
import type { AuditReadValueMap } from "./audit-actions";

type AuditHistory = AuditReadValueMap["list_audit_reports"];
type AuditComparisonLookup = AuditReadValueMap["compare_audit_reports"];
type StoredAuditRecord = AuditReadValueMap["load_audit_report"];

export function auditHistoryResponse(
	history: AuditHistory,
	nextCommand: string,
) {
	const totalCount = history.reports.length;
	const latestId = history.latest?.reportId ?? null;
	if (totalCount === 0 && !history.latest) {
		return {
			payload: toJson({
				status: "missing_audit",
				summary: "No saved Flow audit reports found.",
				history,
				nextCommand,
			}),
			metadata: { totalCount: 0, latestId: null },
		};
	}
	return {
		payload: toJson({
			status: "ok",
			summary: `Found ${totalCount} saved Flow audit ${totalCount === 1 ? "report" : "reports"}.`,
			history,
			nextCommand,
		}),
		metadata: { totalCount, latestId },
	};
}

export function storedAuditReportResponse(
	reportId: string,
	found: NonNullable<StoredAuditRecord>,
	nextCommand: string,
) {
	return toJson({
		status: "ok",
		summary: `Showing Flow audit report '${reportId}'.`,
		reportId: found.reportId,
		path: found.path,
		report: found.report,
		nextCommand,
	});
}

export function auditComparisonResponse(
	comparison: NonNullable<AuditComparisonLookup["comparison"]>,
	nextCommand: string,
) {
	return {
		payload: toJson({
			status: "ok",
			summary: `Compared Flow audit reports '${comparison.left.reportId}' and '${comparison.right.reportId}'.`,
			leftReportId: comparison.left.reportId,
			rightReportId: comparison.right.reportId,
			leftPath: comparison.left.path,
			rightPath: comparison.right.path,
			comparison,
			nextCommand,
		}),
		metadata: {
			leftReportId: comparison.left.reportId,
			rightReportId: comparison.right.reportId,
			surfaceChanges:
				comparison.surfaces.added.length +
				comparison.surfaces.removed.length +
				comparison.surfaces.changed.length,
			findingChanges:
				comparison.findings.added.length +
				comparison.findings.removed.length +
				comparison.findings.changed.length,
		},
	};
}

export function missingAuditComparisonResponse(
	comparison: AuditComparisonLookup,
	nextCommand: string,
) {
	const missingReportIds = [
		...new Set([
			...(comparison.left ? [] : [comparison.leftReportId]),
			...(comparison.right ? [] : [comparison.rightReportId]),
		]),
	];
	return toJson({
		status: "missing_audit",
		summary: `Missing saved Flow audit report${missingReportIds.length === 1 ? "" : "s"}: ${missingReportIds.join(", ")}.`,
		leftReportId: comparison.leftReportId,
		rightReportId: comparison.rightReportId,
		missingReportIds,
		nextCommand,
	});
}

export function missingAuditReportResponse(
	reportId: string,
	nextCommand: string,
) {
	return toJson({
		status: "missing_audit",
		summary: `No saved Flow audit report exists for id '${reportId}'.`,
		nextCommand,
	});
}

export type { WorkspaceContextSummary };
