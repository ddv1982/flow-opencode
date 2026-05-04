import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseStrictJsonObject } from "./json/strict-object";
import {
	getActiveSessionsDir,
	getCompletedSessionsDir,
	getFlowDir,
	getSessionDir,
	getSessionPathFromDir,
	getStoredSessionsDir,
	type LiveSessionLocation,
} from "./paths";
import { type Session, SessionSchema } from "./schema";
import {
	mergeGitignoreEntries,
	parseGitignoreEntries,
	renderGitignoreEntries,
} from "./session-workspace-gitignore";
import {
	assertMutableWorkspaceRoot,
	type MutableWorkspaceRoot,
} from "./workspace-root";

export { withSessionSaveLock } from "./session-workspace-locks";

const preparedWorkspaceGitignoreCache = new Map<string, string>();
const preparedWorkspaceRoots = new Set<string>();
const preparedSessionDirs = new Set<string>();
const sessionReadCache = new Map<
	string,
	{
		key: string;
		session: Session;
	}
>();

type SessionWorkspaceFs = {
	open: typeof open;
	rename: typeof rename;
};

const sessionWorkspaceFs: SessionWorkspaceFs = {
	open,
	rename,
};

async function writeFileAtomically(
	targetPath: string,
	contents: string,
): Promise<void> {
	const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
	const fileHandle = await sessionWorkspaceFs.open(tempPath, "w");

	try {
		await fileHandle.writeFile(contents, "utf8");
		await fileHandle.sync();
	} catch (error) {
		await fileHandle.close();
		await rm(tempPath, { force: true });
		throw error;
	}

	await fileHandle.close();

	try {
		await sessionWorkspaceFs.rename(tempPath, targetPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}

	const directoryHandle = await sessionWorkspaceFs.open(
		dirname(targetPath),
		"r",
	);
	try {
		await directoryHandle.sync();
	} catch (error) {
		throw new Error(
			`Atomic session write renamed '${targetPath}' but directory sync failed: ${(error as Error).message}`,
		);
	} finally {
		await directoryHandle.close();
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

export function setSessionWorkspaceFsForTests(
	nextFs: Partial<SessionWorkspaceFs>,
): void {
	if (nextFs.open) {
		sessionWorkspaceFs.open = nextFs.open;
	}
	if (nextFs.rename) {
		sessionWorkspaceFs.rename = nextFs.rename;
	}
}

export function resetSessionWorkspaceFsForTests(): void {
	sessionWorkspaceFs.open = open;
	sessionWorkspaceFs.rename = rename;
}

export async function readSessionFromPath(
	sessionPath: string,
): Promise<Session> {
	const raw = await readFile(sessionPath, "utf8");
	const cacheKey = createHash("sha256").update(raw).digest("hex");
	const cached = sessionReadCache.get(sessionPath);
	if (cached?.key === cacheKey) {
		return structuredClone(cached.session);
	}

	const object = parseStrictJsonObject(raw, "Session file");
	if (!object.ok) {
		throw new Error(object.error);
	}
	const parsed = SessionSchema.parse(object.value);
	sessionReadCache.set(sessionPath, {
		key: cacheKey,
		session: structuredClone(parsed),
	});
	return structuredClone(parsed);
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

export async function writeSessionFileAtDir(
	sessionDir: string,
	session: Session,
): Promise<void> {
	if (preparedSessionDirs.has(sessionDir)) {
		try {
			await stat(sessionDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				preparedSessionDirs.delete(sessionDir);
			} else {
				throw error;
			}
		}
	}

	if (!preparedSessionDirs.has(sessionDir)) {
		await mkdir(sessionDir, { recursive: true });
		preparedSessionDirs.add(sessionDir);
	}
	const sessionPath = getSessionPathFromDir(sessionDir);
	await writeFileAtomically(
		sessionPath,
		`${JSON.stringify(session, null, 2)}\n`,
	);
	sessionReadCache.delete(sessionPath);
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
