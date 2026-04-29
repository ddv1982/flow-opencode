export const FLOW_AUDIT_COMMAND = "/flow-audit";
export const FLOW_AUDITS_COMMAND = "/flow-audits";

export const AUDIT_REPORT_ID_PATTERN =
	/^(latest|(?!\.{1,2}$)(?!.*\.\.)[A-Za-z0-9._-]+)$/;
export const AUDIT_REPORT_ID_MESSAGE =
	"Audit report ids must be 'latest' or a safe timestamp-like id";

export const AUDIT_DEPTHS = [
	"broad_audit",
	"deep_audit",
	"full_audit",
] as const;
export const AUDIT_SURFACE_CATEGORIES = [
	"source_runtime",
	"tests",
	"ci_release",
	"docs_config",
	"tooling",
	"other",
] as const;
export const AUDIT_SURFACE_REVIEW_STATUSES = [
	"directly_reviewed",
	"spot_checked",
	"unreviewed",
] as const;
export const AUDIT_FINDING_CATEGORIES = [
	"confirmed_defect",
	"likely_risk",
	"hardening_opportunity",
	"process_gap",
] as const;
export const AUDIT_FINDING_CONFIDENCE = [
	"confirmed",
	"likely",
	"speculative",
] as const;
export const AUDIT_VALIDATION_STATUSES = [
	"passed",
	"failed",
	"partial",
	"not_run",
] as const;

export function flowAuditsCompareCommand(
	leftReportId: string,
	rightReportId: string,
): string {
	return `${FLOW_AUDITS_COMMAND} compare ${leftReportId} ${rightReportId}`;
}
