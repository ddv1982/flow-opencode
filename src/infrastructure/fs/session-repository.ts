import type {
	SessionRepository,
	SessionTransaction,
} from "../../application/ports/session-repository.js";
import { createFileEvidenceArtifactStore } from "./evidence-artifact-store.js";
import { createFileSourceIdentityProvider } from "./source-identity.js";
import {
	archiveAndClearSession,
	assertMutableWorkspaceRoot,
	findArchivedSessionByOperationId,
	loadSession,
	quarantineUnreadableSession,
	saveSession,
	withSessionLock,
} from "./workspace.js";

export function createFileSessionRepository(
	workspace: string,
): SessionRepository {
	const root = assertMutableWorkspaceRoot(workspace);
	const evidenceArtifacts = createFileEvidenceArtifactStore(root);
	const sourceIdentity = createFileSourceIdentityProvider(root);
	const transaction: SessionTransaction = {
		...evidenceArtifacts,
		computeSourceIdentity: () => sourceIdentity.computeSourceIdentity(),
		load: () => loadSession(root),
		findArchivedByOperationId: (operationId) =>
			findArchivedSessionByOperationId(root, operationId),
		save: (session) => saveSession(root, session),
		archiveAndClear: (session) => archiveAndClearSession(root, session),
		quarantineUnreadable: () => quarantineUnreadableSession(root),
	};
	return {
		read: transaction.load,
		transact: (task) => withSessionLock(root, () => task(transaction)),
	};
}
