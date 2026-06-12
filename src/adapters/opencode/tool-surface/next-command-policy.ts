/**
 * Session tool boundary: next-command and navigation policy only.
 * Do not register tools or assemble JSON response envelopes here.
 */
import {
	FLOW_HISTORY_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_STATUS_COMMAND,
	flowSessionActivateCommand,
} from "../../../runtime/constants";
import type {
	listSessionHistory,
	loadStoredSession,
} from "../../../runtime/lifecycle";

type SessionHistory = Awaited<ReturnType<typeof listSessionHistory>>;
type StoredSessionRecord = NonNullable<
	Awaited<ReturnType<typeof loadStoredSession>>
>;

export function nextCommandForMissingGoal() {
	return FLOW_PLAN_WITH_GOAL_COMMAND;
}

export function nextCommandForMissingStoredSession() {
	return FLOW_HISTORY_COMMAND;
}

export function nextCommandForHistory(history: SessionHistory) {
	const resumableStoredSession = history.stored.find(
		(session) => session.status !== "completed",
	);

	if (history.activeSessionId) {
		return FLOW_STATUS_COMMAND;
	}

	return resumableStoredSession
		? flowSessionActivateCommand(resumableStoredSession.id)
		: FLOW_PLAN_WITH_GOAL_COMMAND;
}

export function nextCommandForStoredSession(
	sessionId: string,
	found: StoredSessionRecord,
) {
	if (found.source === "active") {
		return FLOW_STATUS_COMMAND;
	}
	if (found.source === "stored" && found.session.status !== "completed") {
		return flowSessionActivateCommand(sessionId);
	}
	return found.session.status === "completed"
		? FLOW_PLAN_WITH_GOAL_COMMAND
		: FLOW_HISTORY_COMMAND;
}

export function nextCommandForResetSession() {
	return FLOW_PLAN_WITH_GOAL_COMMAND;
}
