import { readdir, rename, stat } from "node:fs/promises";
import { relative } from "node:path";
import { getCompletedSessionDir, getCompletedSessionsDir } from "./paths";
import type { Session } from "./schema";
import { toCompletedTimestamp } from "./util";
import type { MutableWorkspaceRoot } from "./workspace-root";

export type CompletedSessionLocation = {
	sessionId: string;
	completedAt: string | null;
	completedDirName: string;
	completedDir: string;
	completedTo: string;
};

export function completedDirectoryName(
	sessionId: string,
	completedAt: string,
	attempt = 0,
): string {
	return `${sessionId}-${completedAt}${attempt === 0 ? "" : `-${attempt}`}`;
}

export function completedTimestampForSession(session: Session): string {
	return toCompletedTimestamp(
		session.timestamps.completedAt ?? session.timestamps.updatedAt,
	);
}

export function parseCompletedDirectoryName(directoryName: string): {
	sessionId: string;
	completedAt: string | null;
} {
	const match = directoryName.match(
		/^(.*)-(\d{8}T\d{6}(?:\.\d{3})?(?:-\d+)?)$/,
	);
	if (!match) {
		return { sessionId: directoryName, completedAt: null };
	}

	return {
		sessionId: match[1] ?? directoryName,
		completedAt: match[2] ?? null,
	};
}

export function compareCompletedDescending(
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

export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}

		throw error;
	}
}

export function buildCompletedSessionLocation(
	worktree: string,
	sessionId: string,
	completedDirName: string,
	completedAt: string | null,
): CompletedSessionLocation {
	const completedDir = getCompletedSessionDir(worktree, completedDirName);
	return {
		sessionId,
		completedAt,
		completedDirName,
		completedDir,
		completedTo: relative(worktree, completedDir),
	};
}

export async function allocateCompletedSessionLocation(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
	completedAt: string,
): Promise<CompletedSessionLocation> {
	for (let attempt = 0; ; attempt += 1) {
		const completedDirName = completedDirectoryName(
			sessionId,
			completedAt,
			attempt,
		);
		const location = buildCompletedSessionLocation(
			worktree,
			sessionId,
			completedDirName,
			completedAt,
		);
		if (!(await pathExists(location.completedDir))) {
			return location;
		}
	}
}

export async function moveSessionDirToCompleted(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
	sourceDir: string,
	completedAt: string,
): Promise<CompletedSessionLocation | null> {
	for (let attempt = 0; ; attempt += 1) {
		const completedDirName = completedDirectoryName(
			sessionId,
			completedAt,
			attempt,
		);
		const location = buildCompletedSessionLocation(
			worktree,
			sessionId,
			completedDirName,
			completedAt,
		);

		try {
			await rename(sourceDir, location.completedDir);
			return location;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				return null;
			}
			if (code === "EEXIST" || code === "ENOTEMPTY") {
				continue;
			}
			throw error;
		}
	}
}

export async function findNewestCompletedSession(
	worktree: string,
	sessionId: string,
): Promise<CompletedSessionLocation | null> {
	const completedRoot = getCompletedSessionsDir(worktree);
	const matches: CompletedSessionLocation[] = [];

	let entries: Array<{ isDirectory(): boolean; name: string }>;
	try {
		entries = await readdir(completedRoot, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const parsed = parseCompletedDirectoryName(entry.name);
		if (parsed.sessionId !== sessionId) continue;
		matches.push(
			buildCompletedSessionLocation(
				worktree,
				sessionId,
				entry.name,
				parsed.completedAt,
			),
		);
	}

	matches.sort((left, right) =>
		compareCompletedDescending(left.completedAt, right.completedAt),
	);
	return matches[0] ?? null;
}
