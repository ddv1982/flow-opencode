import { getSessionPath } from "./paths";
import { renderSessionDocs } from "./render";
import { type Session, SessionSchema } from "./schema";
import {
	readSessionFromPath,
	resolveActiveSessionId,
	withSessionSaveLock,
	writeActiveSessionId,
	writeSessionFile,
} from "./session-workspace";
import { nowIso } from "./time";

function normalizeSession(session: Session): Session {
	return SessionSchema.parse({
		...session,
		timestamps: {
			...session.timestamps,
			updatedAt: nowIso(),
		},
	});
}

export async function loadSession(worktree: string): Promise<Session | null> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return null;
	}

	try {
		return await readSessionFromPath(getSessionPath(worktree, sessionId));
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
	return withSessionSaveLock(worktree, async () => {
		const normalized = normalizeSession(session);
		await writeSessionFile(worktree, normalized);
		await writeActiveSessionId(worktree, normalized.id);
		return normalized;
	});
}

export async function syncSessionArtifacts(
	worktree: string,
	session: Session,
): Promise<void> {
	await renderSessionDocs(worktree, session);
}

export async function saveSession(
	worktree: string,
	session: Session,
): Promise<Session> {
	const normalized = await saveSessionState(worktree, session);
	await syncSessionArtifacts(worktree, normalized);
	return normalized;
}
