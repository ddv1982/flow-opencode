/**
 * Session tool boundary: next-command and navigation policy only.
 * Do not register tools or assemble JSON response envelopes here.
 */
import {
	FLOW_AUDIT_COMMAND,
	FLOW_AUDITS_COMMAND,
	FLOW_AUTO_RESUME_COMMAND,
	FLOW_AUTO_WITH_GOAL_COMMAND,
	FLOW_HISTORY_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_STATUS_COMMAND,
	flowAuditsCompareCommand,
	flowSessionActivateCommand,
} from "../../runtime/constants";
import type { Session } from "../../runtime/schema";
import type {
	compareAuditReports,
	listAuditReports,
	listSessionHistory,
	loadAuditReport,
	loadStoredSession,
} from "../../runtime/session";

type AuditHistory = Awaited<ReturnType<typeof listAuditReports>>;
type AuditComparisonLookup = Awaited<ReturnType<typeof compareAuditReports>>;
type StoredAuditRecord = NonNullable<
	Awaited<ReturnType<typeof loadAuditReport>>
>;
type SessionHistory = Awaited<ReturnType<typeof listSessionHistory>>;
type StoredSessionRecord = NonNullable<
	Awaited<ReturnType<typeof loadStoredSession>>
>;

export type AutoPrepareMode = "resume" | "missing_goal" | "start_new_goal";

export function nextCommandForMissingGoal() {
	return FLOW_PLAN_WITH_GOAL_COMMAND;
}

export function nextCommandForMissingStoredSession() {
	return FLOW_HISTORY_COMMAND;
}

export function nextCommandForMissingAuditReport() {
	return FLOW_AUDITS_COMMAND;
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

export function nextCommandForAuditHistory(history: AuditHistory) {
	return history.latest
		? `${FLOW_AUDITS_COMMAND} show latest`
		: FLOW_AUDIT_COMMAND;
}

export function nextCommandForStoredAudit(
	requestedReportId: string,
	found: StoredAuditRecord,
) {
	if (found.report.achievedDepth === "full_audit") {
		return FLOW_AUDIT_COMMAND;
	}
	return requestedReportId === "latest"
		? FLOW_AUDIT_COMMAND
		: flowAuditsCompareCommand(requestedReportId, "latest");
}

export function nextCommandForAuditComparison(
	comparison: AuditComparisonLookup,
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

export function autoPreparePolicy(
	argumentString: string | undefined,
	session?: Session | null,
) {
	const trimmed = (argumentString ?? "").trim();
	const resumableSession =
		session && session.status !== "completed" ? session : null;
	const isResume = trimmed === "" || trimmed === "resume";
	const mode: AutoPrepareMode = isResume
		? resumableSession
			? "resume"
			: "missing_goal"
		: "start_new_goal";
	const goal = resumableSession?.goal ?? (trimmed || null);

	if (mode === "missing_goal") {
		return { mode, goal, nextCommand: FLOW_AUTO_WITH_GOAL_COMMAND };
	}
	if (mode === "resume" && resumableSession) {
		return { mode, goal, nextCommand: FLOW_AUTO_RESUME_COMMAND };
	}
	return { mode, goal, nextCommand: FLOW_STATUS_COMMAND };
}

export function nextCommandForResetSession() {
	return FLOW_PLAN_WITH_GOAL_COMMAND;
}
