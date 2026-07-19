/**
 * Application port for the authoritative source/worktree identity boundary.
 *
 * The provider derives a canonical, deterministic digest of the workspace
 * source state (the "A1 canonical source digest"). It is the single trusted
 * producer of source identity used by the transactional completion boundary.
 * Callers never assert source identity; Flow recomputes it and binds evidence
 * to it. The source-v2 manifest is materialization-sensitive:
 * an indexed sparse-checkout path absent from disk is distinct from the same
 * path materialized in a dense worktree.
 */

export type SourceDigest = `sha256:${string}`;

export type SourceIdentity = {
	/** Canonical lowercase SHA-256 digest of the source state. */
	readonly digest: SourceDigest;
	/** Whether the digest was derived from a Git manifest or a full-tree walk. */
	readonly mode: "git" | "non-git";
	/** Number of source entries that contributed to the digest. */
	readonly entryCount: number;
};

/**
 * A content-safe, path-addressable view of one measured source state.
 *
 * The manifest deliberately contains no file contents, symlink targets, Git
 * object ids, or absolute paths. `contentIdentity` is a digest of the complete
 * per-path source identity that contributed to `sourceDigest`.
 */
export type SourceManifestEntry = {
	readonly path: string;
	readonly type: "file" | "symlink" | "gitlink" | "index-only" | "deleted";
	readonly contentIdentity: SourceDigest;
};

export type SourceManifest = {
	readonly version: 1;
	readonly sourceDigest: SourceDigest;
	readonly mode: SourceIdentity["mode"];
	/** Digest of repository-wide identity (for example HEAD), when applicable. */
	readonly repositoryIdentity: SourceDigest | null;
	readonly entries: readonly SourceManifestEntry[];
};

export type SourceManifestSnapshot = {
	readonly identity: SourceIdentity;
	/** Canonical UTF-8 JSON bytes suitable for the restricted artifact store. */
	readonly bytes: Uint8Array;
	readonly manifest: SourceManifest;
};

const SOURCE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_SOURCE_MANIFEST_PATH_BYTES = 4_096;

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(",")}}`;
}

export function isSafeSourceManifestPath(path: string): boolean {
	if (
		path.length === 0 ||
		path.includes("\\") ||
		path.includes("\u0000") ||
		path.startsWith("/") ||
		/^[A-Za-z]:/.test(path) ||
		new TextEncoder().encode(path).byteLength > MAX_SOURCE_MANIFEST_PATH_BYTES
	) {
		return false;
	}
	const segments = path.split("/");
	return segments.every(
		(segment) => segment.length > 0 && segment !== "." && segment !== "..",
	);
}

export function canonicalSourceManifestBytes(
	manifest: SourceManifest,
): Uint8Array {
	return new TextEncoder().encode(canonicalJson(manifest));
}

/**
 * Decode only the exact canonical format emitted by Flow. Canonical byte
 * equality rejects unknown fields, duplicate-key spellings, and partial or
 * reordered manifests instead of trying to repair them.
 */
export function parseCanonicalSourceManifest(
	bytes: Uint8Array,
): SourceManifest {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new SourceManifestIntegrityError(
			"The persisted source manifest is not canonical UTF-8 JSON.",
			{ cause: error },
		);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new SourceManifestIntegrityError(
			"The persisted source manifest has an invalid root.",
		);
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).sort().join("\u0000") !==
			["entries", "mode", "repositoryIdentity", "sourceDigest", "version"]
				.sort()
				.join("\u0000") ||
		record.version !== 1 ||
		(record.mode !== "git" && record.mode !== "non-git") ||
		typeof record.sourceDigest !== "string" ||
		!SOURCE_DIGEST_PATTERN.test(record.sourceDigest) ||
		(record.repositoryIdentity !== null &&
			(typeof record.repositoryIdentity !== "string" ||
				!SOURCE_DIGEST_PATTERN.test(record.repositoryIdentity))) ||
		!Array.isArray(record.entries)
	) {
		throw new SourceManifestIntegrityError(
			"The persisted source manifest has invalid metadata.",
		);
	}
	const entries: SourceManifestEntry[] = [];
	let priorPath: string | null = null;
	for (const rawEntry of record.entries) {
		if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
			throw new SourceManifestIntegrityError(
				"The persisted source manifest contains an invalid entry.",
			);
		}
		const entry = rawEntry as Record<string, unknown>;
		if (
			Object.keys(entry).sort().join("\u0000") !==
				["contentIdentity", "path", "type"].sort().join("\u0000") ||
			typeof entry.path !== "string" ||
			!isSafeSourceManifestPath(entry.path) ||
			!(
				["file", "symlink", "gitlink", "index-only", "deleted"] as const
			).includes(entry.type as never) ||
			typeof entry.contentIdentity !== "string" ||
			!SOURCE_DIGEST_PATTERN.test(entry.contentIdentity)
		) {
			throw new SourceManifestIntegrityError(
				"The persisted source manifest contains unsafe or invalid path identity.",
			);
		}
		if (
			priorPath !== null &&
			Buffer.compare(
				Buffer.from(priorPath, "utf8"),
				Buffer.from(entry.path, "utf8"),
			) >= 0
		) {
			throw new SourceManifestIntegrityError(
				"The persisted source manifest paths are not uniquely ordered.",
			);
		}
		priorPath = entry.path;
		entries.push({
			path: entry.path,
			type: entry.type as SourceManifestEntry["type"],
			contentIdentity: entry.contentIdentity as SourceDigest,
		});
	}
	const manifest: SourceManifest = {
		version: 1,
		sourceDigest: record.sourceDigest as SourceDigest,
		mode: record.mode,
		repositoryIdentity: record.repositoryIdentity as SourceDigest | null,
		entries,
	};
	if (
		!Buffer.from(canonicalSourceManifestBytes(manifest)).equals(
			Buffer.from(bytes),
		)
	) {
		throw new SourceManifestIntegrityError(
			"The persisted source manifest is not in canonical byte form.",
		);
	}
	return manifest;
}

export interface SourceIdentityProvider {
	/**
	 * Compute the canonical source digest for the workspace. Implementations
	 * must fail closed on unsafe symlinks, unreadable entries, resource limits,
	 * or a workspace mutation observed while the source is being measured.
	 */
	computeSourceIdentity(): Promise<SourceIdentity>;

	/**
	 * Compute source identity and its separately requested safe manifest in one
	 * race-checked measurement. Callers that only need identity should continue
	 * to use `computeSourceIdentity()` so path metadata is not materialized.
	 */
	computeSourceManifest?(): Promise<SourceManifestSnapshot>;
}

/**
 * Base class for source-identity failures. The message never carries absolute
 * paths, file contents, or command output; only a bounded, safe reason.
 */
export class SourceIdentityError extends Error {
	readonly code: string = "FLOW_SOURCE_IDENTITY";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SourceIdentityError";
	}
}

/** A persisted source manifest was not canonical, complete, or path-safe. */
export class SourceManifestIntegrityError extends SourceIdentityError {
	override readonly code = "FLOW_SOURCE_MANIFEST_INTEGRITY";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SourceManifestIntegrityError";
	}
}

/** A symlink whose target escapes the workspace root or is absolute. */
export class SourceIdentityUnsafeSymlinkError extends SourceIdentityError {
	override readonly code = "FLOW_SOURCE_IDENTITY_UNSAFE_SYMLINK";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SourceIdentityUnsafeSymlinkError";
	}
}

/** An entry that could not be read; measurement never silently skips state. */
export class SourceIdentityUnreadableError extends SourceIdentityError {
	override readonly code = "FLOW_SOURCE_IDENTITY_UNREADABLE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SourceIdentityUnreadableError";
	}
}

/** The source exceeded the bounded file-count or byte budget. */
export class SourceIdentityOverflowError extends SourceIdentityError {
	override readonly code = "FLOW_SOURCE_IDENTITY_OVERFLOW";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SourceIdentityOverflowError";
	}
}

/** The workspace changed while it was being measured. */
export class SourceIdentityRaceError extends SourceIdentityError {
	override readonly code = "FLOW_SOURCE_IDENTITY_RACE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SourceIdentityRaceError";
	}
}

/** Git enumeration failed for a Git workspace. */
export class SourceIdentityGitError extends SourceIdentityError {
	override readonly code = "FLOW_SOURCE_IDENTITY_GIT";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SourceIdentityGitError";
	}
}
