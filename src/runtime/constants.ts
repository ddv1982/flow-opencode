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

export function flowResetFeatureCommand(featureId: string): string {
	return `${FLOW_RESET_FEATURE_COMMAND} ${featureId}`;
}

export function flowSessionActivateCommand(sessionId: string): string {
	return `${FLOW_SESSION_ACTIVATE_COMMAND} ${sessionId}`;
}
