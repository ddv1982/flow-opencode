import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import {
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { isWithinWorkspaceRoot } from "../../runtime/application/workspace-boundaries";
import {
	FLOW_ATTACHMENT_MAX_BYTES,
	type FlowAttachmentMimeType,
	maxFlowAttachmentDataUrlPayloadLength,
	normalizeFlowAttachmentMime,
	policyForFlowAttachmentMime,
} from "./attachment-policy";
import type { FlowAttachmentRecord } from "./attachment-store";

export { FLOW_ATTACHMENT_MAX_BYTES };

export type FlowAttachmentsMaterializeInput = {
	attachments: readonly FlowAttachmentRecord[];
	destinationDirectory: string;
	workspaceRoot: string;
	abort?: AbortSignal | undefined;
};

export type FlowAttachmentMaterialized = {
	attachmentId: string;
	originalFilename?: string;
	mime: FlowAttachmentMimeType;
	path: string;
	bytes: number;
};

export type FlowAttachmentSkipped = {
	attachmentId?: string;
	originalFilename?: string;
	reason: string;
};

export type FlowAttachmentsMaterializeResult = {
	imported: FlowAttachmentMaterialized[];
	skipped: FlowAttachmentSkipped[];
};

export class FlowAttachmentMaterializationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FlowAttachmentMaterializationError";
	}
}

export class FlowAttachmentMaterializationAbortError extends Error {
	constructor(message = "Attachment materialization aborted.") {
		super(message);
		this.name = "AbortError";
	}
}

export function isFlowAttachmentAbortError(error: unknown): boolean {
	return (
		error instanceof FlowAttachmentMaterializationAbortError ||
		(error instanceof Error && error.name === "AbortError")
	);
}

export async function materializeFlowAttachments(
	input: FlowAttachmentsMaterializeInput,
): Promise<FlowAttachmentsMaterializeResult> {
	throwIfAborted(input.abort);
	const workspaceRoot = resolve(input.workspaceRoot);
	const realWorkspaceRoot = await realpath(workspaceRoot);
	const destinationDirectory = resolveDestinationDirectory(
		realWorkspaceRoot,
		input.destinationDirectory,
	);
	await validateExistingDestinationAncestry(
		realWorkspaceRoot,
		destinationDirectory,
	);
	await mkdir(destinationDirectory, { recursive: true });
	const realDestinationDirectory = await realpath(destinationDirectory);
	if (realDestinationDirectory !== destinationDirectory) {
		throw new FlowAttachmentMaterializationError(
			"Attachment destination must not resolve through a symlink.",
		);
	}
	assertWorkspaceAssetPath(realWorkspaceRoot, realDestinationDirectory);

	const imported: FlowAttachmentMaterialized[] = [];
	const skipped: FlowAttachmentSkipped[] = [];

	for (const attachment of input.attachments) {
		throwIfAborted(input.abort);
		const skippedBase = {
			attachmentId: attachment.id,
			...(attachment.filename ? { originalFilename: attachment.filename } : {}),
		};
		try {
			const decoded = readAttachmentBytes(attachment);
			if (decoded.bytes.length > FLOW_ATTACHMENT_MAX_BYTES) {
				skipped.push({
					...skippedBase,
					reason: `Attachment exceeds ${FLOW_ATTACHMENT_MAX_BYTES} byte limit.`,
				});
				continue;
			}
			if (decoded.mime !== attachment.mime) {
				skipped.push({
					...skippedBase,
					reason: `Attachment content type '${decoded.mime}' does not match captured MIME '${attachment.mime}'.`,
				});
				continue;
			}
			if (
				!policyForFlowAttachmentMime(attachment.mime).matchesMagicBytes(
					decoded.bytes,
				)
			) {
				skipped.push({
					...skippedBase,
					reason: `Attachment bytes are not a valid ${attachment.mime} payload.`,
				});
				continue;
			}

			const filename = safeAttachmentFilename(attachment);
			const targetPath = await writeFileExclusivelyWithCollisionSuffix({
				directory: realDestinationDirectory,
				filename,
				bytes: decoded.bytes,
				workspaceRoot: realWorkspaceRoot,
				abort: input.abort,
			});
			imported.push({
				attachmentId: attachment.id,
				...(attachment.filename
					? { originalFilename: attachment.filename }
					: {}),
				mime: attachment.mime,
				path: workspaceRelativePath(realWorkspaceRoot, targetPath),
				bytes: decoded.bytes.length,
			});
		} catch (error) {
			if (input.abort?.aborted) {
				throw error;
			}
			skipped.push({
				...skippedBase,
				reason:
					error instanceof Error
						? error.message
						: "Attachment could not be materialized.",
			});
		}
	}

	return { imported, skipped };
}

export function resolveDestinationDirectory(
	workspaceRoot: string,
	destinationDirectory: string,
): string {
	const trimmed = destinationDirectory.trim();
	if (!trimmed) {
		throw new FlowAttachmentMaterializationError(
			"destinationDirectory must not be empty.",
		);
	}
	assertNoGlobMetacharacters(trimmed);
	const resolved = isAbsolute(trimmed)
		? resolve(trimmed)
		: resolve(workspaceRoot, trimmed);
	assertWorkspaceAssetPath(workspaceRoot, resolved);
	return resolved;
}

export function safeAttachmentFilename(
	attachment: Pick<FlowAttachmentRecord, "id" | "filename" | "mime">,
): string {
	const original = attachment.filename
		? lastPathSegment(attachment.filename)
		: `attachment-${shortStableId(attachment.id)}`;
	const extension = policyForFlowAttachmentMime(
		attachment.mime,
	).canonicalExtension;
	const originalExtension = extname(original);
	const withoutExtension = original.slice(
		0,
		Math.max(0, original.length - originalExtension.length),
	);
	const base = slugFilenameBase(
		withoutExtension || `attachment-${shortStableId(attachment.id)}`,
	);
	return `${base}${extension}`;
}

function readAttachmentBytes(attachment: FlowAttachmentRecord): {
	bytes: Uint8Array;
	mime: FlowAttachmentMimeType;
} {
	if (!attachment.url.toLowerCase().startsWith("data:")) {
		throw new FlowAttachmentMaterializationError(
			"Unsupported attachment URL protocol; only data: URLs are materialized.",
		);
	}
	return decodeDataUrl(attachment.url, attachment.mime);
}

function decodeDataUrl(
	url: string,
	fallbackMime: FlowAttachmentMimeType,
): { bytes: Uint8Array; mime: FlowAttachmentMimeType } {
	const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(url);
	if (!match) {
		throw new FlowAttachmentMaterializationError(
			"Invalid data URL attachment.",
		);
	}
	const mime = normalizeFlowAttachmentMime(match[1] || fallbackMime);
	if (!mime) {
		throw new FlowAttachmentMaterializationError(
			`Unsupported data URL MIME '${match[1] ?? ""}'.`,
		);
	}
	const flags = match[2] ?? "";
	const payload = match[3] ?? "";
	const isBase64 = flags.split(";").includes("base64");
	assertDataUrlPayloadWithinLimit(payload, isBase64);
	const bytes = isBase64
		? Buffer.from(payload, "base64")
		: Buffer.from(decodeURIComponent(payload), "utf8");
	return { bytes: new Uint8Array(bytes), mime };
}

function assertDataUrlPayloadWithinLimit(
	payload: string,
	isBase64: boolean,
): void {
	const maxEncodedLength = maxFlowAttachmentDataUrlPayloadLength(isBase64);
	if (payload.length > maxEncodedLength) {
		throw new FlowAttachmentMaterializationError(
			`Attachment exceeds ${FLOW_ATTACHMENT_MAX_BYTES} byte limit.`,
		);
	}
}

function assertNoGlobMetacharacters(value: string): void {
	if (/[*?[\]{}]/.test(value)) {
		throw new FlowAttachmentMaterializationError(
			"destinationDirectory must not contain glob metacharacters (*, ?, [, ], {, or }).",
		);
	}
}

function assertWorkspaceAssetPath(
	workspaceRoot: string,
	candidate: string,
): void {
	const resolvedRoot = resolve(workspaceRoot);
	const resolvedCandidate = resolve(candidate);
	if (!isWithinWorkspaceRoot(resolvedRoot, resolvedCandidate)) {
		throw new FlowAttachmentMaterializationError(
			"Attachment destination must stay inside the active workspace.",
		);
	}
	const rel = relative(resolvedRoot, resolvedCandidate);
	const first = rel.split(sep)[0];
	if (first?.toLowerCase() === ".flow") {
		throw new FlowAttachmentMaterializationError(
			"Attachment destination must not be inside .flow.",
		);
	}
}

async function validateExistingDestinationAncestry(
	workspaceRoot: string,
	destinationDirectory: string,
): Promise<void> {
	assertWorkspaceAssetPath(workspaceRoot, destinationDirectory);
	const relativeDestination = relative(workspaceRoot, destinationDirectory);
	const segments = relativeDestination.split(sep).filter(Boolean);
	let current = workspaceRoot;
	for (const segment of segments) {
		current = join(current, segment);
		let stats: Awaited<ReturnType<typeof lstat>>;
		try {
			stats = await lstat(current);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return;
			}
			throw error;
		}
		if (stats.isSymbolicLink()) {
			throw new FlowAttachmentMaterializationError(
				"Attachment destination must not include symlink ancestors.",
			);
		}
		const realCurrent = await realpath(current);
		assertWorkspaceAssetPath(workspaceRoot, realCurrent);
	}
}

async function writeFileExclusivelyWithCollisionSuffix(input: {
	directory: string;
	filename: string;
	bytes: Uint8Array;
	workspaceRoot: string;
	abort?: AbortSignal | undefined;
}): Promise<string> {
	const extension = extname(input.filename);
	const base = input.filename.slice(
		0,
		Math.max(0, input.filename.length - extension.length),
	);
	for (let index = 1; index < 1000; index += 1) {
		throwIfAborted(input.abort);
		const candidate = join(
			input.directory,
			index === 1 ? input.filename : `${base}-${index}${extension}`,
		);
		assertWorkspaceAssetPath(input.workspaceRoot, candidate);
		await assertStableWritableDirectory(input.workspaceRoot, input.directory);
		try {
			await writeFileExclusively(candidate, input.bytes, input.workspaceRoot);
			return candidate;
		} catch (error) {
			if (isNodeError(error) && error.code === "EEXIST") {
				continue;
			}
			throw error;
		}
	}
	throw new FlowAttachmentMaterializationError(
		"Could not choose a collision-free attachment filename.",
	);
}

async function assertStableWritableDirectory(
	workspaceRoot: string,
	directory: string,
): Promise<void> {
	// Node/Bun do not expose openat-style parent-directory file descriptors for
	// path-relative exclusive creates. Re-validating ancestry immediately before
	// every O_EXCL|O_NOFOLLOW write and checking the created file's real path is
	// the strongest portable mitigation here; a local actor with write access to
	// the same tree can still race parent replacement between those syscalls.
	await validateExistingDestinationAncestry(workspaceRoot, directory);
	const realDirectory = await realpath(directory);
	if (realDirectory !== directory) {
		throw new FlowAttachmentMaterializationError(
			"Attachment destination must not resolve through a symlink.",
		);
	}
	assertWorkspaceAssetPath(workspaceRoot, realDirectory);
}

async function writeFileExclusively(
	path: string,
	bytes: Uint8Array,
	workspaceRoot: string,
): Promise<void> {
	const flags =
		constants.O_CREAT |
		constants.O_EXCL |
		constants.O_WRONLY |
		(constants.O_NOFOLLOW ?? 0);
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(path, flags, 0o666);
		const realTarget = await realpath(path);
		assertWorkspaceAssetPath(workspaceRoot, realTarget);
		if (dirname(realTarget) !== dirname(path)) {
			throw new FlowAttachmentMaterializationError(
				"Attachment destination changed before the file write.",
			);
		}
		await handle.writeFile(bytes);
	} catch (error) {
		await handle?.close().catch(() => undefined);
		// Do not perform path-based cleanup after a post-open failure. A local
		// actor can replace the path between any safety proof and unlink; leaking a
		// partial/orphaned file is safer than deleting a swapped target.
		throw error;
	}
	await handle.close();
}

function slugFilenameBase(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\\/]+/g, "-")
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[.-]+/, "")
		.replace(/[.-]+$/, "")
		.replace(/-+/g, "-")
		.slice(0, 80);
	return normalized || "attachment";
}

function lastPathSegment(value: string): string {
	return (
		value
			.split(/[\\/]+/)
			.filter(Boolean)
			.at(-1) ?? "attachment"
	);
}

function shortStableId(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function workspaceRelativePath(
	workspaceRoot: string,
	targetPath: string,
): string {
	return relative(workspaceRoot, targetPath).split(sep).join("/");
}

function throwIfAborted(abort: AbortSignal | undefined): void {
	if (abort?.aborted) {
		if (abort.reason instanceof Error) {
			throw abort.reason;
		}
		throw new FlowAttachmentMaterializationAbortError();
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
