import type { listSessionHistory, loadStoredSession } from "../lifecycle";
import type { Session } from "../schema";
import type { SessionReadAction } from "./action-engine";

export const SESSION_READ_ACTION_NAMES = [
	"load_status_session",
	"list_session_history",
	"load_history_session",
] as const;

export type SessionReadActionName = (typeof SESSION_READ_ACTION_NAMES)[number];

export type SessionReadPayloadMap = {
	load_status_session: undefined;
	list_session_history: undefined;
	load_history_session: { sessionId: string };
};

export type SessionReadValueMap = {
	load_status_session: Session | null;
	list_session_history: Awaited<ReturnType<typeof listSessionHistory>>;
	load_history_session: Awaited<ReturnType<typeof loadStoredSession>>;
};

type SessionReadActionHandlerMap = {
	[Name in SessionReadActionName]: (
		payload: SessionReadPayloadMap[Name],
	) => SessionReadAction<SessionReadValueMap[Name], Name>;
};

const READ_ACTION_HANDLERS: SessionReadActionHandlerMap = {
	load_status_session() {
		return {
			name: "load_status_session",
			run: (worktree, runtime) => runtime.loadSession(worktree),
			onSuccess: (session) => ({
				status: session ? "ok" : "missing_session",
				session,
			}),
		};
	},
	list_session_history() {
		return {
			name: "list_session_history",
			run: (worktree, runtime) => runtime.listSessionHistory(worktree),
			onSuccess: (history) => ({ status: "ok", history }),
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
};

export function buildReadAction<Name extends SessionReadActionName>(
	name: Name,
	payload: SessionReadPayloadMap[Name],
): SessionReadAction<SessionReadValueMap[Name], Name> {
	return READ_ACTION_HANDLERS[name](payload);
}
