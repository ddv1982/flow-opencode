import { randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import {
	type FileHandle,
	link,
	lstat,
	mkdir,
	open,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { UnreadableFlowSessionError } from "../../application/errors.js";
import { ArchivedSessionLookupError } from "../../application/ports/session-repository.js";
import { SessionSchema } from "../../application/schema.js";
import type { Session } from "../../domain/session.js";
import { parseStrictJsonObject } from "./strict-json-object.js";

export class InvalidFlowWorkspaceRootError extends Error {
	readonly code = "INVALID_FLOW_WORKSPACE_ROOT";
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "InvalidFlowWorkspaceRootError";
	}
}

export class UnsafeFlowWorkspaceLayoutError extends Error {
	readonly code = "UNSAFE_FLOW_WORKSPACE_LAYOUT";
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "UnsafeFlowWorkspaceLayoutError";
	}
}

export class ArchiveCollisionError extends Error {
	readonly code = "FLOW_ARCHIVE_COLLISION";
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ArchiveCollisionError";
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
	if (parse(root).root === root) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow requires a non-root workspace path.",
		);
	}
	if (!lstatSync(root).isDirectory()) {
		throw new InvalidFlowWorkspaceRootError(
			`Flow requires the workspace root to be a directory: ${root}.`,
		);
	}
	const homeCandidates = new Set(
		[process.env.HOME?.trim(), homedir()]
			.filter((value): value is string => Boolean(value))
			.map((value) => {
				try {
					return realpathSync(resolve(value));
				} catch {
					return resolve(value);
				}
			}),
	);
	if (homeCandidates.has(root)) {
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
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const handle = await open(tempPath, "wx", 0o600);
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
	if (process.platform !== "win32") {
		// Directory-handle fsync is POSIX-only; Windows cannot open a
		// directory for reading and the rename above is already durable there.
		const directory = await open(dirname(path), "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	}
}

async function syncDirectory(path: string): Promise<void> {
	if (process.platform === "win32") return;
	const directory = await open(path, "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

type ManagedPathState = "missing" | "present";

async function managedDirectoryState(
	path: string,
	description: string,
): Promise<ManagedPathState> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to use a symbolic link as ${description}: ${path}.`,
			);
		}
		if (!info.isDirectory()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires ${description} to be a directory: ${path}.`,
			);
		}
		return "present";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
}

async function ensureManagedDirectory(
	path: string,
	description: string,
): Promise<void> {
	if ((await managedDirectoryState(path, description)) === "present") return;
	try {
		await mkdir(path, { recursive: false, mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	if ((await managedDirectoryState(path, description)) !== "present") {
		throw new UnsafeFlowWorkspaceLayoutError(
			`Flow could not create ${description}: ${path}.`,
		);
	}
}

async function managedFileState(
	path: string,
	description: string,
): Promise<ManagedPathState> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to follow a symbolic link as ${description}: ${path}.`,
			);
		}
		if (!info.isFile()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires ${description} to be a regular file: ${path}.`,
			);
		}
		return "present";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
}

async function refuseManagedSymlink(
	path: string,
	description: string,
): Promise<void> {
	try {
		if ((await lstat(path)).isSymbolicLink()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to follow a symbolic link as ${description}: ${path}.`,
			);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function readManagedFile(
	path: string,
	description: string,
): Promise<string> {
	await managedFileState(path, description);
	const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
	let handle: FileHandle;
	try {
		handle = await open(path, constants.O_RDONLY | noFollow);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOOP") {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to follow a symbolic link as ${description}: ${path}.`,
				{ cause: error },
			);
		}
		throw error;
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires ${description} to be a regular file: ${path}.`,
			);
		}
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

async function ensureFlowDirectory(worktree: string): Promise<void> {
	await ensureManagedDirectory(flowDir(worktree), "the Flow state directory");
}

async function ensureHistoryDirectory(worktree: string): Promise<void> {
	await ensureFlowDirectory(worktree);
	await ensureManagedDirectory(
		historyDir(worktree),
		"the Flow session history directory",
	);
}

const inProcessLocks = new Map<string, Promise<void>>();
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_RETRY_MS = 25;

export type SessionLockOptions = {
	timeoutMs?: number;
};

type LockOwner = {
	token: string;
	pid: number;
	hostname: string;
	createdAt: string;
};

const LOCK_OWNER_FILENAME = "owner.json";

async function readLockOwner(lock: string): Promise<LockOwner | null> {
	let raw: string;
	try {
		raw = await readManagedFile(
			join(lock, LOCK_OWNER_FILENAME),
			"the Flow session lock owner file",
		);
	} catch (error) {
		if (error instanceof UnsafeFlowWorkspaceLayoutError) throw error;
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<LockOwner>;
		const createdAtMs =
			typeof parsed.createdAt === "string"
				? Date.parse(parsed.createdAt)
				: Number.NaN;
		if (
			typeof parsed.token === "string" &&
			parsed.token.length > 0 &&
			typeof parsed.pid === "number" &&
			Number.isSafeInteger(parsed.pid) &&
			parsed.pid > 0 &&
			typeof parsed.hostname === "string" &&
			parsed.hostname.trim().length > 0 &&
			typeof parsed.createdAt === "string" &&
			Number.isFinite(createdAtMs)
		) {
			return {
				token: parsed.token,
				pid: parsed.pid,
				hostname: parsed.hostname.trim(),
				createdAt: parsed.createdAt,
			};
		}
	} catch {
		// Invalid metadata is never grounds for stealing a lock.
	}
	return null;
}

async function releaseLock(lock: string, token: string): Promise<void> {
	const owner = await readLockOwner(lock);
	if (owner?.token !== token) return;
	await rm(lock, { recursive: true, force: true });
}

async function acquireLock(
	worktree: string,
	options: SessionLockOptions = {},
): Promise<() => Promise<void>> {
	const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
	const root = flowDir(worktree);
	const lock = join(root, "session.lock");
	await ensureFlowGitignore(worktree);
	const startedAt = Date.now();
	while (true) {
		try {
			await mkdir(lock, { recursive: false });
			const token = randomUUID();
			try {
				await writeFile(
					join(lock, LOCK_OWNER_FILENAME),
					JSON.stringify({
						token,
						pid: process.pid,
						hostname: hostname(),
						createdAt: new Date().toISOString(),
					}),
					{ encoding: "utf8", flag: "wx", mode: 0o600 },
				);
			} catch (error) {
				await rm(lock, { recursive: true, force: true });
				throw error;
			}
			return () => releaseLock(lock, token);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				await ensureFlowDirectory(worktree);
				continue;
			}
			if (code !== "EEXIST") throw error;
			if (
				(await managedDirectoryState(
					lock,
					"the Flow session lock directory",
				)) === "missing"
			) {
				continue;
			}
			if (Date.now() - startedAt > timeoutMs) {
				const owner = await readLockOwner(lock);
				const ownerSummary = owner
					? ` Owner: PID ${owner.pid} on ${owner.hostname}, created ${owner.createdAt}.`
					: " Owner metadata is missing or invalid.";
				throw new Error(
					`Timed out waiting for Flow session lock at ${lock}. ` +
						"Another OpenCode session may be using this workspace." +
						ownerSummary +
						` If that process has ended, inspect ${join(lock, LOCK_OWNER_FILENAME)} before removing the lock directory.`,
				);
			}
			await sleep(LOCK_RETRY_MS);
		}
	}
}

export async function withSessionLock<T>(
	worktree: string,
	task: () => Promise<T>,
	lockOptions: SessionLockOptions = {},
): Promise<T> {
	const root = assertMutableWorkspaceRoot(worktree);
	await ensureFlowDirectory(root);
	const previous = inProcessLocks.get(root) ?? Promise.resolve();
	let releaseQueue = () => {};
	const current = new Promise<void>((resolve) => {
		releaseQueue = resolve;
	});
	const queued = previous.catch(() => undefined).then(() => current);
	inProcessLocks.set(root, queued);

	let releaseFileLock: (() => Promise<void>) | null = null;
	try {
		await previous.catch(() => undefined);
		releaseFileLock = await acquireLock(root, lockOptions);
		return await task();
	} finally {
		try {
			await releaseFileLock?.();
		} finally {
			releaseQueue();
			if (inProcessLocks.get(root) === queued) {
				inProcessLocks.delete(root);
			}
		}
	}
}

function describeSessionSchemaFailure(value: Record<string, unknown>): string {
	const version = value.version;
	if (version !== 3) {
		return `it uses session schema version ${JSON.stringify(version ?? null)}, but this plugin version requires version 3`;
	}
	return "it does not match the current session schema";
}

export async function loadSession(worktree: string): Promise<Session | null> {
	const root = assertMutableWorkspaceRoot(worktree);
	if (
		(await managedDirectoryState(flowDir(root), "the Flow state directory")) ===
		"missing"
	) {
		return null;
	}
	const path = sessionPath(root);
	if ((await managedFileState(path, "the Flow session file")) === "missing") {
		return null;
	}
	let raw: string;
	try {
		raw = await readManagedFile(path, "the Flow session file");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const parsed = parseStrictJsonObject(raw, "Flow session file");
	if (!parsed.ok) {
		throw new UnreadableFlowSessionError(parsed.error, parsed.error);
	}
	const result = SessionSchema.safeParse(parsed.value);
	if (!result.success) {
		const reason = describeSessionSchemaFailure(parsed.value);
		throw new UnreadableFlowSessionError(
			`Flow session file at ${sessionPath(root)} is unreadable: ${reason}.`,
			reason,
		);
	}
	return result.data;
}

const CANONICAL_ARCHIVE_FILENAME = /^[a-zA-Z0-9_-]+\.json$/;

export async function findArchivedSessionByOperationId(
	worktree: string,
	operationId: string,
): Promise<Session | null> {
	const root = assertMutableWorkspaceRoot(worktree);
	try {
		if (
			(await managedDirectoryState(
				flowDir(root),
				"the Flow state directory",
			)) === "missing" ||
			(await managedDirectoryState(
				historyDir(root),
				"the Flow session history directory",
			)) === "missing"
		) {
			return null;
		}
		const matches: Session[] = [];
		for (const filename of (await readdir(historyDir(root))).sort()) {
			if (
				filename.startsWith("quarantine-") ||
				!CANONICAL_ARCHIVE_FILENAME.test(filename)
			) {
				continue;
			}
			const contents = await readManagedFile(
				join(historyDir(root), filename),
				"the Flow session archive",
			);
			const parsed = parseStrictJsonObject(contents, "Flow session archive");
			if (!parsed.ok) {
				throw new ArchivedSessionLookupError(
					"Flow could not verify canonical archived session history.",
				);
			}
			const session = SessionSchema.safeParse(parsed.value);
			if (!session.success || filename !== `${session.data.id}.json`) {
				throw new ArchivedSessionLookupError(
					"Flow could not verify canonical archived session history.",
				);
			}
			if (
				session.data.causal.mutations.some(
					(mutation) => mutation.operationId === operationId,
				)
			) {
				matches.push(session.data);
			}
		}
		if (matches.length > 1) {
			throw new ArchivedSessionLookupError(
				"Flow found ambiguous archived operation history.",
			);
		}
		return matches[0] ?? null;
	} catch (error) {
		if (error instanceof ArchivedSessionLookupError) throw error;
		throw new ArchivedSessionLookupError(
			"Flow could not verify archived operation history safely.",
			{ cause: error },
		);
	}
}

export async function quarantineUnreadableSession(
	worktree: string,
): Promise<string | null> {
	const root = assertMutableWorkspaceRoot(worktree);
	const source = sessionPath(root);
	if (
		(await managedDirectoryState(flowDir(root), "the Flow state directory")) ===
			"missing" ||
		(await managedFileState(source, "the Flow session file")) === "missing"
	) {
		return null;
	}
	await ensureFlowGitignore(root);
	await ensureHistoryDirectory(root);
	const target = join(
		historyDir(root),
		`quarantine-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`,
	);
	try {
		await rename(source, target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	await syncDirectory(historyDir(root));
	await syncDirectory(flowDir(root));
	return target;
}

export async function saveSession(
	worktree: string,
	session: Session,
): Promise<Session> {
	const root = assertMutableWorkspaceRoot(worktree);
	const normalized = SessionSchema.parse(session);
	await ensureFlowGitignore(root);
	await refuseManagedSymlink(sessionPath(root), "the Flow session file");
	await writeFileAtomically(
		sessionPath(root),
		`${JSON.stringify(normalized, null, 2)}\n`,
	);
	return normalized;
}

export async function archiveAndClearSession(
	worktree: string,
	session: Session,
): Promise<void> {
	const root = assertMutableWorkspaceRoot(worktree);
	const normalized = SessionSchema.parse(session);
	await ensureFlowGitignore(root);
	await ensureHistoryDirectory(root);
	await Promise.all([
		managedFileState(sessionPath(root), "the Flow session file"),
		managedFileState(join(flowDir(root), ".gitignore"), "the Flow ignore file"),
	]);
	const expectedContents = `${JSON.stringify(normalized, null, 2)}\n`;
	const activePath = sessionPath(root);
	const targetPath = archivedSessionPath(root, normalized.id);
	const normalizeContents = (contents: string): string | null => {
		const parsed = parseStrictJsonObject(contents, "Flow session archive");
		if (!parsed.ok) return null;
		const result = SessionSchema.safeParse(parsed.value);
		return result.success ? `${JSON.stringify(result.data, null, 2)}\n` : null;
	};
	const activeContents = await readManagedFile(
		activePath,
		"the Flow session file",
	);
	if (normalizeContents(activeContents) !== expectedContents) {
		throw new ArchiveCollisionError(
			"Flow refused to archive because the active session changed before publication.",
		);
	}

	const existingArchiveMatches = async (): Promise<boolean> => {
		if (
			(await managedFileState(targetPath, "the Flow session archive")) ===
			"missing"
		) {
			return false;
		}
		return (
			normalizeContents(
				await readManagedFile(targetPath, "the Flow session archive"),
			) === expectedContents
		);
	};

	if (await existingArchiveMatches()) {
		// A previous close reached archive publication but not active-state
		// cleanup. Continue the same transaction instead of wedging retries.
	} else {
		try {
			// Hard-link publication is atomic and exclusive: unlike rename, it can
			// never replace an existing archive with the same session id.
			await link(activePath, targetPath);
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code !== "EEXIST" ||
				!(await existingArchiveMatches())
			) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") {
					throw new ArchiveCollisionError(
						`Flow archive already exists with different contents: ${targetPath}.`,
						{ cause: error },
					);
				}
				throw error;
			}
		}
	}
	await syncDirectory(historyDir(root));

	await rm(activePath);
	await syncDirectory(flowDir(root));
}

const FLOW_GITIGNORE_CONTENT = [
	"session.json",
	"history/",
	"evidence/",
	"session.lock/",
	".gitignore",
	"",
].join("\n");

const LEGACY_FLOW_GITIGNORE_CONTENTS = new Set([
	"session.lock/",
	["session.json", "history/", "session.lock/", ".gitignore"].join("\n"),
]);

async function writeFlowGitignoreAtomically(
	path: string,
	contents: string,
): Promise<void> {
	try {
		await writeFileAtomically(path, contents);
	} catch (error) {
		try {
			if ((await readManagedFile(path, "the Flow ignore file")) === contents) {
				// Concurrent publication can win the same atomic write before this
				// rename. Windows reports that race as EPERM instead of replacing the
				// destination; exact content means the requested policy is installed.
				return;
			}
		} catch (verificationError) {
			if (verificationError instanceof UnsafeFlowWorkspaceLayoutError) {
				throw verificationError;
			}
		}
		throw error;
	}
}

export async function ensureFlowGitignore(worktree: string): Promise<void> {
	const path = join(flowDir(worktree), ".gitignore");
	await ensureFlowDirectory(worktree);
	const state = await managedFileState(path, "the Flow ignore file");
	if (state === "missing") {
		await writeFlowGitignoreAtomically(path, FLOW_GITIGNORE_CONTENT);
		return;
	}
	try {
		const existing = await readManagedFile(path, "the Flow ignore file");
		if (LEGACY_FLOW_GITIGNORE_CONTENTS.has(existing.trimEnd())) {
			await writeFlowGitignoreAtomically(path, FLOW_GITIGNORE_CONTENT);
		} else if (!existing.trimEnd().endsWith(FLOW_GITIGNORE_CONTENT.trimEnd())) {
			// Preserve maintainer-owned entries, but finish with Flow's complete
			// ignore block so an earlier negation cannot expose restricted runtime
			// evidence to ordinary Git staging.
			const separator =
				existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
			await writeFlowGitignoreAtomically(
				path,
				`${existing}${separator}${FLOW_GITIGNORE_CONTENT}`,
			);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		// The file disappeared after validation. Atomic creation remains safe
		// because the Flow directory itself was validated above.
		await writeFlowGitignoreAtomically(path, FLOW_GITIGNORE_CONTENT);
	}
}
