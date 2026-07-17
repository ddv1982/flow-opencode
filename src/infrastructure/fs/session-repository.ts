import type {
	SessionRepository,
	SessionTransaction,
} from "../../application/ports/session-repository.js";
import {
	archiveAndClearSession,
	assertMutableWorkspaceRoot,
	loadSession,
	quarantineUnreadableSession,
	saveSession,
	withSessionLock,
} from "./workspace.js";

export function createFileSessionRepository(
	workspace: string,
): SessionRepository {
	const root = assertMutableWorkspaceRoot(workspace);
	const transaction: SessionTransaction = {
		load: () => loadSession(root),
		save: (session) => saveSession(root, session),
		archiveAndClear: (session) => archiveAndClearSession(root, session),
		quarantineUnreadable: () => quarantineUnreadableSession(root),
	};
	return {
		read: transaction.load,
		transact: (task) => withSessionLock(root, () => task(transaction)),
	};
}
