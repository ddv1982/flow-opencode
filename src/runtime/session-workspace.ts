import {
	mkdir,
	open,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
	getActiveSessionPath,
	getArchiveDir,
	getFlowDir,
	getLegacyDocsDir,
	getLegacySessionPath,
	getSessionDir,
	getSessionPath,
	getSessionsDir,
} from "./paths";
import { renderSessionDocs } from "./render";
import { type Session, SessionSchema } from "./schema";

const FLOW_GITIGNORE_ENTRIES = ["active", "sessions/", "archive/"] as const;
const sessionSaveQueues = new Map<string, Promise<void>>();
const preparedWorkspaceGitignoreCache = new Map<string, string>();
const preparedWorkspaceRoots = new Set<string>();
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
	const tempPath = `${targetPath}.tmp`;
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

export async function withSessionSaveLock<T>(
	worktree: string,
	task: () => Promise<T>,
): Promise<T> {
	const previous = sessionSaveQueues.get(worktree) ?? Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	sessionSaveQueues.set(
		worktree,
		previous.then(() => current),
	);

	await previous;

	try {
		return await task();
	} finally {
		release();
		if (sessionSaveQueues.get(worktree) === current) {
			sessionSaveQueues.delete(worktree);
		}
	}
}

export async function readSessionFromPath(
	sessionPath: string,
): Promise<Session> {
	const { mtimeMs, size } = await stat(sessionPath);
	const cacheKey = `${mtimeMs}:${size}`;
	const cached = sessionReadCache.get(sessionPath);
	if (cached?.key === cacheKey) {
		return cached.session;
	}

	const raw = await readFile(sessionPath, "utf8");
	const parsed = SessionSchema.parse(JSON.parse(raw));
	sessionReadCache.set(sessionPath, {
		key: cacheKey,
		session: parsed,
	});
	return parsed;
}

export async function ensureWorkspace(worktree: string): Promise<void> {
	const flowDir = getFlowDir(worktree);
	if (!preparedWorkspaceRoots.has(worktree)) {
		await mkdir(getSessionsDir(worktree), { recursive: true });
		await mkdir(getArchiveDir(worktree), { recursive: true });
		preparedWorkspaceRoots.add(worktree);
	}

	const gitignorePath = join(flowDir, ".gitignore");
	let existingEntries: string[] = [];
	let existingContents = "";

	try {
		existingContents = await readFile(gitignorePath, "utf8");
		existingEntries = existingContents
			.split(/\r?\n/)
			.filter((line) => line.length > 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	const nextEntries = [...existingEntries];
	for (const entry of FLOW_GITIGNORE_ENTRIES) {
		if (!nextEntries.includes(entry)) {
			nextEntries.push(entry);
		}
	}

	const nextContents = nextEntries.map((entry) => `${entry}\n`).join("");
	if (preparedWorkspaceGitignoreCache.get(gitignorePath) === existingContents) {
		return;
	}

	if (existingContents !== nextContents) {
		await writeFile(gitignorePath, nextContents, "utf8");
	}

	preparedWorkspaceGitignoreCache.set(gitignorePath, nextContents);
}

export async function readActiveSessionId(
	worktree: string,
): Promise<string | null> {
	try {
		const raw = await readFile(getActiveSessionPath(worktree), "utf8");
		const value = raw.trim();
		return value || null;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}

		throw error;
	}
}

export async function writeActiveSessionId(
	worktree: string,
	sessionId: string | null,
): Promise<void> {
	await ensureWorkspace(worktree);

	if (!sessionId) {
		await rm(getActiveSessionPath(worktree), { force: true });
		return;
	}

	await writeFileAtomically(getActiveSessionPath(worktree), `${sessionId}\n`);
}

export async function writeSessionFile(
	worktree: string,
	session: Session,
): Promise<void> {
	await ensureWorkspace(worktree);
	const sessionPath = getSessionPath(worktree, session.id);
	await mkdir(getSessionDir(worktree, session.id), { recursive: true });
	await writeFileAtomically(
		sessionPath,
		`${JSON.stringify(session, null, 2)}\n`,
	);
	sessionReadCache.delete(sessionPath);
}

export async function migrateLegacySessionIfNeeded(
	worktree: string,
): Promise<void> {
	if (await readActiveSessionId(worktree)) {
		return;
	}

	const legacySessionPath = getLegacySessionPath(worktree);
	let raw: string;

	try {
		raw = await readFile(legacySessionPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}

		throw error;
	}

	const session = SessionSchema.parse(JSON.parse(raw));
	await ensureWorkspace(worktree);
	await writeSessionFile(worktree, session);
	await renderSessionDocs(worktree, session);
	await writeActiveSessionId(worktree, session.id);
	await rm(legacySessionPath, { force: true });
	await rm(getLegacyDocsDir(worktree), { recursive: true, force: true });
}

export async function resolveActiveSessionId(
	worktree: string,
): Promise<string | null> {
	await migrateLegacySessionIfNeeded(worktree);
	return readActiveSessionId(worktree);
}
