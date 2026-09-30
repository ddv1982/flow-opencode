import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { SourceIdentityProvider } from "../../application/ports/source-identity.js";
import {
	MAX_SOURCE_FILE_BYTES,
	MAX_SOURCE_FILES,
	MAX_SOURCE_TOTAL_BYTES,
} from "../../domain/limits.js";
import type { SourceDigest } from "../../domain/session.js";
import { assertMutableWorkspaceRoot } from "./workspace-paths.js";

export class SourceIdentityError extends Error {
	readonly code = "FLOW_SOURCE_IDENTITY";
}

function fail(message: string, cause?: unknown): never {
	throw new SourceIdentityError(message, cause ? { cause } : undefined);
}

function parseGitWorkspaceEntry(entry: string): string {
	// -t distinguishes raw untracked names from index records without guessing
	// from filename bytes, which may themselves look exactly like a staged entry.
	if (entry.startsWith("? ")) return entry.slice(2);
	const staged = /^[HSM] ([0-7]{6}) [0-9a-f]+ [0-3]\t([\s\S]+)$/.exec(entry);
	if (!staged) fail("Git returned an unrecognized workspace record.");
	if (staged[1] === "160000") {
		fail(
			"Flow does not support Git submodules in source fingerprints; remove the tracked gitlink before continuing.",
		);
	}
	return staged[2] ?? "";
}

function gitWorkspacePaths(workspace: string): Promise<string[]> {
	return new Promise((resolvePaths, rejectPaths) => {
		execFile(
			"git",
			[
				"-C",
				workspace,
				"ls-files",
				"-co",
				"--exclude-standard",
				"--stage",
				"-t",
				"-z",
			],
			{ encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
			(error, stdout) => {
				if (error) {
					rejectPaths(
						new SourceIdentityError(
							"Flow requires a readable Git workspace to fingerprint source content.",
							{ cause: error },
						),
					);
					return;
				}
				try {
					let text: string;
					try {
						text = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
					} catch (error) {
						fail("Flow requires UTF-8 workspace filenames.", error);
					}
					resolvePaths(
						text.split("\0").filter(Boolean).map(parseGitWorkspaceEntry),
					);
				} catch (parseError) {
					rejectPaths(parseError);
				}
			},
		);
	});
}

function safeRelativePath(path: string): string {
	const normalized = normalize(path);
	if (
		isAbsolute(path) ||
		normalized === ".." ||
		normalized.startsWith(`..${sep}`) ||
		normalized === ".git" ||
		normalized.startsWith(`.git${sep}`)
	) {
		fail("Git returned an unsafe workspace path.");
	}
	return normalized;
}

function isFlowRuntimePath(path: string): boolean {
	return path === ".flow" || path.startsWith(".flow/");
}

function hashField(
	hash: ReturnType<typeof createHash>,
	value: string | Buffer,
): void {
	const bytes = typeof value === "string" ? Buffer.from(value) : value;
	hash.update(String(bytes.byteLength));
	hash.update(":");
	hash.update(bytes);
	hash.update("\0");
}

function sameStat(
	left: Awaited<ReturnType<typeof lstat>>,
	right: Awaited<ReturnType<typeof lstat>>,
): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.mode === right.mode &&
		left.size === right.size &&
		left.mtimeMs === right.mtimeMs &&
		left.isFile() === right.isFile() &&
		left.isSymbolicLink() === right.isSymbolicLink()
	);
}

export type WorkspaceSourceEntry = Readonly<{
	path: string;
	kind: "missing" | "file" | "symlink";
	mode: number;
	bytes: Buffer;
}>;

async function sourceParents(root: string, relativePath: string) {
	const paths = [root];
	const parts = relativePath.split(sep);
	for (let index = 1; index < parts.length; index += 1) {
		paths.push(join(root, ...parts.slice(0, index)));
	}
	const parents: { path: string; stat: Awaited<ReturnType<typeof lstat>> }[] =
		[];
	for (const path of paths) {
		let stat: Awaited<ReturnType<typeof lstat>>;
		try {
			stat = await lstat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		if (!stat.isDirectory() || stat.isSymbolicLink()) {
			fail(
				"Flow refuses a symbolic link or non-directory in a source parent path.",
			);
		}
		parents.push({ path, stat });
	}
	return parents;
}

export async function workspaceSourcePathExists(
	root: string,
	relativePath: string,
): Promise<boolean> {
	const safePath = safeRelativePath(relativePath);
	if (!(await sourceParents(root, safePath))) return false;
	try {
		await lstat(join(root, safePath));
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function readWorkspaceSourceEntry(
	root: string,
	relativePath: string,
): Promise<WorkspaceSourceEntry> {
	const safePath = safeRelativePath(relativePath);
	const missing: WorkspaceSourceEntry = {
		path: safePath,
		kind: "missing",
		mode: 0,
		bytes: Buffer.alloc(0),
	};
	const parents = await sourceParents(root, safePath);
	if (!parents) return missing;
	const path = join(root, safePath);
	let before: Awaited<ReturnType<typeof lstat>>;
	try {
		before = await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing;
		fail("Flow could not inspect workspace content.", error);
	}
	let kind: WorkspaceSourceEntry["kind"];
	let bytes: Buffer;
	let mode = 0;
	if (before.isSymbolicLink()) {
		kind = "symlink";
		bytes = await readlink(path, { encoding: "buffer" });
		try {
			new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch (error) {
			fail("Flow requires UTF-8 symbolic-link targets.", error);
		}
	} else {
		if (!before.isFile())
			fail("Flow fingerprints only regular files and symbolic links.");
		if (before.size > MAX_SOURCE_FILE_BYTES)
			fail(`A workspace file exceeds ${MAX_SOURCE_FILE_BYTES} bytes.`);
		kind = "file";
		mode = before.mode & 0o111;
		const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
		const handle = await open(path, constants.O_RDONLY | noFollow);
		try {
			if (!sameStat(before, await handle.stat()))
				fail("Workspace content changed during fingerprinting.");
			bytes = await handle.readFile();
		} finally {
			await handle.close();
		}
	}
	if (
		!sameStat(before, await lstat(path)) ||
		(kind === "file" && bytes.length !== before.size)
	) {
		fail("Workspace content changed during fingerprinting.");
	}
	for (const parent of parents) {
		const after = await lstat(parent.path);
		if (
			parent.stat.dev !== after.dev ||
			parent.stat.ino !== after.ino ||
			parent.stat.mode !== after.mode
		) {
			fail("Workspace parent changed during fingerprinting.");
		}
	}
	return { path: safePath, kind, mode, bytes };
}

async function scanWorkspaceSource(
	workspace: string,
	accept: (entry: WorkspaceSourceEntry) => void,
): Promise<SourceDigest> {
	const root = workspace;
	const rootStat = await lstat(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
		fail("Flow refuses a symbolic link or non-directory for the source root.");
	const paths = [
		...new Set(
			(await gitWorkspacePaths(root))
				.filter((path) => !isFlowRuntimePath(path))
				.map(safeRelativePath),
		),
	].sort();
	if (paths.length > MAX_SOURCE_FILES)
		fail(`Workspace exceeds the ${MAX_SOURCE_FILES}-file fingerprint limit.`);
	const hash = createHash("sha256");
	hash.update("flow-workspace-content-v1\0");
	let totalBytes = 0;
	for (const path of paths) {
		const entry = await readWorkspaceSourceEntry(root, path);
		accept(entry);
		hashField(hash, path);
		hashField(hash, entry.kind);
		if (entry.kind === "missing") continue;
		if (entry.kind === "file") {
			totalBytes += entry.bytes.length;
			if (totalBytes > MAX_SOURCE_TOTAL_BYTES)
				fail(`Workspace content exceeds ${MAX_SOURCE_TOTAL_BYTES} bytes.`);
			hashField(hash, String(entry.mode));
		}
		hashField(hash, entry.bytes);
	}
	return `sha256:${hash.digest("hex")}`;
}

export async function captureWorkspaceSource(workspace: string): Promise<
	Readonly<{
		digest: SourceDigest;
		entries: readonly WorkspaceSourceEntry[];
	}>
> {
	const rootStat = await lstat(workspace);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
		fail("Flow refuses a symbolic link or non-directory for the source root.");
	const root = assertMutableWorkspaceRoot(workspace);
	const entries: WorkspaceSourceEntry[] = [];
	const digest = await scanWorkspaceSource(root, (entry) => {
		entries.push(entry);
	});
	return { digest, entries };
}

export function createFileSourceIdentityProvider(
	workspace: string,
): SourceIdentityProvider {
	const root = assertMutableWorkspaceRoot(workspace);
	return {
		computeSourceDigest() {
			return scanWorkspaceSource(root, () => {});
		},
	};
}
