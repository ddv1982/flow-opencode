import {
	MAX_VALIDATION_RECEIPT_BYTES,
	parseValidationReceipt,
	parseValidationReceiptRef,
	VALIDATION_RECEIPT_REF_KIND,
	type ValidationReceiptRef,
	type ValidationReceiptV1,
} from "../domain/validation-receipt.js";
import type {
	EvidenceArtifactRef,
	EvidenceArtifactStore,
} from "./ports/evidence-artifact-store.js";
import {
	type CanonicalJsonValue,
	canonicalizeReplayJson,
} from "./replay/canonical-json.js";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class InvalidValidationReceiptError extends Error {
	readonly code = "FLOW_VALIDATION_RECEIPT_INVALID";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "InvalidValidationReceiptError";
	}
}

export class ValidationReceiptIntegrityError extends Error {
	readonly code = "FLOW_VALIDATION_RECEIPT_INTEGRITY";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ValidationReceiptIntegrityError";
	}
}

export class ValidationReceiptTooLargeError extends Error {
	readonly code = "FLOW_VALIDATION_RECEIPT_TOO_LARGE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ValidationReceiptTooLargeError";
	}
}

export interface ValidationReceiptStore {
	publishValidationReceipt(
		receipt: ValidationReceiptV1,
	): Promise<ValidationReceiptRef>;
	readValidationReceipt(
		ref: ValidationReceiptRef,
	): Promise<ValidationReceiptV1>;
}

function receiptJson(receipt: ValidationReceiptV1): CanonicalJsonValue {
	return {
		schemaVersion: receipt.schemaVersion,
		kind: receipt.kind,
		featureRunId: receipt.featureRunId,
		featureId: receipt.featureId,
		sourceDigest: receipt.sourceDigest,
		startedAt: receipt.startedAt,
		completedAt: receipt.completedAt,
		command: receipt.command,
		commandDigest: receipt.commandDigest,
		commandClass: receipt.commandClass,
		coverageScope: receipt.coverageScope,
		exitCode: receipt.exitCode,
		outputDigest: receipt.outputDigest,
		outputCompleteness: receipt.outputCompleteness,
		environmentKeys: receipt.environmentKeys,
		...(receipt.exactOutputArtifactRef
			? {
					exactOutputArtifactRef: {
						kind: receipt.exactOutputArtifactRef.kind,
						digest: receipt.exactOutputArtifactRef.digest,
						byteLength: receipt.exactOutputArtifactRef.byteLength,
					},
				}
			: {}),
	};
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function receiptArtifactRef(ref: ValidationReceiptRef): EvidenceArtifactRef {
	return {
		kind: "restricted_evidence_v1",
		digest: ref.digest,
		byteLength: ref.byteLength,
	};
}

function publicReceiptRef(ref: EvidenceArtifactRef): ValidationReceiptRef {
	try {
		return parseValidationReceiptRef({
			kind: VALIDATION_RECEIPT_REF_KIND,
			digest: ref.digest,
			byteLength: ref.byteLength,
		});
	} catch (error) {
		throw new ValidationReceiptIntegrityError(
			"The evidence store returned invalid validation receipt metadata.",
			{ cause: error },
		);
	}
}

export function canonicalValidationReceiptBytes(
	receiptValue: ValidationReceiptV1,
): Uint8Array {
	let receipt: ValidationReceiptV1;
	try {
		receipt = parseValidationReceipt(receiptValue);
	} catch (error) {
		throw new InvalidValidationReceiptError(
			"Validation receipt metadata is invalid.",
			{ cause: error },
		);
	}
	const bytes = utf8Encoder.encode(
		canonicalizeReplayJson(receiptJson(receipt)),
	);
	if (bytes.byteLength > MAX_VALIDATION_RECEIPT_BYTES) {
		throw new ValidationReceiptTooLargeError(
			`Canonical validation receipts cannot exceed ${MAX_VALIDATION_RECEIPT_BYTES} bytes.`,
		);
	}
	return bytes;
}

export function parseCanonicalValidationReceiptBytes(
	bytes: Uint8Array,
): ValidationReceiptV1 {
	if (bytes.byteLength > MAX_VALIDATION_RECEIPT_BYTES) {
		throw new ValidationReceiptTooLargeError(
			`Canonical validation receipts cannot exceed ${MAX_VALIDATION_RECEIPT_BYTES} bytes.`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(utf8Decoder.decode(bytes));
	} catch (error) {
		throw new InvalidValidationReceiptError(
			"Validation receipt bytes must contain valid UTF-8 JSON.",
			{ cause: error },
		);
	}

	let receipt: ValidationReceiptV1;
	try {
		receipt = parseValidationReceipt(value);
	} catch (error) {
		throw new InvalidValidationReceiptError(
			"Validation receipt JSON does not match the v1 contract.",
			{ cause: error },
		);
	}
	const canonical = canonicalValidationReceiptBytes(receipt);
	if (!sameBytes(bytes, canonical)) {
		throw new ValidationReceiptIntegrityError(
			"Validation receipt bytes are not in canonical form.",
		);
	}
	return receipt;
}

async function verifyExactOutputArtifact(
	store: EvidenceArtifactStore,
	receipt: ValidationReceiptV1,
): Promise<void> {
	if (!receipt.exactOutputArtifactRef) return;
	try {
		await store.readEvidenceArtifact({ ...receipt.exactOutputArtifactRef });
	} catch (error) {
		throw new ValidationReceiptIntegrityError(
			"The exact validation output artifact is missing or failed verification.",
			{ cause: error },
		);
	}
}

/** Store canonical receipt bytes through the existing restricted artifact port. */
export function createValidationReceiptStore(
	artifacts: EvidenceArtifactStore,
): ValidationReceiptStore {
	return {
		publishValidationReceipt: async (receiptValue) => {
			let receipt: ValidationReceiptV1;
			try {
				receipt = parseValidationReceipt(receiptValue);
			} catch (error) {
				throw new InvalidValidationReceiptError(
					"Validation receipt metadata is invalid.",
					{ cause: error },
				);
			}
			await verifyExactOutputArtifact(artifacts, receipt);
			const bytes = canonicalValidationReceiptBytes(receipt);
			let artifactRef: EvidenceArtifactRef;
			try {
				artifactRef = await artifacts.publishEvidenceArtifact(bytes);
			} catch (error) {
				throw new ValidationReceiptIntegrityError(
					"The validation receipt artifact could not be published safely.",
					{ cause: error },
				);
			}
			if (artifactRef.byteLength !== bytes.byteLength) {
				throw new ValidationReceiptIntegrityError(
					"The evidence store returned the wrong validation receipt length.",
				);
			}
			return publicReceiptRef(artifactRef);
		},
		readValidationReceipt: async (refValue) => {
			let ref: ValidationReceiptRef;
			try {
				ref = parseValidationReceiptRef(refValue);
			} catch (error) {
				throw new InvalidValidationReceiptError(
					"Validation receipt reference metadata is invalid.",
					{ cause: error },
				);
			}
			let bytes: Uint8Array;
			try {
				bytes = await artifacts.readEvidenceArtifact(receiptArtifactRef(ref));
			} catch (error) {
				throw new ValidationReceiptIntegrityError(
					"The validation receipt artifact is missing or failed verification.",
					{ cause: error },
				);
			}
			if (bytes.byteLength !== ref.byteLength) {
				throw new ValidationReceiptIntegrityError(
					"The validation receipt length does not match its reference.",
				);
			}
			const receipt = parseCanonicalValidationReceiptBytes(bytes);
			await verifyExactOutputArtifact(artifacts, receipt);
			return receipt;
		},
	};
}
