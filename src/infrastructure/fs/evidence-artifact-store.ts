import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";
import { join } from "node:path";
import {
	EvidenceArtifactCollisionError,
	EvidenceArtifactIntegrityError,
	EvidenceArtifactNotFoundError,
	type EvidenceArtifactRef,
	type EvidenceArtifactStore,
	EvidenceArtifactTooLargeError,
	InvalidEvidenceArtifactReferenceError,
	MAX_EVIDENCE_ARTIFACT_BYTES,
} from "../../application/ports/evidence-artifact-store.js";
import {
	assertMutableWorkspaceRoot,
	ensureFlowGitignore,
	ensurePinnedManagedDirectory,
	flowDir,
	publishPinnedManagedFile,
	UnsafeFlowWorkspaceLayoutError,
} from "./workspace.js";

const EVIDENCE_KIND = "restricted_evidence_v1";
const SHA256_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/;

type PathState = "missing" | "present";

type OpenArtifact = {
	handle: FileHandle;
	info: Stats;
};

type EvidenceDirectoryGuard = {
	path: string;
	description: string;
	restricted: boolean;
	handle: FileHandle | null;
	info: Stats;
};

type GuardedArtifactShard = {
	path: string;
	guards: EvidenceDirectoryGuard[];
};

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function referenceFor(bytes: Uint8Array): EvidenceArtifactRef {
	return {
		kind: EVIDENCE_KIND,
		digest: `sha256:${sha256(bytes)}`,
		byteLength: bytes.byteLength,
	};
}

function digestHex(ref: EvidenceArtifactRef): string {
	if (
		ref.kind !== EVIDENCE_KIND ||
		!Number.isSafeInteger(ref.byteLength) ||
		ref.byteLength < 0 ||
		ref.byteLength > MAX_EVIDENCE_ARTIFACT_BYTES
	) {
		throw new InvalidEvidenceArtifactReferenceError(
			"Flow evidence artifact reference metadata is invalid.",
		);
	}
	const match = SHA256_DIGEST_PATTERN.exec(ref.digest);
	if (!match?.[1]) {
		throw new InvalidEvidenceArtifactReferenceError(
			"Flow evidence artifact digest must be lowercase SHA-256.",
		);
	}
	return match[1];
}

function artifactIdentity(info: Stats): string {
	// Do not include ctime: publishing uses a hard link, and removing the
	// publisher's temporary link can change ctime while another publisher safely
	// verifies the immutable target. Content changes still alter mtime and are
	// independently caught by the digest check.
	return `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeMs}`;
}

function directoryIdentity(info: Stats): string {
	return `${info.dev}:${info.ino}:${info.mode}`;
}

function assertRestrictedMode(
	mode: number,
	path: string,
	description: string,
): void {
	if (process.platform !== "win32" && (mode & 0o077) !== 0) {
		throw new UnsafeFlowWorkspaceLayoutError(
			`Flow requires ${description} to be owner-only: ${path}.`,
		);
	}
}

async function restrictedDirectoryState(
	path: string,
	description: string,
): Promise<PathState> {
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
		assertRestrictedMode(info.mode, path, description);
		return "present";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
}

function artifactRoot(root: string): string {
	return join(flowDir(root), "evidence", "v1", "sha256");
}

function artifactPath(root: string, hex: string): string {
	return join(artifactRoot(root), hex.slice(0, 2), hex.slice(2));
}

async function ensureArtifactShard(root: string, hex: string): Promise<string> {
	await ensureFlowGitignore(root);
	const evidence = join(flowDir(root), "evidence");
	const version = join(evidence, "v1");
	const algorithm = join(version, "sha256");
	const shard = join(algorithm, hex.slice(0, 2));
	const directories = [
		[evidence, "the Flow evidence directory"],
		[version, "the Flow evidence format directory"],
		[algorithm, "the Flow evidence digest directory"],
		[shard, "the Flow evidence shard directory"],
	] as const;
	for (const [path, description] of directories) {
		if ((await restrictedDirectoryState(path, description)) === "missing") {
			await ensurePinnedManagedDirectory(path, description);
		}
		if ((await restrictedDirectoryState(path, description)) !== "present") {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow could not create ${description}: ${path}.`,
			);
		}
	}
	return shard;
}

async function openArtifactDirectory(
	path: string,
	description: string,
	restricted: boolean,
	ref: EvidenceArtifactRef,
): Promise<EvidenceDirectoryGuard> {
	let pathInfo: Stats;
	try {
		pathInfo = await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new EvidenceArtifactNotFoundError(
				`Flow evidence artifact is missing: ${ref.digest}.`,
				{ cause: error },
			);
		}
		throw error;
	}
	if (pathInfo.isSymbolicLink()) {
		throw new UnsafeFlowWorkspaceLayoutError(
			`Flow refuses to use a symbolic link as ${description}: ${path}.`,
		);
	}
	if (!pathInfo.isDirectory()) {
		throw new UnsafeFlowWorkspaceLayoutError(
			`Flow requires ${description} to be a directory: ${path}.`,
		);
	}
	if (restricted) assertRestrictedMode(pathInfo.mode, path, description);
	if (process.platform === "win32") {
		// Directory handles are not portable in Node on Windows. Path identity is
		// still rechecked after the read; POSIX additionally pins each directory.
		return {
			path,
			description,
			restricted,
			handle: null,
			info: pathInfo,
		};
	}

	const directoryFlags =
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
	let handle: FileHandle;
	try {
		handle = await open(path, directoryFlags);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ELOOP" || code === "ENOTDIR") {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses an unsafe ${description}: ${path}.`,
				{ cause: error },
			);
		}
		if (code === "ENOENT") {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact directory changed while it was opened: ${ref.digest}.`,
				{ cause: error },
			);
		}
		throw error;
	}

	try {
		const info = await handle.stat();
		if (
			!info.isDirectory() ||
			directoryIdentity(info) !== directoryIdentity(pathInfo)
		) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact directory changed while it was opened: ${ref.digest}.`,
			);
		}
		if (restricted) assertRestrictedMode(info.mode, path, description);
		return { path, description, restricted, handle, info };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function validateArtifactDirectories(
	guards: readonly EvidenceDirectoryGuard[],
	ref: EvidenceArtifactRef,
): Promise<void> {
	for (let index = guards.length - 1; index >= 0; index -= 1) {
		const guard = guards[index];
		if (!guard) continue;
		let openedInfo: Stats;
		let pathInfo: Stats;
		try {
			[openedInfo, pathInfo] = await Promise.all([
				guard.handle ? guard.handle.stat() : Promise.resolve(guard.info),
				lstat(guard.path),
			]);
		} catch (error) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact directory changed while it was read: ${ref.digest}.`,
				{ cause: error },
			);
		}
		if (pathInfo.isSymbolicLink() || !pathInfo.isDirectory()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires ${guard.description} to remain a real directory: ${guard.path}.`,
			);
		}
		if (guard.restricted) {
			assertRestrictedMode(pathInfo.mode, guard.path, guard.description);
			assertRestrictedMode(openedInfo.mode, guard.path, guard.description);
		}
		if (
			!openedInfo.isDirectory() ||
			directoryIdentity(openedInfo) !== directoryIdentity(guard.info) ||
			directoryIdentity(pathInfo) !== directoryIdentity(guard.info)
		) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact directory changed while it was read: ${ref.digest}.`,
			);
		}
	}
}

async function closeArtifactDirectories(
	guards: readonly EvidenceDirectoryGuard[],
): Promise<void> {
	for (let index = guards.length - 1; index >= 0; index -= 1) {
		await guards[index]?.handle?.close();
	}
}

async function requireArtifactShard(
	root: string,
	hex: string,
	ref: EvidenceArtifactRef,
): Promise<GuardedArtifactShard> {
	const flow = flowDir(root);
	const directories = [
		[root, "the workspace root", false],
		[flow, "the Flow state directory", false],
		[join(flow, "evidence"), "the Flow evidence directory", true],
		[join(flow, "evidence", "v1"), "the Flow evidence format directory", true],
		[
			join(flow, "evidence", "v1", "sha256"),
			"the Flow evidence digest directory",
			true,
		],
		[
			join(flow, "evidence", "v1", "sha256", hex.slice(0, 2)),
			"the Flow evidence shard directory",
			true,
		],
	] as const;
	const guards: EvidenceDirectoryGuard[] = [];
	try {
		for (const [path, description, restricted] of directories) {
			guards.push(
				await openArtifactDirectory(path, description, restricted, ref),
			);
		}
		return {
			path: join(flow, "evidence", "v1", "sha256", hex.slice(0, 2)),
			guards,
		};
	} catch (error) {
		await closeArtifactDirectories(guards);
		throw error;
	}
}

async function openArtifact(
	path: string,
	ref: EvidenceArtifactRef,
): Promise<OpenArtifact> {
	let pathInfo: Stats;
	try {
		pathInfo = await lstat(path);
		if (pathInfo.isSymbolicLink()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to follow a symbolic link as an evidence artifact: ${path}.`,
			);
		}
		if (!pathInfo.isFile()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires an evidence artifact to be a regular file: ${path}.`,
			);
		}
		assertRestrictedMode(pathInfo.mode, path, "an evidence artifact");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new EvidenceArtifactNotFoundError(
				`Flow evidence artifact is missing: ${ref.digest}.`,
				{ cause: error },
			);
		}
		throw error;
	}

	const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
	let handle: FileHandle;
	try {
		handle = await open(path, constants.O_RDONLY | noFollow);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOOP") {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to follow a symbolic link as an evidence artifact: ${path}.`,
				{ cause: error },
			);
		}
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new EvidenceArtifactNotFoundError(
				`Flow evidence artifact is missing: ${ref.digest}.`,
				{ cause: error },
			);
		}
		throw error;
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires an evidence artifact to be a regular file: ${path}.`,
			);
		}
		assertRestrictedMode(info.mode, path, "an evidence artifact");
		if (artifactIdentity(info) !== artifactIdentity(pathInfo)) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact changed while it was opened: ${ref.digest}.`,
			);
		}
		return { handle, info };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function readArtifactAtPath(
	path: string,
	ref: EvidenceArtifactRef,
): Promise<Buffer> {
	const { handle, info } = await openArtifact(path, ref);
	try {
		if (info.size > MAX_EVIDENCE_ARTIFACT_BYTES) {
			throw new EvidenceArtifactTooLargeError(
				`Flow evidence artifact exceeds ${MAX_EVIDENCE_ARTIFACT_BYTES} bytes: ${ref.digest}.`,
			);
		}
		if (info.size !== ref.byteLength) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact byte length does not match its reference: ${ref.digest}.`,
			);
		}
		const bytes = Buffer.allocUnsafe(info.size);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const { bytesRead } = await handle.read(
				bytes,
				offset,
				bytes.byteLength - offset,
				offset,
			);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}

		const finalInfo = await handle.stat();
		if (finalInfo.size > MAX_EVIDENCE_ARTIFACT_BYTES) {
			throw new EvidenceArtifactTooLargeError(
				`Flow evidence artifact exceeds ${MAX_EVIDENCE_ARTIFACT_BYTES} bytes: ${ref.digest}.`,
			);
		}
		let finalPathInfo: Stats;
		try {
			finalPathInfo = await lstat(path);
		} catch (error) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact changed while it was read: ${ref.digest}.`,
				{ cause: error },
			);
		}
		if (finalPathInfo.isSymbolicLink() || !finalPathInfo.isFile()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires an evidence artifact to remain a regular file: ${path}.`,
			);
		}
		assertRestrictedMode(finalPathInfo.mode, path, "an evidence artifact");
		if (
			offset !== bytes.byteLength ||
			artifactIdentity(finalInfo) !== artifactIdentity(info) ||
			artifactIdentity(finalPathInfo) !== artifactIdentity(info)
		) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact changed while it was read: ${ref.digest}.`,
			);
		}
		if (`sha256:${sha256(bytes)}` !== ref.digest) {
			throw new EvidenceArtifactIntegrityError(
				`Flow evidence artifact digest verification failed: ${ref.digest}.`,
			);
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

export function evidenceArtifactDirectory(workspace: string): string {
	const root = assertMutableWorkspaceRoot(workspace);
	return artifactRoot(root);
}

export function evidenceArtifactPath(
	workspace: string,
	ref: EvidenceArtifactRef,
): string {
	const root = assertMutableWorkspaceRoot(workspace);
	return artifactPath(root, digestHex(ref));
}

export function evidenceArtifactRefForBytes(
	bytes: Uint8Array,
): EvidenceArtifactRef {
	const copied = Buffer.from(bytes);
	if (copied.byteLength > MAX_EVIDENCE_ARTIFACT_BYTES) {
		throw new EvidenceArtifactTooLargeError(
			`Flow evidence artifacts are limited to ${MAX_EVIDENCE_ARTIFACT_BYTES} bytes.`,
		);
	}
	return referenceFor(copied);
}

export function createFileEvidenceArtifactStore(
	workspace: string,
): EvidenceArtifactStore {
	const root = assertMutableWorkspaceRoot(workspace);
	return {
		publishEvidenceArtifact: async (input) => {
			const bytes = Buffer.from(input);
			if (bytes.byteLength > MAX_EVIDENCE_ARTIFACT_BYTES) {
				throw new EvidenceArtifactTooLargeError(
					`Flow evidence artifacts are limited to ${MAX_EVIDENCE_ARTIFACT_BYTES} bytes.`,
				);
			}
			const ref = referenceFor(bytes);
			const hex = digestHex(ref);
			const shard = await ensureArtifactShard(root, hex);
			const publication = await publishPinnedManagedFile(
				shard,
				hex.slice(2),
				`.publish-${process.pid}-${randomUUID()}.tmp`,
				bytes,
				MAX_EVIDENCE_ARTIFACT_BYTES,
			);
			if (
				publication.status === "existsTooLarge" ||
				(publication.status === "exists" && !publication.contents.equals(bytes))
			) {
				throw new EvidenceArtifactCollisionError(
					`Flow evidence artifact target exists with different contents: ${ref.digest}.`,
				);
			}
			return ref;
		},
		readEvidenceArtifact: async (ref) => {
			const hex = digestHex(ref);
			const shard = await requireArtifactShard(root, hex, ref);
			try {
				const bytes = await readArtifactAtPath(
					join(shard.path, hex.slice(2)),
					ref,
				);
				await validateArtifactDirectories(shard.guards, ref);
				return Uint8Array.from(bytes);
			} finally {
				await closeArtifactDirectories(shard.guards);
			}
		},
	};
}
