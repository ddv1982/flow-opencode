export const FLOW_PLAN_COMMAND = "/flow-plan";
export const FLOW_PLAN_WITH_GOAL_COMMAND = "/flow-plan <goal>";
export const FLOW_RUN_COMMAND = "/flow-run";
export const FLOW_AUTO_COMMAND = "/flow-auto";
export const FLOW_AUTO_WITH_GOAL_COMMAND = "/flow-auto <goal>";
export const FLOW_AUTO_RESUME_COMMAND = "/flow-auto resume";
export const FLOW_AUDIT_COMMAND = "/flow-audit";
export const FLOW_STATUS_COMMAND = "/flow-status";
export const FLOW_DOCTOR_COMMAND = "/flow-doctor";
export const FLOW_HISTORY_COMMAND = "/flow-history";
export const FLOW_AUDITS_COMMAND = "/flow-audits";
export const FLOW_RESET_FEATURE_COMMAND = "/flow-reset feature";
export const FLOW_SESSION_ACTIVATE_COMMAND = "/flow-session activate";
export const FLOW_SESSION_CLOSE_COMMAND = "/flow-session close";

export const CANONICAL_RUNTIME_TOOL_NAMES = [
	"flow_review_record_feature",
	"flow_review_record_final",
	"flow_run_complete_feature",
	"flow_reset_feature",
] as const;

export type CanonicalRuntimeToolName =
	(typeof CANONICAL_RUNTIME_TOOL_NAMES)[number];
export type RuntimeToolName = CanonicalRuntimeToolName;

export const VALIDATION_STATUSES = [
	"passed",
	"failed",
	"failed_existing",
	"partial",
] as const;
export const REVIEW_STATUSES = ["passed", "failed", "needs_followup"] as const;
export const VERIFICATION_STATUSES = [
	"passed",
	"partial",
	"failed",
	"not_recorded",
] as const;
export const GOAL_MODES = [
	"implementation",
	"review",
	"review_and_fix",
] as const;
export const DECOMPOSITION_POLICIES = [
	"atomic_feature",
	"iterative_refinement",
	"open_ended",
] as const;
export const DECISION_MODES = [
	"autonomous_choice",
	"recommend_confirm",
	"human_required",
] as const;
export const DECISION_DOMAINS = [
	"architecture",
	"product",
	"quality",
	"scope",
	"delivery",
] as const;
export const FEATURE_PRIORITIES = [
	"critical",
	"important",
	"nice_to_have",
] as const;
export const PRIORITY_MODES = [
	"strict_scope",
	"balanced",
	"quality_first",
] as const;
export const STOP_RULES = [
	"ship_when_clean",
	"ship_when_core_done",
	"ship_when_threshold_met",
] as const;
export const REVIEW_PURPOSES = ["execution_gate", "completion_gate"] as const;
export const WORKER_STATUSES = ["ok", "needs_input"] as const;
export const REVIEWER_DECISION_STATUSES = [
	"approved",
	"needs_fix",
	"blocked",
] as const;
export const REPLAN_REASONS = [
	"plan_too_broad",
	"hidden_dependency",
	"product_ambiguity",
	"validation_mismatch",
	"implementation_complexity",
	"review_disagreement",
] as const;
export const CLOSURE_KINDS = ["completed", "deferred", "abandoned"] as const;
export const OUTCOME_KINDS = [
	"completed",
	"replan_required",
	"blocked_external",
	"needs_operator_input",
	"contract_error",
] as const;
export const NEEDS_INPUT_OUTCOME_KINDS = [
	"replan_required",
	"blocked_external",
	"needs_operator_input",
	"contract_error",
] as const;

export const FEATURE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FEATURE_ID_MESSAGE = "Feature ids must be lowercase kebab-case";
export const AUDIT_REPORT_ID_PATTERN =
	/^(latest|(?!\.{1,2}$)(?!.*\.\.)[A-Za-z0-9._-]+)$/;
export const AUDIT_REPORT_ID_MESSAGE =
	"Audit report ids must be 'latest' or a safe timestamp-like id";

export const VALIDATION_SCOPES = ["targeted", "broad"] as const;
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

export const FEATURE_REVIEW_SCOPE = "feature";
export const FINAL_REVIEW_SCOPE = "final";
export const REVIEW_SCOPES = [
	FEATURE_REVIEW_SCOPE,
	FINAL_REVIEW_SCOPE,
] as const;

export function flowResetFeatureCommand(featureId: string): string {
	return `${FLOW_RESET_FEATURE_COMMAND} ${featureId}`;
}

export function flowSessionActivateCommand(sessionId: string): string {
	return `${FLOW_SESSION_ACTIVATE_COMMAND} ${sessionId}`;
}

export function flowAuditsCompareCommand(
	leftReportId: string,
	rightReportId: string,
): string {
	return `${FLOW_AUDITS_COMMAND} compare ${leftReportId} ${rightReportId}`;
}
