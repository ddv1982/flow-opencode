import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	type FileHandle,
	link,
	lstat,
	mkdir,
	open,
	rm,
} from "node:fs/promises";
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
	flowDir,
	UnsafeFlowWorkspaceLayoutError,
} from "./workspace.js";

const EVIDENCE_KIND = "restricted_evidence_v1";
const SHA256_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

type PathState = "missing" | "present";

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

async function ensureRestrictedDirectory(
	path: string,
	description: string,
): Promise<void> {
	if ((await restrictedDirectoryState(path, description)) === "present") return;
	try {
		await mkdir(path, { recursive: false, mode: DIRECTORY_MODE });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	if ((await restrictedDirectoryState(path, description)) !== "present") {
		throw new UnsafeFlowWorkspaceLayoutError(
			`Flow could not create ${description}: ${path}.`,
		);
	}
}

async function syncDirectory(path: string): Promise<void> {
	if (process.platform === "win32") return;
	let handle: FileHandle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOOP") {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to follow a symbolic link as an evidence directory: ${path}.`,
				{ cause: error },
			);
		}
		throw error;
	}
	try {
		const info = await handle.stat();
		if (!info.isDirectory()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires an evidence directory to remain a directory: ${path}.`,
			);
		}
		assertRestrictedMode(info.mode, path, "an evidence directory");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function openPublisherTemporary(
	shard: string,
): Promise<{ path: string; handle: FileHandle }> {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const path = join(shard, `.publish-${process.pid}-${randomUUID()}.tmp`);
		try {
			return { path, handle: await open(path, "wx", FILE_MODE) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	throw new Error("Flow could not allocate a unique evidence temporary file.");
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
	await ensureRestrictedDirectory(evidence, "the Flow evidence directory");
	await ensureRestrictedDirectory(
		version,
		"the Flow evidence format directory",
	);
	await ensureRestrictedDirectory(
		algorithm,
		"the Flow evidence digest directory",
	);
	await ensureRestrictedDirectory(shard, "the Flow evidence shard directory");
	return shard;
}

async function requireArtifactShard(
	root: string,
	hex: string,
	ref: EvidenceArtifactRef,
): Promise<string> {
	const flow = flowDir(root);
	try {
		const flowInfo = await lstat(flow);
		if (flowInfo.isSymbolicLink() || !flowInfo.isDirectory()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires the Flow state directory to be a real directory: ${flow}.`,
			);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new EvidenceArtifactNotFoundError(
				`Flow evidence artifact is missing: ${ref.digest}.`,
				{ cause: error },
			);
		}
		throw error;
	}

	const directories = [
		[join(flow, "evidence"), "the Flow evidence directory"],
		[join(flow, "evidence", "v1"), "the Flow evidence format directory"],
		[
			join(flow, "evidence", "v1", "sha256"),
			"the Flow evidence digest directory",
		],
		[
			join(flow, "evidence", "v1", "sha256", hex.slice(0, 2)),
			"the Flow evidence shard directory",
		],
	] as const;
	for (const [path, description] of directories) {
		if ((await restrictedDirectoryState(path, description)) === "missing") {
			throw new EvidenceArtifactNotFoundError(
				`Flow evidence artifact is missing: ${ref.digest}.`,
			);
		}
	}
	return join(flow, "evidence", "v1", "sha256", hex.slice(0, 2));
}

async function openArtifact(
	path: string,
	ref: EvidenceArtifactRef,
): Promise<FileHandle> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses to follow a symbolic link as an evidence artifact: ${path}.`,
			);
		}
		if (!info.isFile()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires an evidence artifact to be a regular file: ${path}.`,
			);
		}
		assertRestrictedMode(info.mode, path, "an evidence artifact");
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
	try {
		return await open(path, constants.O_RDONLY | noFollow);
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
}

async function readArtifactAtPath(
	path: string,
	ref: EvidenceArtifactRef,
): Promise<Buffer> {
	const handle = await openArtifact(path, ref);
	try {
		const info = await handle.stat();
		if (!info.isFile()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires an evidence artifact to be a regular file: ${path}.`,
			);
		}
		assertRestrictedMode(info.mode, path, "an evidence artifact");
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
		const bytes = await handle.readFile();
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
			const target = artifactPath(root, hex);
			const temporaryFile = await openPublisherTemporary(shard);
			const temporary = temporaryFile.path;
			let handle: FileHandle | null = temporaryFile.handle;
			try {
				await handle.writeFile(bytes);
				await handle.sync();
				await handle.close();
				handle = null;
				try {
					await link(temporary, target);
					await syncDirectory(shard);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					let existing: Buffer;
					try {
						existing = await readArtifactAtPath(target, ref);
					} catch (verificationError) {
						if (verificationError instanceof UnsafeFlowWorkspaceLayoutError) {
							throw verificationError;
						}
						throw new EvidenceArtifactCollisionError(
							`Flow evidence artifact target exists with different contents: ${ref.digest}.`,
							{ cause: verificationError },
						);
					}
					if (!existing.equals(bytes)) {
						throw new EvidenceArtifactCollisionError(
							`Flow evidence artifact target exists with different contents: ${ref.digest}.`,
						);
					}
					await syncDirectory(shard);
				}
				return ref;
			} finally {
				await handle?.close();
				await rm(temporary, { force: true });
				await syncDirectory(shard);
			}
		},
		readEvidenceArtifact: async (ref) => {
			const hex = digestHex(ref);
			await requireArtifactShard(root, hex, ref);
			const bytes = await readArtifactAtPath(artifactPath(root, hex), ref);
			return Uint8Array.from(bytes);
		},
	};
}
