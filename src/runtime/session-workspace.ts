import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
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
	const raw = await readFile(sessionPath, "utf8");
	return SessionSchema.parse(JSON.parse(raw));
}

export async function ensureWorkspace(worktree: string): Promise<void> {
	const flowDir = getFlowDir(worktree);
	await mkdir(getSessionsDir(worktree), { recursive: true });
	await mkdir(getArchiveDir(worktree), { recursive: true });

	const gitignorePath = join(flowDir, ".gitignore");
	let existingEntries: string[] = [];

	try {
		existingEntries = (await readFile(gitignorePath, "utf8"))
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
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

	await writeFile(
		gitignorePath,
		nextEntries.map((entry) => `${entry}\n`).join(""),
		"utf8",
	);
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
	await mkdir(getSessionDir(worktree, session.id), { recursive: true });
	await writeFileAtomically(
		getSessionPath(worktree, session.id),
		`${JSON.stringify(session, null, 2)}\n`,
	);
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
