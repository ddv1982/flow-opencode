import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import {
	getActiveSessionDir,
	getCompletedSessionDir,
	getCompletedSessionPath,
	getCompletedSessionsDir,
	getSessionPath,
	getStoredSessionDir,
	getStoredSessionsDir,
} from "./paths";
import type { Session } from "./schema";
import {
	compareCompletedDescending,
	findNewestCompletedSession,
	parseCompletedDirectoryName,
} from "./session-completed-storage";
import {
	ensureWorkspace,
	readActiveSessionId,
	readSessionFromPath,
} from "./session-workspace";

export type SessionHistoryEntry = {
	id: string;
	goal: string | null;
	status: string;
	closureKind: Session["closure"] extends infer Closure
		? Closure extends { kind: infer Kind }
			? Kind | null
			: null
		: null;
	closureSummary: string | null;
	approval: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	completedAt: string | null;
	active: boolean;
	path: string;
	error?: string;
};

export type CompletedSessionHistoryEntry = SessionHistoryEntry & {
	completedPath: string;
	completedAt: string | null;
};

export type StoredSessionLookup = {
	session: Session;
	source: "active" | "stored" | "completed";
	active: boolean;
	path: string;
	completedPath?: string;
	completedAt?: string | null;
};

function compareIsoDescending(
	left: string | null,
	right: string | null,
): number {
	return (right ?? "").localeCompare(left ?? "");
}

function toHistoryEntry(
	worktree: string,
	session: Session,
	path: string,
	activeSessionId: string | null,
): SessionHistoryEntry {
	return {
		id: session.id,
		goal: session.goal,
		status: session.status,
		closureKind: session.closure?.kind ?? null,
		closureSummary: session.closure?.summary ?? null,
		approval: session.approval,
		createdAt: session.timestamps.createdAt,
		updatedAt: session.timestamps.updatedAt,
		completedAt: session.timestamps.completedAt,
		active: session.id === activeSessionId,
		path: relative(worktree, path),
	};
}

function toInvalidHistoryEntry(
	worktree: string,
	id: string,
	path: string,
	error: unknown,
	activeSessionId: string | null,
): SessionHistoryEntry {
	return {
		id,
		goal: null,
		status: "invalid",
		closureKind: null,
		closureSummary: null,
		approval: null,
		createdAt: null,
		updatedAt: null,
		completedAt: null,
		active: id === activeSessionId,
		path: relative(worktree, path),
		error: error instanceof Error ? error.message : String(error),
	};
}

export async function loadStoredSession(
	worktree: string,
	sessionId: string,
): Promise<StoredSessionLookup | null> {
	await ensureWorkspace(worktree);

	const activeSessionId = await readActiveSessionId(worktree);
	if (activeSessionId === sessionId) {
		const session = await readSessionFromPath(
			getSessionPath(worktree, sessionId, "active"),
		);
		return {
			session,
			source: "active",
			active: true,
			path: relative(worktree, getActiveSessionDir(worktree, sessionId)),
		};
	}

	try {
		const session = await readSessionFromPath(
			getSessionPath(worktree, sessionId, "stored"),
		);
		return {
			session,
			source: "stored",
			active: false,
			path: relative(worktree, getStoredSessionDir(worktree, sessionId)),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	const completed = await findNewestCompletedSession(worktree, sessionId);
	if (!completed) {
		return null;
	}

	const session = await readSessionFromPath(
		getCompletedSessionPath(worktree, completed.completedDirName),
	);
	return {
		session,
		source: "completed",
		active: false,
		path: completed.completedTo,
		completedPath: completed.completedTo,
		completedAt: completed.completedAt,
	};
}

export async function listSessionHistory(worktree: string): Promise<{
	activeSessionId: string | null;
	active: SessionHistoryEntry | null;
	stored: SessionHistoryEntry[];
	completed: CompletedSessionHistoryEntry[];
}> {
	await ensureWorkspace(worktree);

	const activeSessionId = await readActiveSessionId(worktree);
	let active: SessionHistoryEntry | null = null;
	if (activeSessionId) {
		try {
			const session = await readSessionFromPath(
				getSessionPath(worktree, activeSessionId, "active"),
			);
			active = toHistoryEntry(
				worktree,
				session,
				getActiveSessionDir(worktree, activeSessionId),
				activeSessionId,
			);
		} catch (error) {
			active = toInvalidHistoryEntry(
				worktree,
				activeSessionId,
				getActiveSessionDir(worktree, activeSessionId),
				error,
				activeSessionId,
			);
		}
	}

	const storedRoot = getStoredSessionsDir(worktree);
	const completedRoot = getCompletedSessionsDir(worktree);

	const stored: SessionHistoryEntry[] = [];
	for (const entry of await readdir(storedRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const sessionId = entry.name;
		try {
			const session = await readSessionFromPath(
				getSessionPath(worktree, sessionId, "stored"),
			);
			stored.push(
				toHistoryEntry(
					worktree,
					session,
					getStoredSessionDir(worktree, sessionId),
					activeSessionId,
				),
			);
		} catch (error) {
			stored.push(
				toInvalidHistoryEntry(
					worktree,
					sessionId,
					getStoredSessionDir(worktree, sessionId),
					error,
					activeSessionId,
				),
			);
		}
	}
	stored.sort((left, right) =>
		compareIsoDescending(left.updatedAt, right.updatedAt),
	);

	const completed: CompletedSessionHistoryEntry[] = [];
	for (const entry of await readdir(completedRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const completedDir = getCompletedSessionDir(worktree, entry.name);
		const parsed = parseCompletedDirectoryName(entry.name);
		try {
			const session = await readSessionFromPath(
				getCompletedSessionPath(worktree, entry.name),
			);
			completed.push({
				...toHistoryEntry(worktree, session, completedDir, null),
				completedPath: relative(worktree, completedDir),
				completedAt: parsed.completedAt,
				active: false,
			});
		} catch (error) {
			completed.push({
				...toInvalidHistoryEntry(
					worktree,
					parsed.sessionId,
					completedDir,
					error,
					null,
				),
				completedPath: relative(worktree, completedDir),
				completedAt: parsed.completedAt,
				active: false,
			});
		}
	}
	completed.sort((left, right) =>
		compareCompletedDescending(
			left.completedAt ?? left.updatedAt,
			right.completedAt ?? right.updatedAt,
		),
	);

	return { activeSessionId, active, stored, completed };
}
