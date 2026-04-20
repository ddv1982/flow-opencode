import type { Session } from "../schema";
import type { listSessionHistory, loadStoredSession } from "../session";
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
	"load_resumable_session",
] as const;

export type SessionReadActionName = (typeof SESSION_READ_ACTION_NAMES)[number];

export type SessionReadPayloadMap = {
	load_status_session: undefined;
	list_session_history: undefined;
	load_history_session: { sessionId: string };
	load_resumable_session: undefined;
};

export type SessionReadValueMap = {
	load_status_session: Session | null;
	list_session_history: Awaited<ReturnType<typeof listSessionHistory>>;
	load_history_session: Awaited<ReturnType<typeof loadStoredSession>>;
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
