import type { EvidenceArtifactRef } from "../../domain/session.js";

export const MAX_EVIDENCE_ARTIFACT_BYTES = 8 * 1024 * 1024;

export type { EvidenceArtifactRef } from "../../domain/session.js";

export interface EvidenceArtifactStore {
	publishEvidenceArtifact(bytes: Uint8Array): Promise<EvidenceArtifactRef>;
	readEvidenceArtifact(ref: EvidenceArtifactRef): Promise<Uint8Array>;
}

export class InvalidEvidenceArtifactReferenceError extends Error {
	readonly code = "FLOW_EVIDENCE_INVALID_REFERENCE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "InvalidEvidenceArtifactReferenceError";
	}
}

export class EvidenceArtifactNotFoundError extends Error {
	readonly code = "FLOW_EVIDENCE_NOT_FOUND";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvidenceArtifactNotFoundError";
	}
}

export class EvidenceArtifactIntegrityError extends Error {
	readonly code = "FLOW_EVIDENCE_INTEGRITY";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvidenceArtifactIntegrityError";
	}
}

export class EvidenceArtifactCollisionError extends Error {
	readonly code = "FLOW_EVIDENCE_COLLISION";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvidenceArtifactCollisionError";
	}
}

export class EvidenceArtifactTooLargeError extends Error {
	readonly code = "FLOW_EVIDENCE_TOO_LARGE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvidenceArtifactTooLargeError";
	}
}
