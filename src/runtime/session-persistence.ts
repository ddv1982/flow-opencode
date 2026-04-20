import { rename } from "node:fs/promises";
import {
	getActiveSessionDir,
	getSessionPath,
	getStoredSessionDir,
} from "./paths";
import { renderSessionDocs, renderSessionDocsAtDir } from "./render";
import type { Session } from "./schema";
import {
	allocateCompletedSessionLocation,
	completedTimestampForSession,
	findNewestCompletedSession,
	moveSessionDirToCompleted,
} from "./session-completed-storage";
import {
	findStoredSessionDir,
	readSessionFromPath,
	resolveActiveSessionId,
	withSessionSaveLock,
	writeSessionFile,
	writeSessionFileAtDir,
} from "./session-workspace";
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

async function persistCompletedSession(
	worktree: MutableWorkspaceRoot,
	session: Session,
	includeArtifacts: boolean,
): Promise<void> {
	const completedAt = completedTimestampForSession(session);
	const activeSessionId = await resolveActiveSessionId(worktree);
	if (activeSessionId === session.id) {
		const activeDir = getActiveSessionDir(worktree, session.id);
		await writeSessionFileAtDir(activeDir, session);
		if (includeArtifacts) {
			await renderSessionDocsAtDir(activeDir, session);
		}

		const moved = await moveSessionDirToCompleted(
			worktree,
			session.id,
			activeDir,
			completedAt,
		);
		if (!moved) {
			return;
		}
		return;
	}

	const location = await allocateCompletedSessionLocation(
		worktree,
		session.id,
		completedAt,
	);
	await writeSessionFileAtDir(location.completedDir, session);
	if (includeArtifacts) {
		await renderSessionDocsAtDir(location.completedDir, session);
	}
}

async function persistOpenSession(
	worktree: MutableWorkspaceRoot,
	session: Session,
	includeArtifacts: boolean,
): Promise<void> {
	const activeSessionId = await resolveActiveSessionId(worktree);
	if (activeSessionId && activeSessionId !== session.id) {
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
	return withSessionSaveLock(mutableWorktree, async () => {
		const normalized = refreshUpdatedAt(session);
		if (normalized.status === "completed") {
			await persistCompletedSession(mutableWorktree, normalized, false);
		} else {
			await persistOpenSession(mutableWorktree, normalized, false);
		}
		return normalized;
	});
}

export async function syncSessionArtifacts(
	worktree: string,
	session: Session,
): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	if (session.status === "completed") {
		const completed = await findNewestCompletedSession(
			mutableWorktree,
			session.id,
		);
		if (completed) {
			await renderSessionDocsAtDir(completed.completedDir, session);
			return;
		}
		return;
	}

	await renderSessionDocs(mutableWorktree, session, "active");
}

export async function saveSession(
	worktree: string,
	session: Session,
): Promise<Session> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	return withSessionSaveLock(mutableWorktree, async () => {
		const normalized = refreshUpdatedAt(session);
		if (normalized.status === "completed") {
			await persistCompletedSession(mutableWorktree, normalized, true);
		} else {
			await persistOpenSession(mutableWorktree, normalized, true);
		}
		return normalized;
	});
}
