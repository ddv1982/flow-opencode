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

export interface SourceIdentityProvider {
	/**
	 * Compute the canonical source digest for the workspace. Implementations
	 * must fail closed on unsafe symlinks, unreadable entries, resource limits,
	 * or a workspace mutation observed while the source is being measured.
	 */
	computeSourceIdentity(): Promise<SourceIdentity>;
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
