import { mkdir, readdir, stat } from "node:fs/promises";
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
import {
	renameSessionWorkspacePath,
	syncSessionWorkspaceDirectory,
} from "./session-workspace-io";
import type { MutableWorkspaceRoot } from "./workspace-root";

type SessionActivationRollbackPhase =
	| "restore_prior_active"
	| "sync_live_parent_directories";

export class SessionActivationRollbackError extends Error {
	readonly code = "SESSION_ACTIVATION_ROLLBACK_FAILED";
	readonly promotionError: unknown;
	readonly rollbackError: unknown;
	readonly rollbackPhase: SessionActivationRollbackPhase;

	constructor(
		message: string,
		promotionError: unknown,
		rollbackError: unknown,
		rollbackPhase: SessionActivationRollbackPhase,
	) {
		super(message, {
			cause: { promotionError, rollbackError, rollbackPhase },
		});
		this.name = "SessionActivationRollbackError";
		this.promotionError = promotionError;
		this.rollbackError = rollbackError;
		this.rollbackPhase = rollbackPhase;
	}
}

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

async function syncLiveSessionParentDirectories(
	worktree: MutableWorkspaceRoot,
): Promise<void> {
	await syncSessionWorkspaceDirectory(getActiveSessionsDir(worktree));
	await syncSessionWorkspaceDirectory(getStoredSessionsDir(worktree));
}

async function parkActiveSession(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<void> {
	await mkdir(getStoredSessionsDir(worktree), { recursive: true });
	await renameSessionWorkspacePath(
		getActiveSessionDir(worktree, sessionId),
		getStoredSessionDir(worktree, sessionId),
	);
}

async function promoteStoredSessionDir(
	worktree: MutableWorkspaceRoot,
	storedDir: string,
	sessionId: string,
): Promise<void> {
	await renameSessionWorkspacePath(
		storedDir,
		getActiveSessionDir(worktree, sessionId),
	);
}

async function rollbackParkedActiveSession(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
	promotionError: unknown,
): Promise<void> {
	try {
		await renameSessionWorkspacePath(
			getStoredSessionDir(worktree, sessionId),
			getActiveSessionDir(worktree, sessionId),
		);
	} catch (rollbackError) {
		throw new SessionActivationRollbackError(
			`Session activation failed after parking the prior active session, and rollback failed: ${(rollbackError as Error).message}`,
			promotionError,
			rollbackError,
			"restore_prior_active",
		);
	}

	try {
		await syncLiveSessionParentDirectories(worktree);
	} catch (rollbackSyncError) {
		throw new SessionActivationRollbackError(
			`Session activation failed after parking the prior active session, and rollback directory sync failed: ${(rollbackSyncError as Error).message}`,
			promotionError,
			rollbackSyncError,
			"sync_live_parent_directories",
		);
	}
}

async function promoteStoredSessionToActive(
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
		try {
			await promoteStoredSessionDir(worktree, storedDir, sessionId);
		} catch (promotionError) {
			await rollbackParkedActiveSession(
				worktree,
				activeSessionId,
				promotionError,
			);
			throw promotionError;
		}
	} else {
		await promoteStoredSessionDir(worktree, storedDir, sessionId);
	}

	await syncLiveSessionParentDirectories(worktree);
	return "activated";
}

export async function activateStoredSessionBoundary(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<"already-active" | "activated" | "missing"> {
	return promoteStoredSessionToActive(worktree, sessionId);
}

export async function makeSessionActive(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
): Promise<void> {
	await promoteStoredSessionToActive(worktree, sessionId);
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
