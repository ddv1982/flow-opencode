import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	getActiveSessionsDir,
	getCompletedSessionsDir,
	getFlowDir,
	getSessionDir,
	getStoredSessionsDir,
	type LiveSessionLocation,
} from "./paths";
import type { Session } from "./schema";
import {
	mergeGitignoreEntries,
	parseGitignoreEntries,
	renderGitignoreEntries,
} from "./session-workspace-gitignore";
import { writeSessionFileAtDir } from "./session-workspace-io";
import {
	assertMutableWorkspaceRoot,
	type MutableWorkspaceRoot,
} from "./workspace-root";

export {
	readSessionFromPath,
	resetSessionWorkspaceFsForTests,
	setSessionWorkspaceFsForTests,
	writeSessionFileAtDir,
} from "./session-workspace-io";
export { withSessionSaveLock } from "./session-workspace-locks";

const preparedWorkspaceGitignoreCache = new Map<string, string>();
const preparedWorkspaceRoots = new Set<string>();

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

async function ensureWorkspaceAtRoot(
	worktree: MutableWorkspaceRoot,
): Promise<void> {
	const flowDir = getFlowDir(worktree);
	await mkdir(getActiveSessionsDir(worktree), { recursive: true });
	await mkdir(getStoredSessionsDir(worktree), { recursive: true });
	await mkdir(getCompletedSessionsDir(worktree), { recursive: true });
	if (!preparedWorkspaceRoots.has(worktree)) {
		preparedWorkspaceRoots.add(worktree);
	}

	const gitignorePath = join(flowDir, ".gitignore");
	let existingEntries: string[] = [];
	let existingContents = "";

	try {
		existingContents = await readFile(gitignorePath, "utf8");
		existingEntries = parseGitignoreEntries(existingContents);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	const nextEntries = mergeGitignoreEntries(existingEntries);
	const nextContents = renderGitignoreEntries(nextEntries);
	if (preparedWorkspaceGitignoreCache.get(gitignorePath) === existingContents) {
		return;
	}

	if (existingContents !== nextContents) {
		await writeFile(gitignorePath, nextContents, "utf8");
	}

	preparedWorkspaceGitignoreCache.set(gitignorePath, nextContents);
}

export async function ensureWorkspace(worktree: string): Promise<void> {
	await ensureWorkspaceAtRoot(assertMutableWorkspaceRoot(worktree));
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

export async function writeSessionFile(
	worktree: string,
	session: Session,
	location: LiveSessionLocation = "active",
): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	await ensureWorkspaceAtRoot(mutableWorktree);
	await writeSessionFileAtDir(
		getSessionDir(mutableWorktree, session.id, location),
		session,
	);
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

export async function resolveActiveSessionId(
	worktree: string,
): Promise<string | null> {
	return readActiveSessionId(worktree);
}
