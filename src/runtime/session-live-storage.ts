import { mkdir, readdir, rename, stat } from "node:fs/promises";
import {
	getActiveSessionDir,
	getActiveSessionsDir,
	getSessionDir,
	getStoredSessionDir,
	getStoredSessionsDir,
} from "./paths";
import {
	type CompletedSessionLocation,
	moveSessionDirToCompleted,
} from "./session-completed-storage";
import type { MutableWorkspaceRoot } from "./workspace-root";

async function listDirectoryNames(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}

		throw error;
	}
}

export async function readActiveSessionId(
	worktree: string,
): Promise<string | null> {
	const sessionIds = await listDirectoryNames(getActiveSessionsDir(worktree));
	if (sessionIds.length === 0) {
		return null;
	}
	if (sessionIds.length > 1) {
		throw new Error(
			`Expected exactly one active Flow session directory, found ${sessionIds.length}.`,
		);
	}

	return sessionIds[0] ?? null;
}

export async function resolveActiveSessionId(
	worktree: string,
): Promise<string | null> {
	return readActiveSessionId(worktree);
}

export async function findStoredSessionDir(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<string | null> {
	const sessionDir = getSessionDir(worktree, sessionId, "stored");
	try {
		const details = await stat(sessionDir);
		return details.isDirectory() ? sessionDir : null;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}

		throw error;
	}
}

async function parkActiveSession(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<void> {
	await mkdir(getStoredSessionsDir(worktree), { recursive: true });
	await rename(
		getActiveSessionDir(worktree, sessionId),
		getStoredSessionDir(worktree, sessionId),
	);
}

async function promoteStoredSession(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<boolean> {
	const storedDir = await findStoredSessionDir(worktree, sessionId);
	if (!storedDir) {
		return false;
	}

	await rename(storedDir, getActiveSessionDir(worktree, sessionId));
	return true;
}

export async function activateStoredSessionBoundary(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<"already-active" | "activated" | "missing"> {
	const activeSessionId = await resolveActiveSessionId(worktree);
	if (activeSessionId === sessionId) {
		return "already-active";
	}

	const storedDir = await findStoredSessionDir(worktree, sessionId);
	if (!storedDir) {
		return "missing";
	}

	if (activeSessionId) {
		await parkActiveSession(worktree, activeSessionId);
	}

	await rename(storedDir, getActiveSessionDir(worktree, sessionId));
	return "activated";
}

export async function makeSessionActive(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<void> {
	const activeSessionId = await resolveActiveSessionId(worktree);
	if (activeSessionId && activeSessionId !== sessionId) {
		await parkActiveSession(worktree, activeSessionId);
	}

	if (activeSessionId !== sessionId) {
		await promoteStoredSession(worktree, sessionId);
	}
}

export async function moveActiveSessionToCompleted(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
	completedAt: string,
): Promise<CompletedSessionLocation | null> {
	return moveSessionDirToCompleted(
		worktree,
		sessionId,
		getActiveSessionDir(worktree, sessionId),
		completedAt,
	);
}
