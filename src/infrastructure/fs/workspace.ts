import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import {
	link,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
	UnreadableFlowSessionError,
	UnsupportedFlowSessionVersionError,
} from "../../application/errors.js";
import { SessionSchema } from "../../application/schema.js";
import {
	MAX_SESSION_BYTES,
	MAX_SESSION_ID_LENGTH,
} from "../../domain/limits.js";
import type { Session } from "../../domain/session.js";
import { parseStrictJsonObject } from "./strict-json-object.js";

export class InvalidFlowWorkspaceRootError extends Error {
	readonly code = "INVALID_FLOW_WORKSPACE_ROOT";
}

export class UnsafeFlowWorkspaceLayoutError extends Error {
	readonly code = "UNSAFE_FLOW_WORKSPACE_LAYOUT";
}

export class ArchiveCollisionError extends Error {
	readonly code = "FLOW_ARCHIVE_COLLISION";
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
	const candidate = normalizeWorkspaceRoot(rawPath);
	if (!candidate) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow requires a non-root workspace path.",
		);
	}
	let root: string;
	try {
		root = realpathSync(candidate);
	} catch (error) {
		throw new InvalidFlowWorkspaceRootError(
			`Flow requires an existing workspace directory: ${candidate}.`,
			{ cause: error },
		);
	}
	if (parse(root).root === root || !lstatSync(root).isDirectory()) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow requires an existing non-root workspace directory.",
		);
	}
	const homes = [process.env.HOME, homedir()]
		.filter((value): value is string => Boolean(value?.trim()))
		.map((value) => {
			try {
				return realpathSync(resolve(value));
			} catch {
				return resolve(value);
			}
		});
	if (homes.includes(root)) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow refuses to use the home directory itself as mutable state.",
		);
	}
	return root;
}

export function resolveWorkspaceRoot(context: {
	worktree?: string | undefined;
	directory?: string | undefined;
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

export function flowDir(workspace: string): string {
	return join(workspace, ".flow");
}

export function sessionPath(workspace: string): string {
	return join(flowDir(workspace), "session.json");
}

export function historyDir(workspace: string): string {
	return join(flowDir(workspace), "history");
}

export function archivedSessionFilename(sessionId: string): string {
	if (sessionId.length < 1 || sessionId.length > MAX_SESSION_ID_LENGTH) {
		throw new Error("Invalid session id.");
	}
	return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

export function archivedSessionPath(
	workspace: string,
	sessionId: string,
): string {
	return join(historyDir(workspace), archivedSessionFilename(sessionId));
}

async function pathKind(
	path: string,
	expected: "file" | "directory",
	description: string,
): Promise<"missing" | "present"> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses a symbolic link for ${description}: ${path}.`,
			);
		}
		if (
			(expected === "file" && !info.isFile()) ||
			(expected === "directory" && !info.isDirectory())
		) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires ${description} to be a ${expected}: ${path}.`,
			);
		}
		return "present";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
}

async function ensureDirectory(
	path: string,
	description: string,
): Promise<void> {
	if ((await pathKind(path, "directory", description)) === "present") return;
	try {
		await mkdir(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	await pathKind(path, "directory", description);
}

async function ensureFlowDirectory(workspace: string): Promise<void> {
	const root = flowDir(workspace);
	await ensureDirectory(root, "the Flow state directory");
	const ignore = join(root, ".gitignore");
	if ((await pathKind(ignore, "file", "the Flow ignore file")) === "missing") {
		try {
			await writeFile(ignore, "*\n", {
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}

async function ensureHistoryDirectory(workspace: string): Promise<void> {
	await ensureFlowDirectory(workspace);
	await ensureDirectory(historyDir(workspace), "the Flow history directory");
}

async function readManaged(path: string, description: string): Promise<string> {
	await pathKind(path, "file", description);
	const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
	const handle = await open(path, constants.O_RDONLY | noFollow);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > MAX_SESSION_BYTES) {
			throw new UnreadableFlowSessionError(
				`${description} is not a bounded regular file.`,
				"state exceeds the supported session size",
			);
		}
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

async function syncDirectory(path: string): Promise<void> {
	if (process.platform === "win32") return;
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function renameReplacing(temporary: string, path: string): Promise<void> {
	let retry = 0;
	while (true) {
		try {
			await rename(temporary, path);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			const transientWindowsError =
				process.platform === "win32" &&
				(code === "EACCES" || code === "EBUSY" || code === "EPERM");
			if (!transientWindowsError || retry >= 20) throw error;
			retry += 1;
			// Preserve atomic replacement: wait for short-lived readers instead of
			// unlinking the destination and exposing missing or partial state.
			await sleep(retry * 5);
		}
	}
}

async function writeAtomically(path: string, contents: string): Promise<void> {
	const temporary = join(
		dirname(path),
		`.flow-write-${process.pid}-${randomUUID()}.tmp`,
	);
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} catch (error) {
		await handle.close();
		await rm(temporary, { force: true });
		throw error;
	}
	await handle.close();
	try {
		await renameReplacing(temporary, path);
		await syncDirectory(dirname(path));
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

function parseSession(raw: string, description: string): Session {
	const parsed = parseStrictJsonObject(raw, description);
	if (!parsed.ok) {
		throw new UnreadableFlowSessionError(parsed.error, parsed.error);
	}
	if (Object.hasOwn(parsed.value, "version") && parsed.value.version !== 5) {
		throw new UnsupportedFlowSessionVersionError(parsed.value.version);
	}
	const result = SessionSchema.safeParse(parsed.value);
	if (!result.success) {
		const reason = result.error.issues.map((issue) => issue.message).join("; ");
		throw new UnreadableFlowSessionError(
			`${description} does not match Session v5: ${reason}`,
			reason,
		);
	}
	return result.data;
}

export async function loadSession(workspace: string): Promise<Session | null> {
	const root = assertMutableWorkspaceRoot(workspace);
	if (
		(await pathKind(flowDir(root), "directory", "the Flow state directory")) ===
		"missing"
	) {
		return null;
	}
	const path = sessionPath(root);
	if ((await pathKind(path, "file", "the Flow session file")) === "missing") {
		return null;
	}
	return parseSession(
		await readManaged(path, "the Flow session file"),
		"Flow session file",
	);
}

export async function loadArchivedSession(
	workspace: string,
	sessionId: string,
): Promise<Session | null> {
	const root = assertMutableWorkspaceRoot(workspace);
	if (
		(await pathKind(flowDir(root), "directory", "the Flow state directory")) ===
		"missing"
	) {
		return null;
	}
	if (
		(await pathKind(
			historyDir(root),
			"directory",
			"the Flow history directory",
		)) === "missing"
	) {
		return null;
	}
	const path = archivedSessionPath(root, sessionId);
	if (
		(await pathKind(path, "file", "the Flow archived session")) === "missing"
	) {
		return null;
	}
	const session = parseSession(
		await readManaged(path, "the Flow archived session"),
		"Flow archived session",
	);
	if (session.id !== sessionId || !session.closure) {
		throw new ArchiveCollisionError(
			"Archived session identity or closure is invalid.",
		);
	}
	return session;
}

export async function saveSession(
	workspace: string,
	session: Session,
): Promise<Session> {
	const root = assertMutableWorkspaceRoot(workspace);
	const parsed = SessionSchema.parse(session);
	await ensureFlowDirectory(root);
	await pathKind(sessionPath(root), "file", "the Flow session file");
	await writeAtomically(
		sessionPath(root),
		`${JSON.stringify(parsed, null, 2)}\n`,
	);
	return parsed;
}

export async function archiveAndClearSession(
	workspace: string,
	session: Session,
): Promise<void> {
	const root = assertMutableWorkspaceRoot(workspace);
	if (!session.closure)
		throw new Error("Flow archives only explicitly closed sessions.");
	const canonical = SessionSchema.parse(session);
	const canonicalBytes = `${JSON.stringify(canonical, null, 2)}\n`;
	await ensureHistoryDirectory(root);
	const target = archivedSessionPath(root, canonical.id);
	const temporary = join(
		historyDir(root),
		`.flow-archive-${process.pid}-${randomUUID()}.tmp`,
	);
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(canonicalBytes, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await link(temporary, target);
		await syncDirectory(historyDir(root));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = await loadArchivedSession(root, canonical.id);
		if (!existing || JSON.stringify(existing) !== JSON.stringify(canonical)) {
			throw new ArchiveCollisionError(
				"Flow refused to overwrite a different archived session.",
			);
		}
	} finally {
		await rm(temporary, { force: true });
	}
	const active = await loadSession(root);
	if (!active) return;
	if (JSON.stringify(active) !== JSON.stringify(canonical)) {
		throw new ArchiveCollisionError(
			"Active state changed before archive cleanup; Flow left it untouched.",
		);
	}
	await unlink(sessionPath(root));
	await syncDirectory(flowDir(root));
}

export async function quarantineUnreadableSession(
	workspace: string,
): Promise<string | null> {
	const root = assertMutableWorkspaceRoot(workspace);
	if (
		(await pathKind(flowDir(root), "directory", "the Flow state directory")) ===
		"missing"
	) {
		return null;
	}
	const source = sessionPath(root);
	if ((await pathKind(source, "file", "the Flow session file")) === "missing") {
		return null;
	}
	await ensureHistoryDirectory(root);
	const target = join(historyDir(root), `quarantine-${randomUUID()}.json`);
	await rename(source, target);
	await syncDirectory(historyDir(root));
	return target;
}

const inProcessLocks = new Map<string, Promise<void>>();
const LOCK_TIMEOUT_MS = 30_000;

async function acquireLock(workspace: string): Promise<() => Promise<void>> {
	await ensureFlowDirectory(workspace);
	const lock = join(flowDir(workspace), "session.lock");
	const started = Date.now();
	while (true) {
		try {
			await mkdir(lock, { mode: 0o700 });
			const token = randomUUID();
			try {
				await writeFile(
					join(lock, "owner.json"),
					JSON.stringify({ token, pid: process.pid }),
					{ encoding: "utf8", flag: "wx", mode: 0o600 },
				);
			} catch (error) {
				await rm(lock, { recursive: true, force: true });
				throw error;
			}
			return async () => {
				try {
					const owner = JSON.parse(
						await readFile(join(lock, "owner.json"), "utf8"),
					) as { token?: unknown };
					if (owner.token === token) await rm(lock, { recursive: true });
				} catch {
					// A replaced or damaged lock is not ours to remove.
				}
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			await pathKind(lock, "directory", "the Flow session lock");
			if (Date.now() - started >= LOCK_TIMEOUT_MS) {
				throw new Error(
					`Timed out waiting for Flow session lock at ${lock}; inspect it before manual removal.`,
				);
			}
			await sleep(25);
		}
	}
}

export async function withSessionLock<T>(
	workspace: string,
	task: () => Promise<T>,
): Promise<T> {
	const root = assertMutableWorkspaceRoot(workspace);
	const previous = inProcessLocks.get(root) ?? Promise.resolve();
	let releaseQueue = () => {};
	const current = new Promise<void>((resolveQueue) => {
		releaseQueue = resolveQueue;
	});
	const queued = previous.catch(() => undefined).then(() => current);
	inProcessLocks.set(root, queued);
	let releaseFile: (() => Promise<void>) | null = null;
	try {
		await previous.catch(() => undefined);
		releaseFile = await acquireLock(root);
		return await task();
	} finally {
		await releaseFile?.();
		releaseQueue();
		if (inProcessLocks.get(root) === queued) inProcessLocks.delete(root);
	}
}
