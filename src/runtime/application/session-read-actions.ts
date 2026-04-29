import type { Session } from "../schema";
import type {
	compareAuditReports,
	listAuditReports,
	listSessionHistory,
	loadAuditReport,
	loadStoredSession,
} from "../session";
import {
	DEFAULT_SESSION_READ_RUNTIME_PORT,
	executeSessionReadActionAtRoot,
	runSessionReadActionAtRoot,
	type SessionReadAction,
	type SessionReadResult,
	type SessionReadRuntimePort,
} from "./session-engine";
import {
	resolveReadableSessionRoot,
	type WorkspaceContext,
} from "./tool-runtime";

export const SESSION_READ_ACTION_NAMES = [
	"load_status_session",
	"list_session_history",
	"load_history_session",
	"list_audit_reports",
	"load_audit_report",
	"compare_audit_reports",
	"load_resumable_session",
] as const;

export type SessionReadActionName = (typeof SESSION_READ_ACTION_NAMES)[number];

export type SessionReadPayloadMap = {
	load_status_session: undefined;
	list_session_history: undefined;
	load_history_session: { sessionId: string };
	list_audit_reports: undefined;
	load_audit_report: { reportId: string };
	compare_audit_reports: { leftReportId: string; rightReportId: string };
	load_resumable_session: undefined;
};

export type SessionReadValueMap = {
	load_status_session: Session | null;
	list_session_history: Awaited<ReturnType<typeof listSessionHistory>>;
	load_history_session: Awaited<ReturnType<typeof loadStoredSession>>;
	list_audit_reports: Awaited<ReturnType<typeof listAuditReports>>;
	load_audit_report: Awaited<ReturnType<typeof loadAuditReport>>;
	compare_audit_reports: Awaited<ReturnType<typeof compareAuditReports>>;
	load_resumable_session: Session | null;
};

type SessionReadActionHandlerMap = {
	[Name in SessionReadActionName]: (
		payload: SessionReadPayloadMap[Name],
	) => SessionReadAction<SessionReadValueMap[Name], Name>;
};

export const SESSION_READ_ACTION_HANDLERS: SessionReadActionHandlerMap = {
	load_status_session(_payload) {
		return {
			name: "load_status_session",
			run: (worktree, runtime) => runtime.loadSession(worktree),
			onSuccess: (session) => ({
				status: session ? "ok" : "missing_session",
				session,
			}),
		};
	},

	list_session_history(_payload) {
		return {
			name: "list_session_history",
			run: (worktree, runtime) => runtime.listSessionHistory(worktree),
			onSuccess: (history) => ({
				status: "ok",
				history,
			}),
		};
	},

	load_history_session({ sessionId }) {
		return {
			name: "load_history_session",
			run: (worktree, runtime) =>
				runtime.loadStoredSession(worktree, sessionId),
			onSuccess: (session) => ({
				status: session ? "ok" : "missing_session",
				session,
			}),
		};
	},

	list_audit_reports(_payload) {
		return {
			name: "list_audit_reports",
			run: (worktree, runtime) => runtime.listAuditReports(worktree),
			onSuccess: (history) => ({
				status: "ok",
				history,
			}),
		};
	},

	load_audit_report({ reportId }) {
		return {
			name: "load_audit_report",
			run: (worktree, runtime) => runtime.loadAuditReport(worktree, reportId),
			onSuccess: (report) => ({
				status: report ? "ok" : "missing_audit",
				report,
			}),
		};
	},

	compare_audit_reports({ leftReportId, rightReportId }) {
		return {
			name: "compare_audit_reports",
			run: (worktree, runtime) =>
				runtime.compareAuditReports(worktree, leftReportId, rightReportId),
			onSuccess: (comparison) => ({
				status: comparison.comparison ? "ok" : "missing_audit",
				comparison,
			}),
		};
	},

	load_resumable_session(_payload) {
		return {
			name: "load_resumable_session",
			run: (worktree, runtime) => runtime.loadSession(worktree),
			onSuccess: (session) => ({
				status: session ? "ok" : "missing_session",
				session,
			}),
		};
	},
};

export function buildSessionReadAction<Name extends SessionReadActionName>(
	name: Name,
	payload: SessionReadPayloadMap[Name],
): SessionReadAction<SessionReadValueMap[Name], Name> {
	return SESSION_READ_ACTION_HANDLERS[name](payload);
}

export function dispatchSessionReadAction<Name extends SessionReadActionName>(
	name: Name,
	payload: SessionReadPayloadMap[Name],
): SessionReadAction<SessionReadValueMap[Name], Name> {
	return buildSessionReadAction(name, payload);
}

export async function executeDispatchedSessionReadAction<
	Name extends SessionReadActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
	runtime: SessionReadRuntimePort = DEFAULT_SESSION_READ_RUNTIME_PORT,
) {
	return executeSessionReadActionAtRoot(
		resolveReadableSessionRoot(context).root,
		dispatchSessionReadAction(name, payload),
		runtime,
	);
}

export async function runDispatchedSessionReadAction<
	Name extends SessionReadActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
	runtime: SessionReadRuntimePort = DEFAULT_SESSION_READ_RUNTIME_PORT,
): Promise<SessionReadResult<SessionReadValueMap[Name], Name>> {
	return runSessionReadActionAtRoot(
		resolveReadableSessionRoot(context).root,
		dispatchSessionReadAction(name, payload),
		runtime,
	);
}
