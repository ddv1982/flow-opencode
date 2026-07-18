import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
	type SourceDigest,
	type SourceIdentity,
	SourceIdentityGitError,
	SourceIdentityOverflowError,
	type SourceIdentityProvider,
	SourceIdentityRaceError,
	SourceIdentityUnreadableError,
	SourceIdentityUnsafeSymlinkError,
} from "../../application/ports/source-identity.js";

const execFileAsync = promisify(execFile);

/**
 * Bounded budgets. Exceeding any of these fails closed with a bounded recovery
 * response rather than reading an unbounded amount of source state.
 */
export const MAX_SOURCE_ENTRIES = 20_000;
export const MAX_SOURCE_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const GIT_HEAD_MAX_BUFFER = 4096;

type IndexEntry = {
	path: string;
	mode: string;
	oid: string;
	stage: number;
};

type WorktreeEntry =
	| { path: string; type: "file"; exec: boolean; size: number; content: string }
	| { path: string; type: "symlink"; target: string }
	| { path: string; type: "gitlink" }
	| { path: string; type: "index-only" }
	| { path: string; type: "deleted" };

type Manifest = {
	mode: "git" | "non-git";
	head: string | null;
	index: IndexEntry[];
	worktree: WorktreeEntry[];
};

type Budget = { entries: number; bytes: number };

type GitWorkspace = {
	root: string;
	gitDir: string;
};

function newBudget(): Budget {
	return { entries: 0, bytes: 0 };
}

function countEntry(budget: Budget): void {
	budget.entries += 1;
	if (budget.entries > MAX_SOURCE_ENTRIES) {
		throw new SourceIdentityOverflowError(
			`Source exceeds the ${MAX_SOURCE_ENTRIES}-entry measurement limit.`,
		);
	}
}

function toPosixRelative(root: string, absolutePath: string): string {
	return relative(root, absolutePath).split(sep).join("/");
}

function isFlowOrGitInternal(relativePath: string): boolean {
	return (
		relativePath === ".flow" ||
		relativePath.startsWith(".flow/") ||
		relativePath === ".git" ||
		relativePath.startsWith(".git/")
	);
}

/** Locale-independent total order over UTF-8 path bytes. */
function byPathBytes<T extends { path: string }>(a: T, b: T): number {
	return Buffer.compare(
		Buffer.from(a.path, "utf8"),
		Buffer.from(b.path, "utf8"),
	);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

function digestOfManifest(manifest: Manifest): SourceDigest {
	const hex = createHash("sha256")
		.update("source-v2\u0000")
		.update(stableStringify(manifest))
		.digest("hex");
	return `sha256:${hex}`;
}

/**
 * Inode-level identity used to detect a file mutated while it is being read.
 * `ctimeMs` is included because a write bumps the inode change time even when
 * the caller preserves size and mtime.
 */
function fileIdentity(info: Stats): string {
	return `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

async function safeLstat(
	absolutePath: string,
	relativePath: string,
): Promise<Stats> {
	try {
		return await lstat(absolutePath);
	} catch (error) {
		throw new SourceIdentityUnreadableError(
			`Source entry '${relativePath}' could not be read.`,
			{ cause: error },
		);
	}
}

function errorCode(error: unknown): string | undefined {
	const code = (error as NodeJS.ErrnoException).code;
	return typeof code === "string" ? code : undefined;
}

function processExitCode(error: unknown): number | undefined {
	const code = (error as { code?: unknown }).code;
	return typeof code === "number" ? code : undefined;
}

async function symlinkEntry(
	root: string,
	relativePath: string,
	absolutePath: string,
): Promise<WorktreeEntry> {
	let target: string;
	try {
		target = await readlink(absolutePath);
	} catch (error) {
		throw new SourceIdentityUnreadableError(
			`Symlink '${relativePath}' could not be read.`,
			{ cause: error },
		);
	}
	if (isAbsolute(target)) {
		throw new SourceIdentityUnsafeSymlinkError(
			`Symlink '${relativePath}' targets an absolute path outside the source boundary.`,
		);
	}
	const resolved = resolve(dirname(absolutePath), target);
	const relativeToRoot = relative(root, resolved);
	if (
		relativeToRoot === ".." ||
		relativeToRoot.startsWith(`..${sep}`) ||
		isAbsolute(relativeToRoot)
	) {
		throw new SourceIdentityUnsafeSymlinkError(
			`Symlink '${relativePath}' escapes the source boundary.`,
		);
	}
	// Record the link text without following it.
	return {
		path: relativePath,
		type: "symlink",
		target: target.split(sep).join("/"),
	};
}

async function worktreeEntry(
	root: string,
	relativePath: string,
	absolutePath: string,
	budget: Budget,
	indexOnlyIfAbsent = false,
): Promise<WorktreeEntry> {
	let info: Stats;
	try {
		info = await lstat(absolutePath);
	} catch (error) {
		if (indexOnlyIfAbsent && errorCode(error) === "ENOENT") {
			return { path: relativePath, type: "index-only" };
		}
		throw new SourceIdentityUnreadableError(
			`Source entry '${relativePath}' could not be read.`,
			{ cause: error },
		);
	}
	if (info.isSymbolicLink()) {
		return symlinkEntry(root, relativePath, absolutePath);
	}
	if (info.isDirectory()) {
		// Reached only for a Git submodule working tree (a gitlink). Its intended
		// commit is captured by the index entry; represent presence here without
		// recursing into the nested repository.
		return { path: relativePath, type: "gitlink" };
	}
	if (!info.isFile()) {
		throw new SourceIdentityUnreadableError(
			`Source entry '${relativePath}' is not a regular file, symlink, or directory.`,
		);
	}
	if (info.size > MAX_SOURCE_FILE_BYTES) {
		throw new SourceIdentityOverflowError(
			`Source entry '${relativePath}' exceeds the ${MAX_SOURCE_FILE_BYTES}-byte per-file limit.`,
		);
	}
	budget.bytes += info.size;
	if (budget.bytes > MAX_SOURCE_TOTAL_BYTES) {
		throw new SourceIdentityOverflowError(
			`Source exceeds the ${MAX_SOURCE_TOTAL_BYTES}-byte measurement limit.`,
		);
	}
	const beforeIdentity = fileIdentity(info);
	let content: Buffer;
	try {
		content = await readFile(absolutePath);
	} catch (error) {
		throw new SourceIdentityUnreadableError(
			`Source entry '${relativePath}' could not be read.`,
			{ cause: error },
		);
	}
	const afterIdentity = fileIdentity(
		await safeLstat(absolutePath, relativePath),
	);
	if (afterIdentity !== beforeIdentity) {
		throw new SourceIdentityRaceError(
			`Source entry '${relativePath}' changed while it was being measured.`,
		);
	}
	return {
		path: relativePath,
		type: "file",
		exec: (info.mode & 0o111) !== 0,
		size: info.size,
		content: createHash("sha256").update(content).digest("hex"),
	};
}

type GitAttempt = { ok: true; stdout: Buffer } | { ok: false; error: unknown };

async function attemptGit(
	commandArgs: readonly string[],
	maxBuffer = GIT_MAX_BUFFER,
): Promise<GitAttempt> {
	try {
		const { stdout } = await execFileAsync("git", commandArgs, {
			maxBuffer,
			encoding: "buffer",
		});
		return { ok: true, stdout: stdout as Buffer };
	} catch (error) {
		return { ok: false, error };
	}
}

function workspaceGitArgs(
	workspace: GitWorkspace,
	args: readonly string[],
): string[] {
	return [
		"-C",
		workspace.root,
		`--git-dir=${workspace.gitDir}`,
		`--work-tree=${workspace.root}`,
		...args,
	];
}

async function runGit(
	workspace: GitWorkspace,
	args: readonly string[],
): Promise<Buffer> {
	const attempt = await attemptGit(workspaceGitArgs(workspace, args));
	if (!attempt.ok) {
		throw new SourceIdentityGitError(
			`Git source enumeration failed for '${args[0] ?? "git"}'.`,
			{ cause: attempt.error },
		);
	}
	return attempt.stdout;
}

function splitNulSeparated(output: Buffer): string[] {
	const text = output.toString("utf8");
	if (text.length === 0) return [];
	return text.split("\u0000").filter((entry) => entry.length > 0);
}

function singleGitOutput(output: Buffer, description: string): string {
	let text = output.toString("utf8");
	if (text.endsWith("\r\n")) text = text.slice(0, -2);
	else if (text.endsWith("\n")) text = text.slice(0, -1);
	if (text.length === 0 || text.includes("\u0000")) {
		throw new SourceIdentityGitError(
			`Git ${description} could not be represented safely.`,
		);
	}
	return text;
}

async function gitHead(workspace: GitWorkspace): Promise<string | null> {
	const head = await attemptGit(
		workspaceGitArgs(workspace, ["rev-parse", "--verify", "HEAD"]),
		GIT_HEAD_MAX_BUFFER,
	);
	if (head.ok) {
		const oid = singleGitOutput(head.stdout, "HEAD");
		if (!/^[0-9a-f]{40,64}$/.test(oid)) {
			throw new SourceIdentityGitError(
				"Git HEAD could not be represented safely.",
			);
		}
		return oid;
	}
	const symbolicHead = await attemptGit(
		workspaceGitArgs(workspace, ["symbolic-ref", "-q", "HEAD"]),
		GIT_HEAD_MAX_BUFFER,
	);
	if (symbolicHead.ok) {
		const reference = singleGitOutput(symbolicHead.stdout, "symbolic HEAD");
		const branchReference = reference.startsWith("refs/heads/");
		const branch = await attemptGit(
			workspaceGitArgs(workspace, [
				"show-ref",
				"--verify",
				"--quiet",
				reference,
			]),
			GIT_HEAD_MAX_BUFFER,
		);
		if (!branch.ok && branchReference && processExitCode(branch.error) === 1) {
			// A missing local branch target is the one expected failure for an
			// initialized repository whose first commit has not yet been created.
			return null;
		}
	}
	throw new SourceIdentityGitError("Git HEAD could not be resolved safely.", {
		cause: head.error,
	});
}

const INDEX_LINE = /^([0-7]{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/;

async function gitIndexEntries(workspace: GitWorkspace): Promise<IndexEntry[]> {
	const lines = splitNulSeparated(
		await runGit(workspace, ["ls-files", "--stage", "-z"]),
	);
	const entries: IndexEntry[] = [];
	for (const line of lines) {
		const match = INDEX_LINE.exec(line);
		if (!match) {
			throw new SourceIdentityGitError(
				"Git index entry could not be represented safely.",
			);
		}
		const mode = match[1];
		const oid = match[2];
		const stageText = match[3];
		const path = match[4];
		if (
			mode === undefined ||
			oid === undefined ||
			stageText === undefined ||
			path === undefined
		) {
			throw new SourceIdentityGitError(
				"Git index entry was missing a required field.",
			);
		}
		if (isFlowOrGitInternal(path)) continue;
		entries.push({
			mode,
			oid,
			stage: Number(stageText),
			path,
		});
	}
	return entries;
}

async function gitManifest(
	workspace: GitWorkspace,
	budget: Budget,
): Promise<Manifest> {
	const [head, index, otherPaths, deletedPaths] = await Promise.all([
		gitHead(workspace),
		gitIndexEntries(workspace),
		runGit(workspace, [
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
		]).then(splitNulSeparated),
		runGit(workspace, ["ls-files", "--deleted", "-z"]).then(splitNulSeparated),
	]);
	const deleted = new Set(deletedPaths);
	const indexed = new Set(index.map((entry) => entry.path));
	const paths = new Set<string>();
	for (const entry of index) paths.add(entry.path);
	for (const path of otherPaths) {
		if (!isFlowOrGitInternal(path)) paths.add(path);
	}
	const worktree: WorktreeEntry[] = [];
	for (const path of paths) {
		countEntry(budget);
		if (deleted.has(path)) {
			worktree.push({ path, type: "deleted" });
			continue;
		}
		worktree.push(
			await worktreeEntry(
				workspace.root,
				path,
				join(workspace.root, path),
				budget,
				indexed.has(path),
			),
		);
	}
	index.sort(byPathBytes);
	worktree.sort(byPathBytes);
	return { mode: "git", head, index, worktree };
}

async function walkTree(
	root: string,
	directory: string,
	budget: Budget,
	entries: WorktreeEntry[],
): Promise<void> {
	let dirents: Dirent[];
	try {
		dirents = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		throw new SourceIdentityUnreadableError(
			`Source directory '${toPosixRelative(root, directory) || "."}' could not be read.`,
			{ cause: error },
		);
	}
	for (const dirent of dirents) {
		const absolutePath = join(directory, dirent.name);
		const relativePath = toPosixRelative(root, absolutePath);
		if (isFlowOrGitInternal(relativePath)) continue;
		if (dirent.isDirectory()) {
			await walkTree(root, absolutePath, budget, entries);
			continue;
		}
		countEntry(budget);
		entries.push(await worktreeEntry(root, relativePath, absolutePath, budget));
	}
}

async function nonGitManifest(root: string, budget: Budget): Promise<Manifest> {
	const worktree: WorktreeEntry[] = [];
	await walkTree(root, root, budget, worktree);
	worktree.sort(byPathBytes);
	return { mode: "non-git", head: null, index: [], worktree };
}

async function canonicalGitPath(
	path: string,
	description: string,
): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		throw new SourceIdentityGitError(
			`Git ${description} could not be resolved safely.`,
			{ cause: error },
		);
	}
}

async function gitWorkspace(root: string): Promise<GitWorkspace | null> {
	const dotGit = join(root, ".git");
	let info: Stats;
	try {
		info = await lstat(dotGit);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return null;
		throw new SourceIdentityUnreadableError(
			"The workspace Git entry could not be inspected safely.",
			{ cause: error },
		);
	}
	if (info.isSymbolicLink()) {
		throw new SourceIdentityUnsafeSymlinkError(
			"The workspace Git entry must not be a symlink.",
		);
	}
	if (!info.isDirectory() && !info.isFile()) {
		throw new SourceIdentityUnreadableError(
			"The workspace Git entry is not a directory or regular gitfile.",
		);
	}

	const resolvedGitDir = await attemptGit([
		"-C",
		root,
		"rev-parse",
		"--resolve-git-dir",
		dotGit,
	]);
	if (!resolvedGitDir.ok) {
		throw new SourceIdentityGitError(
			"The workspace Git entry is not a valid repository or gitfile.",
			{ cause: resolvedGitDir.error },
		);
	}
	const gitDirOutput = singleGitOutput(
		resolvedGitDir.stdout,
		"directory location",
	);
	const gitDir = await canonicalGitPath(
		isAbsolute(gitDirOutput) ? gitDirOutput : resolve(root, gitDirOutput),
		"directory location",
	);
	const workspace = { root, gitDir };
	const topLevel = await attemptGit([
		"-C",
		root,
		"rev-parse",
		"--show-toplevel",
	]);
	if (!topLevel.ok) {
		throw new SourceIdentityGitError(
			"The workspace Git top level could not be validated.",
			{ cause: topLevel.error },
		);
	}
	const topLevelOutput = singleGitOutput(topLevel.stdout, "worktree location");
	const [canonicalRoot, canonicalTopLevel] = await Promise.all([
		canonicalGitPath(root, "worktree root"),
		canonicalGitPath(
			isAbsolute(topLevelOutput)
				? topLevelOutput
				: resolve(root, topLevelOutput),
			"top-level worktree",
		),
	]);
	if (canonicalRoot !== canonicalTopLevel) {
		throw new SourceIdentityGitError(
			"The workspace Git entry does not belong to the workspace root.",
		);
	}
	return workspace;
}

async function buildManifest(root: string): Promise<Manifest> {
	const budget = newBudget();
	const workspace = await gitWorkspace(root);
	return workspace
		? gitManifest(workspace, budget)
		: nonGitManifest(root, budget);
}

/**
 * Create the authoritative source-identity provider for a workspace root.
 *
 * The digest binds:
 * - Git: the HEAD commit, the canonical index (mode/object/stage/path), and the
 *   independent working-tree state (content, exec/symlink/gitlink type,
 *   index-only sparse absence, and deletions) for tracked and untracked
 *   non-ignored paths. Representing the index separately from the worktree
 *   distinguishes staged-only changes from equivalent unstaged trees. Sparse
 *   and dense materializations are intentionally distinct source states.
 * - Non-Git: a deterministic full-tree manifest.
 *
 * Git's `--exclude-standard` supplies ignore semantics with no heuristic source
 * exclusions; `.git/**` internals are never enumerated and `.flow/**` is always
 * excluded. Measurement fails closed on unsafe symlinks, unreadable entries,
 * resource overflow, and any workspace change observed while measuring.
 */
export function createFileSourceIdentityProvider(
	root: string,
): SourceIdentityProvider {
	return {
		async computeSourceIdentity(): Promise<SourceIdentity> {
			const first = await buildManifest(root);
			// A bounded second full computation detects structural changes (added,
			// removed, or re-typed entries) that a single pass cannot observe; the
			// per-file pre/post identity check inside each pass detects content
			// mutated during a read.
			const second = await buildManifest(root);
			const digest = digestOfManifest(first);
			if (digest !== digestOfManifest(second)) {
				throw new SourceIdentityRaceError(
					"The workspace changed while its source identity was being measured.",
				);
			}
			return {
				digest,
				mode: first.mode,
				entryCount: first.worktree.length,
			};
		},
	};
}
