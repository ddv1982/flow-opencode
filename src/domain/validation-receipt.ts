import { z } from "zod";
import { FEATURE_ID_PATTERN } from "./feature-id.js";
import { MAX_SESSION_ID_LENGTH } from "./limits.js";
import {
	type EvidenceArtifactRef,
	type EvidenceId,
	type FeatureId,
	type FeatureRunId,
	type SnapshotId,
	toFeatureId,
	type ValidationEvidence,
} from "./session.js";
import {
	canonicalValidationCommandDigest,
	MAX_EXECUTION_PROJECTION_BYTES,
} from "./transitions.js";
import {
	type ValidationCommandClass,
	validationCommandClass,
} from "./validation-command.js";

export const VALIDATION_RECEIPT_SCHEMA_VERSION = 1 as const;
export const VALIDATION_RECEIPT_KIND = "validation_receipt_v1" as const;
export const VALIDATION_RECEIPT_REF_KIND = "validation_receipt_ref_v1" as const;

export const MAX_VALIDATION_RECEIPT_BYTES = 32 * 1024;
export const MAX_VALIDATION_COMMAND_BYTES = MAX_EXECUTION_PROJECTION_BYTES;
export const MAX_VALIDATION_ENVIRONMENT_KEYS = 64;
export const MAX_VALIDATION_OUTPUT_ARTIFACT_BYTES = 8 * 1024 * 1024;

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PORTABLE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

type Sha256Digest = `sha256:${string}`;

export type ValidationCoverageScope = "focused" | "broad" | "artifact";
export type ValidationOutputCompleteness = "complete" | "truncated" | "unknown";

export type ValidationReceiptV1 = Readonly<{
	schemaVersion: typeof VALIDATION_RECEIPT_SCHEMA_VERSION;
	kind: typeof VALIDATION_RECEIPT_KIND;
	featureRunId: FeatureRunId;
	featureId: FeatureId;
	sourceDigest: Sha256Digest;
	startedAt: string;
	completedAt: string;
	command: string;
	commandDigest: Sha256Digest;
	commandClass: ValidationCommandClass;
	coverageScope: ValidationCoverageScope;
	exitCode: number;
	outputDigest: Sha256Digest;
	outputCompleteness: ValidationOutputCompleteness;
	environmentKeys: readonly string[];
	exactOutputArtifactRef?: Readonly<EvidenceArtifactRef> | undefined;
}>;

export type ValidationReceiptRef = Readonly<{
	kind: typeof VALIDATION_RECEIPT_REF_KIND;
	digest: Sha256Digest;
	byteLength: number;
}>;

export type ValidationEvidenceMaterializationBinding = Readonly<{
	evidenceId: EvidenceId;
	capturedAtRevision: number;
	capturedAtSnapshotId: SnapshotId;
	snapshotId: SnapshotId;
}>;

export class ValidationReceiptMaterializationError extends Error {
	readonly code = "FLOW_VALIDATION_RECEIPT_NOT_MATERIALIZABLE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ValidationReceiptMaterializationError";
	}
}

function utf8Length(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

const Sha256DigestSchema = z
	.string()
	.regex(SHA256_DIGEST_PATTERN, "Expected a lowercase SHA-256 digest.")
	.transform((value) => value as Sha256Digest);

const BoundedPortableIdSchema = z
	.string()
	.min(1)
	.max(MAX_SESSION_ID_LENGTH)
	.regex(PORTABLE_ID_PATTERN);

const FeatureIdSchema = z
	.string()
	.min(1)
	.max(MAX_SESSION_ID_LENGTH)
	.regex(FEATURE_ID_PATTERN)
	.transform(toFeatureId);

const TimestampSchema = z.string().datetime({ offset: true });

const CommandSchema = z
	.string()
	.min(1, "A validation command is required.")
	.superRefine((command, context) => {
		if (command !== command.trim()) {
			context.addIssue({
				code: "custom",
				message: "A validation command cannot have outer whitespace.",
			});
		}
		if (utf8Length(command) > MAX_VALIDATION_COMMAND_BYTES) {
			context.addIssue({
				code: "custom",
				message: `A validation command cannot exceed ${MAX_VALIDATION_COMMAND_BYTES} UTF-8 bytes.`,
			});
		}
	});

const ValidationCommandClassSchema = z.enum([
	"test",
	"typecheck",
	"lint",
	"build",
	"format",
	"smoke",
	"other",
]);

const EvidenceArtifactRefSchema = z
	.object({
		kind: z.literal("restricted_evidence_v1"),
		digest: Sha256DigestSchema,
		byteLength: z
			.number()
			.int()
			.safe()
			.nonnegative()
			.max(MAX_VALIDATION_OUTPUT_ARTIFACT_BYTES),
	})
	.strict();

const EnvironmentKeysSchema = z
	.array(z.string().regex(ENVIRONMENT_KEY_PATTERN))
	.max(MAX_VALIDATION_ENVIRONMENT_KEYS)
	.transform((keys) => [...new Set(keys)].sort());

const ParsedValidationReceiptV1Schema = z
	.object({
		schemaVersion: z.literal(VALIDATION_RECEIPT_SCHEMA_VERSION),
		kind: z.literal(VALIDATION_RECEIPT_KIND),
		featureRunId: BoundedPortableIdSchema,
		featureId: FeatureIdSchema,
		sourceDigest: Sha256DigestSchema,
		startedAt: TimestampSchema,
		completedAt: TimestampSchema,
		command: CommandSchema,
		commandDigest: Sha256DigestSchema,
		commandClass: ValidationCommandClassSchema,
		coverageScope: z.enum(["focused", "broad", "artifact"]),
		exitCode: z.number().int().safe(),
		outputDigest: Sha256DigestSchema,
		outputCompleteness: z.enum(["complete", "truncated", "unknown"]),
		environmentKeys: EnvironmentKeysSchema,
		exactOutputArtifactRef: EvidenceArtifactRefSchema.optional(),
	})
	.strict()
	.superRefine((receipt, context) => {
		if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
			context.addIssue({
				code: "custom",
				path: ["completedAt"],
				message: "completedAt must not precede startedAt.",
			});
		}
		if (
			receipt.commandDigest !==
			canonicalValidationCommandDigest(receipt.command)
		) {
			context.addIssue({
				code: "custom",
				path: ["commandDigest"],
				message: "commandDigest does not match the canonical command digest.",
			});
		}
		if (receipt.commandClass !== validationCommandClass(receipt.command)) {
			context.addIssue({
				code: "custom",
				path: ["commandClass"],
				message: "commandClass does not match the canonical command class.",
			});
		}
		if (receipt.outputCompleteness === "complete") {
			if (
				receipt.exactOutputArtifactRef &&
				receipt.exactOutputArtifactRef.digest !== receipt.outputDigest
			) {
				context.addIssue({
					code: "custom",
					path: ["exactOutputArtifactRef", "digest"],
					message:
						"The exact output artifact digest must match the host-visible output digest.",
				});
			}
		} else if (receipt.exactOutputArtifactRef) {
			context.addIssue({
				code: "custom",
				path: ["exactOutputArtifactRef"],
				message:
					"Truncated or unknown output cannot be represented as an exact output artifact.",
			});
		}
	});

export const ValidationReceiptV1Schema = ParsedValidationReceiptV1Schema;

export const ValidationReceiptRefSchema = z
	.object({
		kind: z.literal(VALIDATION_RECEIPT_REF_KIND),
		digest: Sha256DigestSchema,
		byteLength: z
			.number()
			.int()
			.safe()
			.positive()
			.max(MAX_VALIDATION_RECEIPT_BYTES),
	})
	.strict();

const ValidationEvidenceMaterializationBindingSchema = z
	.object({
		evidenceId: Sha256DigestSchema,
		capturedAtRevision: z.number().int().safe().nonnegative(),
		capturedAtSnapshotId: Sha256DigestSchema,
		snapshotId: Sha256DigestSchema,
	})
	.strict()
	.superRefine((binding, context) => {
		if (binding.snapshotId !== binding.capturedAtSnapshotId) {
			context.addIssue({
				code: "custom",
				path: ["snapshotId"],
				message: "snapshotId must equal capturedAtSnapshotId.",
			});
		}
	});

function immutableArtifactRef(
	ref: EvidenceArtifactRef,
): Readonly<EvidenceArtifactRef> {
	return Object.freeze({ ...ref });
}

/** Parse, normalize, and deeply freeze runtime-owned validation metadata. */
export function parseValidationReceipt(value: unknown): ValidationReceiptV1 {
	const parsed = ParsedValidationReceiptV1Schema.parse(value);
	return Object.freeze({
		...parsed,
		environmentKeys: Object.freeze([...parsed.environmentKeys]),
		...(parsed.exactOutputArtifactRef
			? {
					exactOutputArtifactRef: immutableArtifactRef(
						parsed.exactOutputArtifactRef,
					),
				}
			: {}),
	}) as ValidationReceiptV1;
}

export function parseValidationReceiptRef(
	value: unknown,
): ValidationReceiptRef {
	return Object.freeze({ ...ValidationReceiptRefSchema.parse(value) });
}

/**
 * Project a successful, complete runtime receipt into the existing Session v4
 * evidence shape. Assignment-owned causal identity is supplied separately so
 * a caller cannot replace the receipt's run, source, command, or timing fields.
 */
export function materializeValidationEvidence(
	receiptValue: ValidationReceiptV1,
	bindingValue: ValidationEvidenceMaterializationBinding,
): ValidationEvidence {
	const receipt = parseValidationReceipt(receiptValue);
	const binding =
		ValidationEvidenceMaterializationBindingSchema.parse(bindingValue);
	if (receipt.exitCode !== 0) {
		throw new ValidationReceiptMaterializationError(
			"Failed validation receipts cannot become review validation evidence.",
		);
	}
	if (receipt.outputCompleteness !== "complete") {
		throw new ValidationReceiptMaterializationError(
			"Only complete receipts can become review validation evidence.",
		);
	}

	return {
		kind: "validation",
		evidenceId: binding.evidenceId as EvidenceId,
		featureRunId: receipt.featureRunId,
		capturedAtRevision: binding.capturedAtRevision,
		capturedAtSnapshotId: binding.capturedAtSnapshotId as SnapshotId,
		snapshotId: binding.snapshotId as SnapshotId,
		sourceDigest: receipt.sourceDigest,
		commandDigest: receipt.commandDigest,
		commandClass: receipt.commandClass,
		startedAt: receipt.startedAt,
		completedAt: receipt.completedAt,
		exitCode: receipt.exitCode,
		outputDigest: receipt.outputDigest,
		...(receipt.exactOutputArtifactRef
			? { artifactRef: { ...receipt.exactOutputArtifactRef } }
			: {}),
		environmentKeys: [...receipt.environmentKeys],
	};
}
