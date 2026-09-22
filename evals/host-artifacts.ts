import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	chmod,
	copyFile,
	cp,
	type FileHandle,
	lstat,
	mkdir,
	open,
	readdir,
	readlink,
	realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { datasetDigest } from "./recovery-decisions/schema.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Bytes = z
	.object({
		sha256: Hash,
		size: z.number().int().nonnegative(),
		executable: z.boolean(),
	})
	.strict();
const Entry = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("directory"), path: z.string() }).strict(),
	z
		.object({ kind: z.literal("file"), path: z.string(), bytes: Bytes })
		.strict(),
	z
		.object({
			kind: z.literal("symlink"),
			path: z.string(),
			target: z.string(),
		})
		.strict(),
]);
export const HostArtifactsSchema = z
	.object({
		schemaVersion: z.literal(1),
		platform: z.string(),
		architecture: z.string(),
		bun: z.object({ version: z.string(), bytes: Bytes }).strict(),
		opencode: z.object({ version: z.string(), bytes: Bytes }).strict(),
		packageCache: z.array(Entry).nullable(),
	})
	.strict();
export const HostArtifactVerificationSchema = z
	.object({
		manifestDigest: Hash,
		method: z.enum([
			"copied-files-and-linux-process",
			"copied-files-and-direct-spawn",
		]),
	})
	.strict();
export type HostArtifactVerification = z.infer<
	typeof HostArtifactVerificationSchema
>;
export function validateHostArtifactVerification(
	expected: HostArtifacts | undefined,
	observed: HostArtifactVerification | undefined,
) {
	if (expected === undefined && observed === undefined) return;
	if (
		!expected ||
		!observed ||
		observed.manifestDigest !== datasetDigest(expected) ||
		(observed.method === "copied-files-and-linux-process") !==
			(expected.platform === "linux")
	)
		throw new Error("Host artifact verification does not match its manifest.");
}
export type HostArtifacts = z.infer<typeof HostArtifactsSchema>;
export type HostArtifactPaths = {
	bun: string;
	opencode: string;
	packageCache: string | null;
};
const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);

export async function artifactFile(path: string, signal?: AbortSignal) {
	signal?.throwIfAborted();
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	return hashArtifactHandle(file, signal);
}
async function hashArtifactHandle(file: FileHandle, signal?: AbortSignal) {
	try {
		const before = await file.stat();
		if (!before.isFile()) throw new Error("Artifact must be a regular file.");
		const hash = createHash("sha256");
		const buffer = Buffer.alloc(256 * 1024);
		let size = 0;
		for (;;) {
			signal?.throwIfAborted();
			const read = await file.read(buffer, 0, buffer.length, null);
			if (!read.bytesRead) break;
			size += read.bytesRead;
			hash.update(buffer.subarray(0, read.bytesRead));
		}
		const after = await file.stat();
		if (
			size !== before.size ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			throw new Error("Artifact changed while reading.");
		return {
			sha256: hash.digest("hex"),
			size,
			executable: (before.mode & 0o111) !== 0,
		};
	} finally {
		await file.close();
	}
}
export async function processArtifactFile(pid: number, signal?: AbortSignal) {
	if (process.platform !== "linux")
		throw new Error("Process executable observation requires Linux.");
	const executable = await open(`/proc/${pid}/exe`, constants.O_RDONLY);
	return hashArtifactHandle(executable, signal);
}
async function nativeFile(path: string, signal?: AbortSignal) {
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const info = await file.stat();
		if (!info.isFile())
			throw new Error("Native executable must be a regular file.");
		const magic = Buffer.alloc(4);
		await file.read(magic, 0, 4, 0);
		const hex = magic.toString("hex");
		if (
			!(
				hex === "7f454c46" ||
				["cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(hex) ||
				hex.startsWith("4d5a")
			)
		)
			throw new Error(
				"Artifact executable must be native, not a launcher script.",
			);
	} finally {
		await file.close();
	}
	const bytes = await artifactFile(path, signal);
	if (!bytes.executable && process.platform !== "win32")
		throw new Error("Artifact is not executable.");
	return bytes;
}
function within(root: string, path: string) {
	const rel = relative(root, path);
	return (
		rel === "" ||
		(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
	);
}
export async function artifactTree(
	directory: string,
	signal?: AbortSignal,
): Promise<NonNullable<HostArtifacts["packageCache"]>> {
	const root = await realpath(directory);
	if (!(await lstat(root)).isDirectory())
		throw new Error("Artifact cache must be a directory.");
	const entries: NonNullable<HostArtifacts["packageCache"]> = [];
	const visit = async (path: string) => {
		for (const name of (await readdir(join(root, path))).sort()) {
			signal?.throwIfAborted();
			if (entries.length >= 100000)
				throw new Error("Artifact cache has too many entries.");
			const child = path ? `${path}/${name}` : name;
			const absolute = join(root, child);
			const info = await lstat(absolute);
			if (info.isSymbolicLink()) {
				const target = await readlink(absolute);
				if (
					isAbsolute(target) ||
					!within(root, resolve(dirname(absolute), target)) ||
					!within(root, await realpath(absolute))
				)
					throw new Error(
						`Artifact cache symlink escapes its tree at ${child}.`,
					);
				entries.push({ kind: "symlink", path: child, target });
			} else if (info.isDirectory()) {
				entries.push({ kind: "directory", path: child });
				await visit(child);
			} else if (info.isFile())
				entries.push({
					kind: "file",
					path: child,
					bytes: await artifactFile(absolute, signal),
				});
			else throw new Error("Unsupported artifact cache entry.");
		}
	};
	await visit("");
	return entries;
}
export async function captureHostArtifacts(input: {
	paths: HostArtifactPaths;
	bunVersion: string;
	opencodeVersion: string;
	signal?: AbortSignal | undefined;
}): Promise<HostArtifacts> {
	return {
		schemaVersion: 1,
		platform: process.platform,
		architecture: process.arch,
		bun: {
			version: input.bunVersion,
			bytes: await nativeFile(await realpath(input.paths.bun), input.signal),
		},
		opencode: {
			version: input.opencodeVersion,
			bytes: await nativeFile(
				await realpath(input.paths.opencode),
				input.signal,
			),
		},
		packageCache:
			input.paths.packageCache === null
				? null
				: await artifactTree(input.paths.packageCache, input.signal),
	};
}
export async function verifyHostArtifacts(
	paths: HostArtifactPaths,
	expected: HostArtifacts,
	signal?: AbortSignal,
	pid?: number,
) {
	const actual = await captureHostArtifacts({
		paths,
		bunVersion: expected.bun.version,
		opencodeVersion: expected.opencode.version,
		signal,
	});
	if (!same(actual, expected)) throw new Error("Host artifact bytes changed.");
	if (pid !== undefined && process.platform === "linux") {
		if (!same(await processArtifactFile(pid, signal), expected.opencode.bytes))
			throw new Error(
				"Running OpenCode executable differs from registered bytes.",
			);
	}
}
export async function stageHostArtifacts(input: {
	paths: HostArtifactPaths;
	expected: HostArtifacts;
	directory: string;
	packageCache: string | null;
	signal?: AbortSignal | undefined;
}): Promise<HostArtifactPaths> {
	await verifyHostArtifacts(input.paths, input.expected, input.signal);
	await mkdir(input.directory, { mode: 0o700 });
	const paths = {
		bun: join(
			input.directory,
			process.platform === "win32" ? "bun.exe" : "bun",
		),
		opencode: join(
			input.directory,
			process.platform === "win32" ? "opencode.exe" : "opencode",
		),
		packageCache: input.packageCache,
	};
	for (const key of ["bun", "opencode"] as const) {
		input.signal?.throwIfAborted();
		await copyFile(
			await realpath(input.paths[key]),
			paths[key],
			constants.COPYFILE_EXCL,
		);
		await chmod(paths[key], 0o700);
	}
	if (input.paths.packageCache !== null && paths.packageCache !== null) {
		await mkdir(dirname(paths.packageCache), { recursive: true });
		await cp(await realpath(input.paths.packageCache), paths.packageCache, {
			recursive: true,
			verbatimSymlinks: true,
			filter: () => {
				input.signal?.throwIfAborted();
				return true;
			},
		});
	}
	if (paths.packageCache !== null) {
		const root = await lstat(paths.packageCache);
		if (!root.isDirectory() || root.isSymbolicLink())
			throw new Error("Copied artifact cache must be a private directory.");
	}
	await verifyHostArtifacts(paths, input.expected, input.signal);
	for (const key of ["bun", "opencode"] as const) {
		input.signal?.throwIfAborted();
		const probe = spawnSync(paths[key], ["--version"], {
			encoding: "utf8",
			timeout: 10000,
			env: { PATH: input.directory },
			maxBuffer: 100000,
		});
		if (
			probe.status !== 0 ||
			probe.stdout.trim() !== input.expected[key].version
		)
			throw new Error(
				`Artifact ${key} version differs from registered version.`,
			);
	}
	await verifyHostArtifacts(paths, input.expected, input.signal);
	return paths;
}
