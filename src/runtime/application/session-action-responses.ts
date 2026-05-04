import { FLOW_PLAN_WITH_GOAL_COMMAND } from "../constants";
import type { Feature, Session } from "../schema";
import { summarizeSession } from "../summary";

export const MISSING_PLANNING_SESSION_RESPONSE = {
	status: "missing_session",
	summary: "No active Flow planning session exists.",
	nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
} as const;

export const MISSING_SESSION_RESPONSE = {
	status: "missing_session",
	summary: "No active Flow session exists.",
	nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
} as const;

export function summarizedSession(saved: Session) {
	return summarizeSession(saved).session;
}

export function okWithSession(saved: Session, summary: string) {
	return {
		status: "ok" as const,
		summary,
		session: summarizedSession(saved),
	};
}

export function startRunSuccess(
	saved: Session,
	value: { session: Session; feature: Feature | null; reason?: string },
) {
	const summary = summarizeSession(saved);
	return {
		status:
			value.reason === "complete"
				? "complete"
				: value.feature
					? "ok"
					: "blocked",
		summary: summary.summary,
		session: summary.session,
		feature: value.feature,
		reason: value.reason,
	};
}

export function completeRunSuccess(saved: Session) {
	const summary = summarizeSession(saved);
	return {
		status: "ok" as const,
		summary: summary.summary,
		session: summary.session,
	};
}
