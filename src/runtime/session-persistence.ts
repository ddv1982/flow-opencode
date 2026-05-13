import { mkdir, rename } from "node:fs/promises";
import {
	getActiveSessionDir,
	getSessionPath,
	getStoredSessionDir,
	getStoredSessionsDir,
} from "./paths";
import {
	persistCompletedSession,
	syncCompletedSessionArtifacts,
} from "./recovery";
import { renderSessionDocs } from "./rendering";
import type { Session } from "./schema";
import {
	findStoredSessionDir,
	resolveActiveSessionId,
	writeSessionFile,
} from "./session-workspace";
import { readSessionFromPath } from "./session-workspace-io";
import { withSessionSaveLock } from "./session-workspace-locks";
import { nowIso } from "./util";
import {
	assertMutableWorkspaceRoot,
	type MutableWorkspaceRoot,
} from "./workspace-root";

function refreshUpdatedAt(session: Session): Session {
	return {
		...session,
		timestamps: {
			...session.timestamps,
			updatedAt: nowIso(),
		},
	};
}

async function persistOpenSession(
	worktree: MutableWorkspaceRoot,
	session: Session,
	includeArtifacts: boolean,
): Promise<void> {
	const activeSessionId = await resolveActiveSessionId(worktree);
	if (activeSessionId && activeSessionId !== session.id) {
		await mkdir(getStoredSessionsDir(worktree), {
			recursive: true,
		});
		await rename(
			getActiveSessionDir(worktree, activeSessionId),
			getStoredSessionDir(worktree, activeSessionId),
		);
	}

	if (activeSessionId !== session.id) {
		const storedDir = await findStoredSessionDir(worktree, session.id);
		if (storedDir) {
			await rename(storedDir, getActiveSessionDir(worktree, session.id));
		}
	}

	await writeSessionFile(worktree, session, "active");
	if (includeArtifacts) {
		await renderSessionDocs(worktree, session, "active");
	}
}

async function persistSessionByStatus(
	worktree: MutableWorkspaceRoot,
	session: Session,
	includeArtifacts: boolean,
): Promise<void> {
	if (session.status === "completed") {
		await persistCompletedSession(worktree, session, includeArtifacts);
		return;
	}

	await persistOpenSession(worktree, session, includeArtifacts);
}

async function saveSessionWithArtifactsOption(
	worktree: MutableWorkspaceRoot,
	session: Session,
	includeArtifacts: boolean,
): Promise<Session> {
	return withSessionSaveLock(worktree, async () => {
		const normalized = refreshUpdatedAt(session);
		await persistSessionByStatus(worktree, normalized, includeArtifacts);
		return normalized;
	});
}

export async function loadSession(worktree: string): Promise<Session | null> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return null;
	}

	try {
		return await readSessionFromPath(
			getSessionPath(worktree, sessionId, "active"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}

		throw error;
	}
}

export async function saveSessionState(
	worktree: string,
	session: Session,
): Promise<Session> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	return saveSessionWithArtifactsOption(mutableWorktree, session, false);
}

export async function syncSessionArtifacts(
	worktree: string,
	session: Session,
): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	if (session.status === "completed") {
		await syncCompletedSessionArtifacts(mutableWorktree, session);
		return;
	}

	await renderSessionDocs(mutableWorktree, session, "active");
}

export async function saveSession(
	worktree: string,
	session: Session,
): Promise<Session> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	return saveSessionWithArtifactsOption(mutableWorktree, session, true);
}
