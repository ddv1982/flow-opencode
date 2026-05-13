import { mkdir, readFile, writeFile } from "node:fs/promises";
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
	findStoredSessionDir,
	readActiveSessionId,
	resolveActiveSessionId,
} from "./session-live-storage";
export {
	readSessionFromPath,
	resetSessionWorkspaceFsForTests,
	setSessionWorkspaceFsForTests,
	writeSessionFileAtDir,
} from "./session-workspace-io";
export { withSessionSaveLock } from "./session-workspace-locks";

const preparedWorkspaceGitignoreCache = new Map<string, string>();
const preparedWorkspaceRoots = new Set<string>();

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
