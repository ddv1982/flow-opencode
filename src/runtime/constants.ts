export const FLOW_PLAN_COMMAND = "/flow-plan";
export const FLOW_PLAN_WITH_GOAL_COMMAND = "/flow-plan <goal>";
export const FLOW_RUN_COMMAND = "/flow-run";
export const FLOW_AUTO_COMMAND = "/flow-auto";
export const FLOW_AUTO_WITH_GOAL_COMMAND = "/flow-auto <goal>";
export const FLOW_AUTO_RESUME_COMMAND = "/flow-auto resume";
export const FLOW_STATUS_COMMAND = "/flow-status";
export const FLOW_HISTORY_COMMAND = "/flow-history";
export const FLOW_RESET_FEATURE_COMMAND = "/flow-reset feature";
export const FLOW_RESET_SESSION_COMMAND = "/flow-reset session";
export const FLOW_SESSION_ACTIVATE_COMMAND = "/flow-session activate";

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
export const WORKER_STATUSES = ["ok", "needs_input"] as const;
export const REVIEWER_DECISION_STATUSES = [
	"approved",
	"needs_fix",
	"blocked",
] as const;
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

export const VALIDATION_SCOPES = ["targeted", "broad"] as const;

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
