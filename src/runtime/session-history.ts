import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
	getArchiveDir,
	getSessionDir,
	getSessionPath,
	getSessionsDir,
} from "./paths";
import type { Session } from "./schema";
import {
	ensureWorkspace,
	readActiveSessionId,
	readSessionFromPath,
} from "./session-workspace";

export type SessionHistoryEntry = {
	id: string;
	goal: string | null;
	status: string;
	approval: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	completedAt: string | null;
	active: boolean;
	path: string;
	error?: string;
};

export type ArchivedSessionHistoryEntry = SessionHistoryEntry & {
	archivePath: string;
	archivedAt: string | null;
};

export type StoredSessionLookup = {
	session: Session;
	source: "sessions" | "archive";
	active: boolean;
	path: string;
	archivePath?: string;
	archivedAt?: string | null;
};

function compareIsoDescending(
	left: string | null,
	right: string | null,
): number {
	return (right ?? "").localeCompare(left ?? "");
}

function compareArchiveDescending(
	left: string | null,
	right: string | null,
): number {
	const normalize = (value: string | null): [string, number] => {
		if (!value) return ["", -1];
		const match = value.match(/^(.*?)(?:-(\d+))?$/);
		return [
			match?.[1] ?? value,
			match?.[2] ? Number.parseInt(match[2], 10) : 0,
		];
	};

	const [rightBase, rightSuffix] = normalize(right);
	const [leftBase, leftSuffix] = normalize(left);
	const baseComparison = rightBase.localeCompare(leftBase);
	if (baseComparison !== 0) {
		return baseComparison;
	}

	return rightSuffix - leftSuffix;
}

function toHistoryEntry(
	worktree: string,
	session: Session,
	activeSessionId: string | null,
): SessionHistoryEntry {
	return {
		id: session.id,
		goal: session.goal,
		status: session.status,
		approval: session.approval,
		createdAt: session.timestamps.createdAt,
		updatedAt: session.timestamps.updatedAt,
		completedAt: session.timestamps.completedAt,
		active: session.id === activeSessionId,
		path: relative(worktree, getSessionDir(worktree, session.id)),
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
		approval: null,
		createdAt: null,
		updatedAt: null,
		completedAt: null,
		active: id === activeSessionId,
		path: relative(worktree, path),
		error: error instanceof Error ? error.message : String(error),
	};
}

function parseArchiveDirectoryName(directoryName: string): {
	sessionId: string;
	archivedAt: string | null;
} {
	const match = directoryName.match(
		/^(.*)-(\d{8}T\d{6}\.\d{3}(?:-\d+)?|\d{8}T?\d{6}|\d{14})$/,
	);
	if (!match) {
		return { sessionId: directoryName, archivedAt: null };
	}

	return {
		sessionId: match[1] ?? directoryName,
		archivedAt: match[2] ?? null,
	};
}

async function findArchivedSessionDirectory(
	worktree: string,
	sessionId: string,
): Promise<{ archiveDir: string; archivedAt: string | null } | null> {
	const archiveRoot = getArchiveDir(worktree);
	const matches: Array<{ archiveDir: string; archivedAt: string | null }> = [];

	for (const entry of await readdir(archiveRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const parsed = parseArchiveDirectoryName(entry.name);
		if (parsed.sessionId !== sessionId) continue;
		matches.push({
			archiveDir: join(archiveRoot, entry.name),
			archivedAt: parsed.archivedAt,
		});
	}

	matches.sort((left, right) =>
		compareArchiveDescending(left.archivedAt, right.archivedAt),
	);
	return matches[0] ?? null;
}

export async function loadStoredSession(
	worktree: string,
	sessionId: string,
): Promise<StoredSessionLookup | null> {
	await ensureWorkspace(worktree);

	const activeSessionId = await readActiveSessionId(worktree);

	try {
		const session = await readSessionFromPath(
			getSessionPath(worktree, sessionId),
		);
		return {
			session,
			source: "sessions",
			active: sessionId === activeSessionId,
			path: relative(worktree, getSessionDir(worktree, sessionId)),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	const archived = await findArchivedSessionDirectory(worktree, sessionId);
	if (!archived) {
		return null;
	}

	const session = await readSessionFromPath(
		join(archived.archiveDir, "session.json"),
	);
	return {
		session,
		source: "archive",
		active: false,
		path: relative(worktree, archived.archiveDir),
		archivePath: relative(worktree, archived.archiveDir),
		archivedAt: archived.archivedAt,
	};
}

export async function listSessionHistory(worktree: string): Promise<{
	activeSessionId: string | null;
	sessions: SessionHistoryEntry[];
	archived: ArchivedSessionHistoryEntry[];
}> {
	await ensureWorkspace(worktree);

	const activeSessionId = await readActiveSessionId(worktree);
	const sessionsRoot = getSessionsDir(worktree);
	const archiveRoot = getArchiveDir(worktree);

	const sessions: SessionHistoryEntry[] = [];
	for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const sessionId = entry.name;
		const sessionPath = getSessionPath(worktree, sessionId);
		try {
			const session = await readSessionFromPath(sessionPath);
			sessions.push(toHistoryEntry(worktree, session, activeSessionId));
		} catch (error) {
			sessions.push(
				toInvalidHistoryEntry(
					worktree,
					sessionId,
					getSessionDir(worktree, sessionId),
					error,
					activeSessionId,
				),
			);
		}
	}
	sessions.sort((left, right) =>
		compareIsoDescending(left.updatedAt, right.updatedAt),
	);

	const archived: ArchivedSessionHistoryEntry[] = [];
	for (const entry of await readdir(archiveRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const archiveDir = join(archiveRoot, entry.name);
		const { sessionId, archivedAt } = parseArchiveDirectoryName(entry.name);
		try {
			const session = await readSessionFromPath(
				join(archiveDir, "session.json"),
			);
			archived.push({
				...toHistoryEntry(worktree, session, null),
				path: relative(worktree, archiveDir),
				archivePath: relative(worktree, archiveDir),
				archivedAt,
				active: false,
			});
		} catch (error) {
			archived.push({
				...toInvalidHistoryEntry(worktree, sessionId, archiveDir, error, null),
				archivePath: relative(worktree, archiveDir),
				archivedAt,
				active: false,
			});
		}
	}
	archived.sort((left, right) =>
		compareArchiveDescending(
			left.archivedAt ?? left.updatedAt,
			right.archivedAt ?? right.updatedAt,
		),
	);

	return { activeSessionId, sessions, archived };
}
