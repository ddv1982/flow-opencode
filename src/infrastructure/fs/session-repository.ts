import type { SessionRepository } from "../../application/ports/session-repository.js";
import { withSessionLock } from "./session-lock.js";
import { createFileSourceIdentityProvider } from "./source-identity.js";
import {
	archiveAndClearSession,
	confirmActiveSessionDurability,
	loadArchivedSession,
	loadSession,
	quarantineUnreadableSession,
	saveSession,
} from "./workspace.js";
import { assertMutableWorkspaceRoot } from "./workspace-paths.js";

export function createFileSessionRepository(
	workspace: string,
): SessionRepository {
	const root = assertMutableWorkspaceRoot(workspace);
	const source = createFileSourceIdentityProvider(root);
	const transaction = {
		load: () => loadSession(root),
		loadArchive: (sessionId: string) => loadArchivedSession(root, sessionId),
		save: (session: Parameters<typeof saveSession>[1]) =>
			saveSession(root, session),
		confirmActiveDurability: (
			session: Parameters<typeof confirmActiveSessionDurability>[1],
		) => confirmActiveSessionDurability(root, session),
		archiveAndClear: (session: Parameters<typeof archiveAndClearSession>[1]) =>
			archiveAndClearSession(root, session),
		quarantineUnreadable: () => quarantineUnreadableSession(root),
		computeSourceDigest: () => source.computeSourceDigest(),
	};
	return {
		read: transaction.load,
		transact: (task) => withSessionLock(root, () => task(transaction)),
	};
}
