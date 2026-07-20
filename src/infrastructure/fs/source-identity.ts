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
import { assertMutableWorkspaceRoot } from "./workspace.js";

export class SourceIdentityError extends Error {
	readonly code = "FLOW_SOURCE_IDENTITY";
}

function fail(message: string, cause?: unknown): never {
	throw new SourceIdentityError(message, cause ? { cause } : undefined);
}

function parseGitWorkspaceEntry(entry: string): string {
	const staged = /^([0-7]{6}) [0-9a-f]+ [0-3]\t([\s\S]+)$/.exec(entry);
	if (!staged) return entry;
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
				const text = Buffer.isBuffer(stdout)
					? stdout.toString("utf8")
					: String(stdout);
				try {
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

export function createFileSourceIdentityProvider(
	workspace: string,
): SourceIdentityProvider {
	const root = assertMutableWorkspaceRoot(workspace);
	return {
		async computeSourceDigest(): Promise<SourceDigest> {
			const paths = [
				...new Set(
					(await gitWorkspacePaths(root))
						.filter((path) => !isFlowRuntimePath(path))
						.map(safeRelativePath),
				),
			].sort();
			if (paths.length > MAX_SOURCE_FILES) {
				fail(
					`Workspace exceeds the ${MAX_SOURCE_FILES}-file fingerprint limit.`,
				);
			}
			const hash = createHash("sha256");
			hash.update("flow-workspace-content-v1\0");
			let totalBytes = 0;
			for (const relativePath of paths) {
				const path = join(root, relativePath);
				let before: Awaited<ReturnType<typeof lstat>>;
				try {
					before = await lstat(path);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") {
						hashField(hash, relativePath);
						hashField(hash, "missing");
						continue;
					}
					fail("Flow could not inspect workspace content.", error);
				}
				hashField(hash, relativePath);
				if (before.isSymbolicLink()) {
					const target = await readlink(path);
					const after = await lstat(path);
					if (!sameStat(before, after))
						fail("Workspace content changed during fingerprinting.");
					hashField(hash, "symlink");
					hashField(hash, target);
					continue;
				}
				if (!before.isFile()) {
					fail("Flow fingerprints only regular files and symbolic links.");
				}
				if (before.size > MAX_SOURCE_FILE_BYTES) {
					fail(`A workspace file exceeds ${MAX_SOURCE_FILE_BYTES} bytes.`);
				}
				totalBytes += before.size;
				if (totalBytes > MAX_SOURCE_TOTAL_BYTES) {
					fail(`Workspace content exceeds ${MAX_SOURCE_TOTAL_BYTES} bytes.`);
				}
				const noFollow =
					process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
				const handle = await open(path, constants.O_RDONLY | noFollow);
				let contents: Buffer;
				try {
					contents = await handle.readFile();
				} finally {
					await handle.close();
				}
				const after = await lstat(path);
				if (!sameStat(before, after) || contents.byteLength !== before.size) {
					fail("Workspace content changed during fingerprinting.");
				}
				hashField(hash, "file");
				hashField(hash, String(before.mode & 0o111));
				hashField(hash, contents);
			}
			return `sha256:${hash.digest("hex")}`;
		},
	};
}
