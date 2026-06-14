import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseStrictJsonObject } from "./json/strict-object";
import { type Session, SessionSchema } from "./schema";

export class InvalidFlowWorkspaceRootError extends Error {
	readonly code = "INVALID_FLOW_WORKSPACE_ROOT";
	constructor(message: string) {
		super(message);
		this.name = "InvalidFlowWorkspaceRootError";
	}
}

export function normalizeWorkspaceRoot(
	rawPath: string | undefined,
): string | null {
	const value = rawPath?.trim();
	if (!value) return null;
	const normalized = resolve(value);
	return parse(normalized).root === normalized ? null : normalized;
}

export function assertMutableWorkspaceRoot(rawPath: string): string {
	const root = normalizeWorkspaceRoot(rawPath);
	if (!root) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow requires a non-root workspace path.",
		);
	}
	if (root === resolve(process.env.HOME ?? homedir())) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow refuses to use $HOME itself as a mutable workspace root.",
		);
	}
	return root;
}

export function resolveWorkspaceRoot(context: {
	worktree?: string;
	directory?: string;
}): string {
	const candidate =
		normalizeWorkspaceRoot(context.worktree) ??
		normalizeWorkspaceRoot(context.directory);
	if (!candidate) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow could not resolve a workspace root from tool context.",
		);
	}
	return assertMutableWorkspaceRoot(candidate);
}

export function flowDir(worktree: string): string {
	return join(worktree, ".flow");
}

export function sessionPath(worktree: string): string {
	return join(flowDir(worktree), "session.json");
}

export function historyDir(worktree: string): string {
	return join(flowDir(worktree), "history");
}

export function archivedSessionPath(
	worktree: string,
	sessionId: string,
): string {
	if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
		throw new Error("Invalid session id.");
	}
	return join(historyDir(worktree), `${sessionId}.json`);
}

async function writeFileAtomically(
	path: string,
	contents: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const handle = await open(tempPath, "w");
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} catch (error) {
		await handle.close();
		await rm(tempPath, { force: true });
		throw error;
	}
	await handle.close();
	try {
		await rename(tempPath, path);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

const inProcessLocks = new Map<string, Promise<void>>();
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_RETRY_MS = 25;

async function acquireLock(worktree: string): Promise<() => Promise<void>> {
	const root = flowDir(worktree);
	const lock = join(root, "session.lock");
	const startedAt = Date.now();
	while (true) {
		try {
			await mkdir(lock, { recursive: false });
			return async () => {
				await rm(lock, { recursive: true, force: true });
			};
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				await mkdir(root, { recursive: true });
				continue;
			}
			if (code !== "EEXIST") throw error;
			if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
				throw new Error(`Timed out waiting for Flow session lock at ${lock}.`);
			}
			await sleep(LOCK_RETRY_MS);
		}
	}
}

export async function withSessionLock<T>(
	worktree: string,
	task: () => Promise<T>,
): Promise<T> {
	const previous = inProcessLocks.get(worktree) ?? Promise.resolve();
	let releaseQueue = () => {};
	const current = new Promise<void>((resolve) => {
		releaseQueue = resolve;
	});
	const queued = previous.catch(() => undefined).then(() => current);
	inProcessLocks.set(worktree, queued);

	let releaseFileLock: (() => Promise<void>) | null = null;
	try {
		await previous.catch(() => undefined);
		releaseFileLock = await acquireLock(worktree);
		return await task();
	} finally {
		try {
			await releaseFileLock?.();
		} finally {
			releaseQueue();
			if (inProcessLocks.get(worktree) === queued) {
				inProcessLocks.delete(worktree);
			}
		}
	}
}

export async function loadSession(worktree: string): Promise<Session | null> {
	const root = assertMutableWorkspaceRoot(worktree);
	let raw: string;
	try {
		raw = await readFile(sessionPath(root), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const parsed = parseStrictJsonObject(raw, "Flow session file");
	if (!parsed.ok) throw new Error(parsed.error);
	return SessionSchema.parse(parsed.value);
}

export async function saveSession(
	worktree: string,
	session: Session,
): Promise<Session> {
	const root = assertMutableWorkspaceRoot(worktree);
	const normalized = SessionSchema.parse(session);
	await writeFileAtomically(
		sessionPath(root),
		`${JSON.stringify(normalized, null, 2)}\n`,
	);
	await ensureFlowGitignore(root);
	return normalized;
}

export async function archiveAndClearSession(
	worktree: string,
	session: Session,
): Promise<void> {
	const root = assertMutableWorkspaceRoot(worktree);
	await mkdir(historyDir(root), { recursive: true });
	await writeFileAtomically(
		archivedSessionPath(root, session.id),
		`${JSON.stringify(SessionSchema.parse(session), null, 2)}\n`,
	);
	await rm(sessionPath(root), { force: true });
	await ensureFlowGitignore(root);
}

async function ensureFlowGitignore(worktree: string): Promise<void> {
	const path = join(flowDir(worktree), ".gitignore");
	try {
		const existing = await readFile(path, "utf8");
		if (existing.includes("session.lock")) return;
		await writeFile(path, `${existing.trimEnd()}\nsession.lock/\n`, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		await writeFile(path, "session.lock/\n", "utf8");
	}
}

export function isAbsoluteOrTraversal(value: string): boolean {
	return isAbsolute(value) || value === ".." || value.startsWith("../");
}
