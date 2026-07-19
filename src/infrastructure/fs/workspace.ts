import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import {
	type FileHandle,
	lstat,
	mkdir,
	open,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
	UnreadableFlowSessionError,
	UnsupportedFlowSessionVersionError,
} from "../../application/errors.js";
import { ArchivedSessionLookupError } from "../../application/ports/session-repository.js";
import { SessionSchema } from "../../application/schema.js";
import { MAX_SESSION_ID_LENGTH } from "../../domain/limits.js";
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

export class UnclosedSessionArchiveError extends Error {
	readonly code = "FLOW_ARCHIVE_REQUIRES_CLOSURE";
	constructor(message: string) {
		super(message);
		this.name = "UnclosedSessionArchiveError";
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

function assertArchiveSafeSessionId(sessionId: string): void {
	if (
		sessionId.length > MAX_SESSION_ID_LENGTH ||
		!/^[a-zA-Z0-9_-]+$/.test(sessionId)
	) {
		throw new Error("Invalid session id.");
	}
}

/**
 * Map the exact, case-sensitive session identity into a portable lowercase
 * archive component. The fixed digest avoids both case-fold collisions and
 * filesystem component growth while lookup still verifies the parsed id.
 */
export function archivedSessionFilename(sessionId: string): string {
	assertArchiveSafeSessionId(sessionId);
	return `${createHash("sha256").update(sessionId, "utf8").digest("hex")}.json`;
}

export function archivedSessionPath(
	worktree: string,
	sessionId: string,
): string {
	return join(historyDir(worktree), archivedSessionFilename(sessionId));
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

type ManagedPathIdentity = {
	dev: string;
	ino: string;
};

type PinnedFileRead = {
	contents: string;
	identity: ManagedPathIdentity;
};

type PinnedArchiveEntry = {
	filename: string;
	contents: string;
};

type PinnedHelperResult =
	| {
			status: "read";
			contents: string;
			identity: ManagedPathIdentity;
	  }
	| { status: "listed"; entries: PinnedArchiveEntry[] }
	| { status: "published" }
	| { status: "exists"; contents: string }
	| { status: "removed" };

type ArchiveAndClearTestHooks = {
	afterHistoryPinned?: (() => Promise<void>) | undefined;
	afterFlowPinnedBeforeDelete?: (() => Promise<void>) | undefined;
	pinnedHelperTestExecutable?: string | undefined;
	pinnedHelperTestRuntime?: "node" | "bun" | "electron" | undefined;
	pinnedHelperReadyTimeoutMs?: number | undefined;
	pinnedHelperCompletionTimeoutMs?: number | undefined;
};

type PinnedHelperRunOptions = Pick<
	ArchiveAndClearTestHooks,
	| "pinnedHelperTestExecutable"
	| "pinnedHelperTestRuntime"
	| "pinnedHelperReadyTimeoutMs"
	| "pinnedHelperCompletionTimeoutMs"
>;

const PINNED_HELPER_READY_TIMEOUT_MS = 10_000;
const PINNED_HELPER_COMPLETION_TIMEOUT_MS = 60_000;

const PINNED_DIRECTORY_HELPER_SOURCE = String.raw`
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function identity(info) {
  return { dev: String(info.dev), ino: String(info.ino) };
}

function sameIdentity(actual, expected) {
  return actual.dev === expected.dev && actual.ino === expected.ino;
}

function directoryIdentity(target, label) {
  const info = fs.lstatSync(target, { bigint: true });
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail("FLOW_PINNED_DIRECTORY_MISMATCH", label + " is no longer a regular directory.");
  }
  return identity(info);
}

function validatePinned(request) {
  const cwd = identity(fs.statSync(".", { bigint: true }));
  if (!sameIdentity(cwd, request.expectedCwd)) {
    fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Pinned directory identity changed.");
  }
  if (request.expectedParent) {
    const parent = identity(fs.statSync("..", { bigint: true }));
    if (!sameIdentity(parent, request.expectedParent)) {
      fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Pinned directory parent changed.");
    }
  }
  if (!sameIdentity(directoryIdentity(request.canonicalPath, "Canonical directory"), request.expectedCwd)) {
    fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Canonical directory no longer names the pinned directory.");
  }
  if (request.canonicalParentPath && request.expectedParent) {
    if (!sameIdentity(directoryIdentity(request.canonicalParentPath, "Canonical parent directory"), request.expectedParent)) {
      fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Canonical parent no longer names the pinned parent directory.");
    }
  }
}

function safeBasename(name) {
  if (!name || path.basename(name) !== name || name === "." || name === "..") {
    fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Pinned helper received an unsafe relative filename.");
  }
  return name;
}

function readRegularPath(name) {
  const before = fs.lstatSync(name, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) {
    fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Pinned helper refuses a non-regular managed file.");
  }
  const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(name, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile()) {
      fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Pinned helper opened a non-regular managed file.");
    }
    return { bytes: fs.readFileSync(fd), identity: identity(opened) };
  } finally {
    fs.closeSync(fd);
  }
}

function readRegular(name) {
  safeBasename(name);
  return readRegularPath(name);
}

function requireExactDirectoryEntry(directory, expectedName) {
  const matches = fs.readdirSync(directory).filter(
    (entry) => entry.toLowerCase() === expectedName.toLowerCase(),
  );
  if (matches.length !== 1 || matches[0] !== expectedName) {
    fail(
      "FLOW_ARCHIVE_CASE_COLLISION",
      "Archive history no longer contains exactly the expected filename spelling.",
    );
  }
}

function syncCwd() {
  if (process.platform === "win32") return;
  const fd = fs.openSync(".", fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function output(value) {
  process.stdout.write(JSON.stringify(value));
}

try {
  const request = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
  validatePinned(request);
  process.stdout.write(JSON.stringify({ event: "pinned" }) + "\n");
  const input = fs.readFileSync(0);
  validatePinned(request);

  if (request.operation === "read") {
    const value = readRegular(request.name);
    output({
      status: "read",
      contents: value.bytes.toString("base64"),
      identity: value.identity,
    });
  } else if (request.operation === "listCanonical") {
    const entries = [];
    const canonical = /^[a-f0-9]{64}\.json$/;
    const caseFoldedCanonical = /^[a-f0-9]{64}\.json$/i;
    for (const filename of fs.readdirSync(".").sort()) {
      if (filename.startsWith("quarantine-")) continue;
      if (!canonical.test(filename)) {
        if (caseFoldedCanonical.test(filename)) {
          fail("FLOW_ARCHIVE_CASE_COLLISION", "Archive history contains a case-folded canonical filename collision.");
        }
		if (/\.json$/i.test(filename)) {
		  fail("FLOW_ARCHIVE_UNKNOWN_JSON", "Archive history contains an unknown JSON entry in the managed namespace.");
		}
        continue;
      }
      const value = readRegular(filename);
      entries.push({ filename, contents: value.bytes.toString("base64") });
    }
    output({ status: "listed", entries });
  } else if (request.operation === "publish") {
    const target = safeBasename(request.targetName);
    const temporary = safeBasename(request.tempName);
    let temporaryCreated = false;
    let published = false;
	let linkAttempted = false;
    try {
      const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(
        temporary,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o600,
      );
      temporaryCreated = true;
      try {
        fs.writeFileSync(fd, input);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
	  linkAttempted = true;
	  fs.linkSync(temporary, target);
      published = true;
      validatePinned(request);
      syncCwd();
      fs.unlinkSync(temporary);
      temporaryCreated = false;
      syncCwd();
      output({ status: "published" });
    } catch (error) {
      if (temporaryCreated) {
        try { fs.unlinkSync(temporary); } catch {}
      }
      if (published && error && error.code === "FLOW_PINNED_DIRECTORY_MISMATCH") {
        try { fs.unlinkSync(target); } catch {}
        try { syncCwd(); } catch {}
      }
	  if (linkAttempted && error && error.code === "EEXIST") {
		requireExactDirectoryEntry(".", target);
        const existing = readRegular(target);
        output({ status: "exists", contents: existing.bytes.toString("base64") });
      } else {
        throw error;
      }
    }
  } else if (request.operation === "remove") {
    const value = readRegular(request.name);
    if (!sameIdentity(value.identity, request.expectedFileIdentity)) {
      fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Active session identity changed before deletion.");
    }
    const digest = crypto.createHash("sha256").update(value.bytes).digest("hex");
    if (digest !== request.expectedSha256) {
      fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Active session contents changed before deletion.");
    }
	if (request.expectedHistoryIdentity) {
	  const historyIdentity = directoryIdentity("history", "Pinned history directory");
	  if (!sameIdentity(historyIdentity, request.expectedHistoryIdentity)) {
		fail("FLOW_PINNED_DIRECTORY_MISMATCH", "History changed before active-session deletion.");
	  }
	  const archiveName = safeBasename(request.expectedArchiveName);
	  requireExactDirectoryEntry("history", archiveName);
	  const archive = readRegularPath(path.join("history", archiveName));
	  const archiveDigest = crypto.createHash("sha256").update(archive.bytes).digest("hex");
	  if (archiveDigest !== request.expectedArchiveSha256) {
		fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Verified archive changed before active-session deletion.");
	  }
	  const historyAfterRead = directoryIdentity("history", "Pinned history directory");
	  if (!sameIdentity(historyAfterRead, request.expectedHistoryIdentity)) {
		fail("FLOW_PINNED_DIRECTORY_MISMATCH", "History changed while verifying active-session deletion.");
	  }
	  requireExactDirectoryEntry("history", archiveName);
	}
    validatePinned(request);
	if (request.expectedHistoryIdentity) {
	  requireExactDirectoryEntry("history", safeBasename(request.expectedArchiveName));
	}
    fs.unlinkSync(request.name);
    syncCwd();
    output({ status: "removed" });
  } else {
    fail("FLOW_PINNED_DIRECTORY_MISMATCH", "Unknown pinned helper operation.");
  }
} catch (error) {
  process.stderr.write(JSON.stringify({
    name: error && error.name,
    code: error && error.code,
    message: error && error.message ? error.message : String(error),
  }));
  process.exitCode = 1;
}
`;

async function managedDirectoryIdentity(
	path: string,
	description: string,
): Promise<ManagedPathIdentity> {
	const info = await lstat(path, { bigint: true });
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new UnsafeFlowWorkspaceLayoutError(
			`Flow requires ${description} to remain a regular directory: ${path}.`,
		);
	}
	return { dev: String(info.dev), ino: String(info.ino) };
}

async function assertManagedDirectoryIdentity(
	path: string,
	description: string,
	expected: ManagedPathIdentity,
): Promise<void> {
	const actual = await managedDirectoryIdentity(path, description);
	if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
		throw new UnsafeFlowWorkspaceLayoutError(
			`Flow detected that ${description} changed during a managed operation: ${path}.`,
		);
	}
}

class PinnedFilesystemHelperError extends Error {
	readonly code = "FLOW_PINNED_HELPER_FAILED";
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "PinnedFilesystemHelperError";
	}
}

function pinnedHelperFailure(message: string, cause?: unknown): Error {
	return new PinnedFilesystemHelperError(message, { cause });
}

function helperFailure(stderr: string, cause?: unknown): Error {
	let detail: { code?: string; message?: string } | null = null;
	try {
		detail = JSON.parse(stderr) as { code?: string; message?: string };
	} catch {
		// Preserve the process failure without exposing helper source or input bytes.
	}
	if (
		detail?.code === "FLOW_PINNED_DIRECTORY_MISMATCH" ||
		detail?.code === "FLOW_ARCHIVE_CASE_COLLISION" ||
		detail?.code === "FLOW_ARCHIVE_UNKNOWN_JSON"
	) {
		return new UnsafeFlowWorkspaceLayoutError(
			detail.message ?? "Flow detected an unsafe pinned directory change.",
			{ cause },
		);
	}
	return new PinnedFilesystemHelperError(
		detail?.message ?? "Flow pinned filesystem helper failed.",
		{ cause },
	);
}

function pinnedHelperEnvironment(
	runtime: "node" | "bun" | "electron",
): NodeJS.ProcessEnv {
	if (runtime === "electron") {
		return { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
	}
	if (runtime === "bun") {
		return { ...process.env, BUN_BE_BUN: "1" };
	}
	return process.env;
}

async function runPinnedDirectoryHelper(
	cwd: string,
	request: Record<string, unknown>,
	input = "",
	afterPinned?: () => Promise<void>,
	options: PinnedHelperRunOptions = {},
): Promise<PinnedHelperResult> {
	const encodedRequest = Buffer.from(JSON.stringify(request), "utf8").toString(
		"base64",
	);
	const runtime =
		options.pinnedHelperTestRuntime ??
		(process.versions.electron
			? "electron"
			: process.versions.bun
				? "bun"
				: "node");
	const child = spawn(
		options.pinnedHelperTestExecutable ?? process.execPath,
		["--eval", PINNED_DIRECTORY_HELPER_SOURCE, encodedRequest],
		{
			cwd,
			// Both OpenCode distributions use their host executable as execPath.
			// Select that host's CLI mode so --eval runs the isolated helper.
			env: pinnedHelperEnvironment(runtime),
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	let stdout = "";
	let stderr = "";
	let readyState: "pending" | "resolved" | "rejected" = "pending";
	let forcedFailure: Error | null = null;
	let resolvePinned: (() => void) | undefined;
	let rejectPinned: ((error: Error) => void) | undefined;
	const pinnedPromise = new Promise<void>((resolve, reject) => {
		resolvePinned = resolve;
		rejectPinned = reject;
	});
	const positiveTimeout = (candidate: number | undefined, fallback: number) =>
		typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
			? candidate
			: fallback;
	const terminateHelper = (error: Error): void => {
		if (forcedFailure) return;
		forcedFailure = error;
		if (readyState === "pending") {
			readyState = "rejected";
			rejectPinned?.(error);
		}
		child.kill("SIGKILL");
	};
	const readyTimeout = setTimeout(
		() => {
			terminateHelper(
				pinnedHelperFailure(
					"Flow pinned filesystem helper timed out before readiness.",
				),
			);
		},
		positiveTimeout(
			options.pinnedHelperReadyTimeoutMs,
			PINNED_HELPER_READY_TIMEOUT_MS,
		),
	);
	readyTimeout.unref();
	let completionTimeout: NodeJS.Timeout | undefined;
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
		if (readyState === "pending") {
			const newline = stdout.indexOf("\n");
			if (newline !== -1) {
				let event: { event?: string };
				try {
					event = JSON.parse(stdout.slice(0, newline)) as {
						event?: string;
					};
				} catch (error) {
					terminateHelper(
						pinnedHelperFailure(
							"Flow pinned filesystem helper returned an invalid ready event.",
							error,
						),
					);
					return;
				}
				if (event.event !== "pinned") {
					terminateHelper(
						pinnedHelperFailure(
							"Flow pinned filesystem helper omitted its ready event.",
						),
					);
					return;
				}
				stdout = stdout.slice(newline + 1);
				readyState = "resolved";
				clearTimeout(readyTimeout);
				completionTimeout = setTimeout(
					() => {
						terminateHelper(
							pinnedHelperFailure(
								"Flow pinned filesystem helper timed out before completion.",
							),
						);
					},
					positiveTimeout(
						options.pinnedHelperCompletionTimeoutMs,
						PINNED_HELPER_COMPLETION_TIMEOUT_MS,
					),
				);
				completionTimeout.unref();
				resolvePinned?.();
			}
		}
	});
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.stdin.on("error", () => {
		// The exit status below owns helper failures, including an early stdin close.
	});
	const completion = new Promise<PinnedHelperResult>((resolve, reject) => {
		child.once("error", (error) => {
			clearTimeout(readyTimeout);
			if (completionTimeout) clearTimeout(completionTimeout);
			const failure = forcedFailure ?? helperFailure(stderr, error);
			if (readyState === "pending") {
				readyState = "rejected";
				rejectPinned?.(failure);
			}
			reject(failure);
		});
		child.once("close", (code) => {
			clearTimeout(readyTimeout);
			if (completionTimeout) clearTimeout(completionTimeout);
			if (forcedFailure) {
				reject(forcedFailure);
				return;
			}
			if (readyState !== "resolved") {
				const failure = pinnedHelperFailure(
					"Flow could not start its pinned filesystem helper under the current host runtime.",
				);
				if (readyState === "pending") {
					readyState = "rejected";
					rejectPinned?.(failure);
				}
				reject(failure);
				return;
			}
			if (code !== 0) {
				reject(helperFailure(stderr));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as PinnedHelperResult);
			} catch (error) {
				reject(
					pinnedHelperFailure(
						"Flow pinned filesystem helper returned invalid output.",
						error,
					),
				);
			}
		});
	});
	try {
		await pinnedPromise;
	} catch (error) {
		await completion.catch(() => undefined);
		throw error;
	}
	try {
		await afterPinned?.();
	} catch (error) {
		child.kill("SIGKILL");
		await completion.catch(() => undefined);
		throw error;
	}
	child.stdin.end(input);
	return completion;
}

function pinnedRequest(
	operation: string,
	canonicalPath: string,
	expectedCwd: ManagedPathIdentity,
	canonicalParentPath: string,
	expectedParent: ManagedPathIdentity,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		operation,
		canonicalPath,
		expectedCwd,
		canonicalParentPath,
		expectedParent,
		...extra,
	};
}

async function readPinnedFile(
	directory: string,
	directoryIdentity: ManagedPathIdentity,
	parentDirectory: string,
	parentIdentity: ManagedPathIdentity,
	name: string,
	options: PinnedHelperRunOptions = {},
): Promise<PinnedFileRead> {
	const result = await runPinnedDirectoryHelper(
		directory,
		pinnedRequest(
			"read",
			directory,
			directoryIdentity,
			parentDirectory,
			parentIdentity,
			{ name },
		),
		"",
		undefined,
		options,
	);
	if (result.status !== "read") {
		throw new Error(
			"Flow pinned filesystem helper returned the wrong read result.",
		);
	}
	return {
		contents: Buffer.from(result.contents, "base64").toString("utf8"),
		identity: result.identity,
	};
}

async function readPinnedCanonicalArchiveEntries(
	root: string,
	flowIdentity: ManagedPathIdentity,
	historyIdentity: ManagedPathIdentity,
	options: PinnedHelperRunOptions = {},
): Promise<PinnedArchiveEntry[]> {
	const history = historyDir(root);
	const result = await runPinnedDirectoryHelper(
		history,
		pinnedRequest(
			"listCanonical",
			history,
			historyIdentity,
			flowDir(root),
			flowIdentity,
		),
		"",
		undefined,
		options,
	);
	if (result.status !== "listed") {
		throw new Error(
			"Flow pinned filesystem helper returned the wrong archive-list result.",
		);
	}
	return result.entries.map((entry) => ({
		filename: entry.filename,
		contents: Buffer.from(entry.contents, "base64").toString("utf8"),
	}));
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
	if (Object.hasOwn(parsed.value, "version") && parsed.value.version !== 4) {
		throw new UnsupportedFlowSessionVersionError(parsed.value.version);
	}
	const result = SessionSchema.safeParse(parsed.value);
	if (!result.success) {
		const reason = "it does not match the current Session v4 schema";
		throw new UnreadableFlowSessionError(
			`Flow session file at ${sessionPath(root)} is unreadable: ${reason}.`,
			reason,
		);
	}
	return result.data;
}

const CANONICAL_ARCHIVE_FILENAME = /^[a-f0-9]{64}\.json$/;

function parseCanonicalArchivedSession(entry: PinnedArchiveEntry): Session {
	if (!CANONICAL_ARCHIVE_FILENAME.test(entry.filename)) {
		throw new ArchivedSessionLookupError(
			"Flow could not verify canonical archived session history.",
		);
	}
	const parsed = parseStrictJsonObject(entry.contents, "Flow session archive");
	if (!parsed.ok) {
		throw new ArchivedSessionLookupError(
			"Flow could not verify canonical archived session history.",
		);
	}
	if (parsed.value.version !== 4) {
		throw new ArchivedSessionLookupError(
			"Flow could not verify canonical archived Session v4 history.",
		);
	}
	const session = SessionSchema.safeParse(parsed.value);
	if (
		!session.success ||
		entry.filename !== archivedSessionFilename(session.data.id)
	) {
		throw new ArchivedSessionLookupError(
			"Flow could not verify canonical archived session history.",
		);
	}
	if (session.data.closure === null) {
		throw new ArchivedSessionLookupError(
			"Flow could not verify explicitly closed canonical session history.",
		);
	}
	return session.data;
}

async function loadCanonicalArchivedSessions(root: string): Promise<Session[]> {
	if (
		(await managedDirectoryState(flowDir(root), "the Flow state directory")) ===
			"missing" ||
		(await managedDirectoryState(
			historyDir(root),
			"the Flow session history directory",
		)) === "missing"
	) {
		return [];
	}
	const flowIdentity = await managedDirectoryIdentity(
		flowDir(root),
		"the Flow state directory",
	);
	const historyIdentity = await managedDirectoryIdentity(
		historyDir(root),
		"the Flow session history directory",
	);
	const entries = await readPinnedCanonicalArchiveEntries(
		root,
		flowIdentity,
		historyIdentity,
	);
	await assertManagedDirectoryIdentity(
		flowDir(root),
		"the Flow state directory",
		flowIdentity,
	);
	await assertManagedDirectoryIdentity(
		historyDir(root),
		"the Flow session history directory",
		historyIdentity,
	);
	return entries.map(parseCanonicalArchivedSession);
}

async function findCanonicalArchivedSession(
	worktree: string,
	predicate: (session: Session) => boolean,
): Promise<Session | null> {
	const root = assertMutableWorkspaceRoot(worktree);
	try {
		const matches = (await loadCanonicalArchivedSessions(root)).filter(
			predicate,
		);
		if (matches.length > 1) {
			throw new ArchivedSessionLookupError(
				"Flow found ambiguous archived operation history.",
			);
		}
		return matches[0] ?? null;
	} catch (error) {
		if (error instanceof ArchivedSessionLookupError) throw error;
		if (error instanceof PinnedFilesystemHelperError) {
			throw new ArchivedSessionLookupError(error.message, {
				cause: error,
				failureKind: "helper-runtime",
			});
		}
		throw new ArchivedSessionLookupError(
			"Flow could not verify archived operation history safely.",
			{ cause: error },
		);
	}
}

/**
 * Find any canonical archive containing an operation id. Close-start preflight
 * uses this wider lookup because a retry handle must not collide with any
 * historical mutation identity.
 */
export function findArchivedSessionByOperationId(
	worktree: string,
	operationId: string,
): Promise<Session | null> {
	return findCanonicalArchivedSession(worktree, (session) =>
		session.causal.mutations.some(
			(mutation) => mutation.operationId === operationId,
		),
	);
}

/**
 * Recover only the archive whose accepted closure owns this retry handle.
 * A later session may reuse the same text for a non-close mutation without
 * making the original accepted close ambiguous.
 */
export function findArchivedSessionByCloseRetryOperationId(
	worktree: string,
	operationId: string,
): Promise<Session | null> {
	return findCanonicalArchivedSession(
		worktree,
		(session) => session.closure?.retryOperationId === operationId,
	);
}

export async function quarantineUnreadableSession(
	worktree: string,
	hooks: ArchiveAndClearTestHooks = {},
): Promise<string | null> {
	const root = assertMutableWorkspaceRoot(worktree);
	if (
		(await managedDirectoryState(flowDir(root), "the Flow state directory")) ===
			"missing" ||
		(await managedFileState(sessionPath(root), "the Flow session file")) ===
			"missing"
	) {
		return null;
	}
	await ensureFlowGitignore(root);
	await ensureHistoryDirectory(root);
	const rootIdentity = await managedDirectoryIdentity(
		root,
		"the workspace root",
	);
	const flowIdentity = await managedDirectoryIdentity(
		flowDir(root),
		"the Flow state directory",
	);
	const historyIdentity = await managedDirectoryIdentity(
		historyDir(root),
		"the Flow session history directory",
	);
	let active: PinnedFileRead;
	try {
		active = await readPinnedFile(
			flowDir(root),
			flowIdentity,
			root,
			rootIdentity,
			"session.json",
			hooks,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const activeSha256 = createHash("sha256")
		.update(active.contents, "utf8")
		.digest("hex");
	const targetFilename = `quarantine-${activeSha256}.json`;
	const target = join(historyDir(root), targetFilename);
	const publication = await runPinnedDirectoryHelper(
		historyDir(root),
		pinnedRequest(
			"publish",
			historyDir(root),
			historyIdentity,
			flowDir(root),
			flowIdentity,
			{
				targetName: targetFilename,
				tempName: `.quarantine-${process.pid}-${randomUUID()}.tmp`,
			},
		),
		active.contents,
		hooks.afterHistoryPinned,
		hooks,
	);
	if (
		publication.status === "exists" &&
		Buffer.from(publication.contents, "base64").toString("utf8") !==
			active.contents
	) {
		throw new ArchiveCollisionError(
			"Flow quarantine target already exists with different contents.",
		);
	}
	if (publication.status !== "published" && publication.status !== "exists") {
		throw new Error(
			"Flow pinned filesystem helper returned the wrong quarantine result.",
		);
	}
	await Promise.all([
		assertManagedDirectoryIdentity(root, "the workspace root", rootIdentity),
		assertManagedDirectoryIdentity(
			flowDir(root),
			"the Flow state directory",
			flowIdentity,
		),
		assertManagedDirectoryIdentity(
			historyDir(root),
			"the Flow session history directory",
			historyIdentity,
		),
	]);
	const quarantined = await readPinnedFile(
		historyDir(root),
		historyIdentity,
		flowDir(root),
		flowIdentity,
		targetFilename,
		hooks,
	);
	if (quarantined.contents !== active.contents) {
		throw new ArchiveCollisionError(
			"Flow could not verify quarantined session contents before cleanup.",
		);
	}
	const removal = await runPinnedDirectoryHelper(
		flowDir(root),
		pinnedRequest("remove", flowDir(root), flowIdentity, root, rootIdentity, {
			name: "session.json",
			expectedFileIdentity: active.identity,
			expectedSha256: activeSha256,
			expectedHistoryIdentity: historyIdentity,
			expectedArchiveName: targetFilename,
			expectedArchiveSha256: activeSha256,
		}),
		"",
		hooks.afterFlowPinnedBeforeDelete,
		hooks,
	);
	if (removal.status !== "removed") {
		throw new Error(
			"Flow pinned filesystem helper returned the wrong quarantine cleanup result.",
		);
	}
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
	hooks: ArchiveAndClearTestHooks = {},
): Promise<void> {
	const root = assertMutableWorkspaceRoot(worktree);
	const normalized = SessionSchema.parse(session);
	if (normalized.closure === null) {
		throw new UnclosedSessionArchiveError(
			"Flow refuses to publish canonical history without an accepted session closure.",
		);
	}
	await ensureFlowGitignore(root);
	await ensureHistoryDirectory(root);
	await managedFileState(
		join(flowDir(root), ".gitignore"),
		"the Flow ignore file",
	);
	const expectedContents = `${JSON.stringify(normalized, null, 2)}\n`;
	const rootIdentity = await managedDirectoryIdentity(
		root,
		"the workspace root",
	);
	const flowIdentity = await managedDirectoryIdentity(
		flowDir(root),
		"the Flow state directory",
	);
	const historyIdentity = await managedDirectoryIdentity(
		historyDir(root),
		"the Flow session history directory",
	);
	const active = await readPinnedFile(
		flowDir(root),
		flowIdentity,
		root,
		rootIdentity,
		"session.json",
		hooks,
	);
	const targetFilename = archivedSessionFilename(normalized.id);
	const targetPath = archivedSessionPath(root, normalized.id);
	const normalizeContents = (contents: string): string | null => {
		const parsed = parseStrictJsonObject(contents, "Flow session archive");
		if (!parsed.ok) return null;
		const result = SessionSchema.safeParse(parsed.value);
		return result.success ? `${JSON.stringify(result.data, null, 2)}\n` : null;
	};
	if (normalizeContents(active.contents) !== expectedContents) {
		throw new ArchiveCollisionError(
			"Flow refused to archive because the active session changed before publication.",
		);
	}

	const beforeEntries = await readPinnedCanonicalArchiveEntries(
		root,
		flowIdentity,
		historyIdentity,
		hooks,
	);
	const archivedBefore = beforeEntries.map(parseCanonicalArchivedSession);
	const competingRetry = archivedBefore.find(
		(archived) =>
			archived.id !== normalized.id &&
			archived.closure?.retryOperationId ===
				normalized.closure?.retryOperationId,
	);
	if (competingRetry) {
		throw new ArchiveCollisionError(
			"Flow refused to publish an archive with an ambiguous close retry identity.",
		);
	}
	const existing = beforeEntries.find(
		(entry) => entry.filename === targetFilename,
	);
	if (existing && normalizeContents(existing.contents) !== expectedContents) {
		throw new ArchiveCollisionError(
			`Flow archive already exists with different contents: ${targetPath}.`,
		);
	}
	await Promise.all([
		assertManagedDirectoryIdentity(root, "the workspace root", rootIdentity),
		assertManagedDirectoryIdentity(
			flowDir(root),
			"the Flow state directory",
			flowIdentity,
		),
		assertManagedDirectoryIdentity(
			historyDir(root),
			"the Flow session history directory",
			historyIdentity,
		),
	]);

	if (existing) {
		// A previous close reached archive publication but not active-state
		// cleanup. Continue the same transaction instead of wedging retries.
	} else {
		const publication = await runPinnedDirectoryHelper(
			historyDir(root),
			pinnedRequest(
				"publish",
				historyDir(root),
				historyIdentity,
				flowDir(root),
				flowIdentity,
				{
					targetName: targetFilename,
					tempName: `.publish-${process.pid}-${randomUUID()}.tmp`,
				},
			),
			expectedContents,
			hooks.afterHistoryPinned,
			hooks,
		);
		if (
			publication.status === "exists" &&
			normalizeContents(
				Buffer.from(publication.contents, "base64").toString("utf8"),
			) !== expectedContents
		) {
			throw new ArchiveCollisionError(
				`Flow archive already exists with different contents: ${targetPath}.`,
			);
		}
		if (publication.status !== "published" && publication.status !== "exists") {
			throw new Error(
				"Flow pinned filesystem helper returned the wrong publication result.",
			);
		}
	}

	await Promise.all([
		assertManagedDirectoryIdentity(root, "the workspace root", rootIdentity),
		assertManagedDirectoryIdentity(
			flowDir(root),
			"the Flow state directory",
			flowIdentity,
		),
		assertManagedDirectoryIdentity(
			historyDir(root),
			"the Flow session history directory",
			historyIdentity,
		),
	]);
	const verifiedEntries = await readPinnedCanonicalArchiveEntries(
		root,
		flowIdentity,
		historyIdentity,
		hooks,
	);
	verifiedEntries.map(parseCanonicalArchivedSession);
	const verified = verifiedEntries.find(
		(entry) => entry.filename === targetFilename,
	);
	if (!verified || normalizeContents(verified.contents) !== expectedContents) {
		throw new ArchiveCollisionError(
			"Flow could not verify the exact archive before active-state deletion.",
		);
	}
	await Promise.all([
		assertManagedDirectoryIdentity(root, "the workspace root", rootIdentity),
		assertManagedDirectoryIdentity(
			flowDir(root),
			"the Flow state directory",
			flowIdentity,
		),
		assertManagedDirectoryIdentity(
			historyDir(root),
			"the Flow session history directory",
			historyIdentity,
		),
	]);
	const removal = await runPinnedDirectoryHelper(
		flowDir(root),
		pinnedRequest("remove", flowDir(root), flowIdentity, root, rootIdentity, {
			name: "session.json",
			expectedFileIdentity: active.identity,
			expectedSha256: createHash("sha256")
				.update(active.contents, "utf8")
				.digest("hex"),
			expectedHistoryIdentity: historyIdentity,
			expectedArchiveName: targetFilename,
			expectedArchiveSha256: createHash("sha256")
				.update(verified.contents, "utf8")
				.digest("hex"),
		}),
		"",
		hooks.afterFlowPinnedBeforeDelete,
		hooks,
	);
	if (removal.status !== "removed") {
		throw new Error(
			"Flow pinned filesystem helper returned the wrong active-delete result.",
		);
	}
	await Promise.all([
		assertManagedDirectoryIdentity(root, "the workspace root", rootIdentity),
		assertManagedDirectoryIdentity(
			flowDir(root),
			"the Flow state directory",
			flowIdentity,
		),
		assertManagedDirectoryIdentity(
			historyDir(root),
			"the Flow session history directory",
			historyIdentity,
		),
	]);
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
		if (
			process.platform !== "win32" ||
			(error as NodeJS.ErrnoException).code !== "EPERM"
		) {
			throw error;
		}
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
