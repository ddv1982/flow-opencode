import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	EvidenceArtifactRef,
	EvidenceArtifactStore,
} from "../src/application/ports/evidence-artifact-store.js";
import { MAX_EVIDENCE_ARTIFACT_BYTES } from "../src/application/ports/evidence-artifact-store.js";
import {
	canonicalValidationReceiptBytes,
	createValidationReceiptStore,
	InvalidValidationReceiptError,
	parseCanonicalValidationReceiptBytes,
	ValidationReceiptIntegrityError,
	ValidationReceiptTooLargeError,
} from "../src/application/validation-receipts.js";
import type { ValidationEvidence } from "../src/domain/session.js";
import { toFeatureId } from "../src/domain/session.js";
import { canonicalValidationCommandDigest } from "../src/domain/transitions.js";
import { validationCommandClass } from "../src/domain/validation-command.js";
import {
	MAX_VALIDATION_COMMAND_BYTES,
	MAX_VALIDATION_OUTPUT_ARTIFACT_BYTES,
	MAX_VALIDATION_RECEIPT_BYTES,
	materializeValidationEvidence,
	parseValidationReceipt,
	parseValidationReceiptRef,
	VALIDATION_RECEIPT_KIND,
	VALIDATION_RECEIPT_REF_KIND,
	ValidationReceiptMaterializationError,
	type ValidationReceiptRef,
	type ValidationReceiptV1,
} from "../src/domain/validation-receipt.js";
import { createFileEvidenceArtifactStore } from "../src/infrastructure/fs/evidence-artifact-store.js";

const utf8 = new TextEncoder();
const temporaryWorkspaces: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryWorkspaces
			.splice(0)
			.map((workspace) => rm(workspace, { recursive: true, force: true })),
	);
});

function digest(bytes: Uint8Array | string): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

class MemoryEvidenceArtifactStore implements EvidenceArtifactStore {
	readonly artifacts = new Map<string, Uint8Array>();
	readCount = 0;

	async publishEvidenceArtifact(
		input: Uint8Array,
	): Promise<EvidenceArtifactRef> {
		const bytes = Uint8Array.from(input);
		const ref = {
			kind: "restricted_evidence_v1",
			digest: digest(bytes),
			byteLength: bytes.byteLength,
		} as const;
		this.artifacts.set(ref.digest, bytes);
		return ref;
	}

	async readEvidenceArtifact(ref: EvidenceArtifactRef): Promise<Uint8Array> {
		this.readCount += 1;
		if (ref.kind !== "restricted_evidence_v1") {
			throw new Error("invalid artifact kind");
		}
		const bytes = this.artifacts.get(ref.digest);
		if (!bytes) throw new Error("artifact not found");
		if (bytes.byteLength !== ref.byteLength || digest(bytes) !== ref.digest) {
			throw new Error("artifact integrity failure");
		}
		return Uint8Array.from(bytes);
	}

	replace(ref: { digest: string }, bytes: Uint8Array): void {
		this.artifacts.set(ref.digest, Uint8Array.from(bytes));
	}

	remove(ref: { digest: string }): void {
		this.artifacts.delete(ref.digest);
	}
}

async function completeReceipt(
	artifacts: EvidenceArtifactStore,
	overrides: Partial<ValidationReceiptV1> = {},
): Promise<ValidationReceiptV1> {
	const command =
		overrides.command ?? "bun test tests/validation-receipts.test.ts";
	const output = utf8.encode("12 pass\n0 fail\n");
	const exactOutputArtifactRef =
		overrides.exactOutputArtifactRef ??
		(await artifacts.publishEvidenceArtifact(output));
	return parseValidationReceipt({
		schemaVersion: 1,
		kind: VALIDATION_RECEIPT_KIND,
		featureRunId: "feature-run:validation-receipt",
		featureId: toFeatureId("validation-receipts"),
		sourceDigest: digest("source-before-command"),
		startedAt: "2026-07-19T19:00:00.000Z",
		completedAt: "2026-07-19T19:00:03.000Z",
		command,
		commandDigest:
			overrides.commandDigest ?? canonicalValidationCommandDigest(command),
		commandClass: overrides.commandClass ?? validationCommandClass(command),
		coverageScope: "focused",
		exitCode: 0,
		outputDigest: overrides.outputDigest ?? exactOutputArtifactRef.digest,
		outputCompleteness: "complete",
		environmentKeys: ["PATH", "CI"],
		exactOutputArtifactRef,
		...overrides,
	});
}

function materializationBinding() {
	return {
		evidenceId: digest("assignment-owned-evidence"),
		capturedAtRevision: 7,
		capturedAtSnapshotId: digest("assignment-snapshot"),
		snapshotId: digest("assignment-snapshot"),
	};
}

describe("ValidationReceiptV1", () => {
	test("keeps exact output references within the existing artifact-store bound", () => {
		expect(MAX_VALIDATION_OUTPUT_ARTIFACT_BYTES).toBe(
			MAX_EVIDENCE_ARTIFACT_BYTES,
		);
	});

	test("roundtrips canonical receipt bytes through the restricted artifact store", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);
		const store = createValidationReceiptStore(artifacts);

		const ref = await store.publishValidationReceipt(receipt);
		const restored = await store.readValidationReceipt(ref);

		expect(ref).toEqual({
			kind: VALIDATION_RECEIPT_REF_KIND,
			digest: digest(canonicalValidationReceiptBytes(receipt)),
			byteLength: canonicalValidationReceiptBytes(receipt).byteLength,
		});
		expect(restored).toEqual(receipt);
		expect(Object.isFrozen(restored)).toBe(true);
		expect(Object.isFrozen(restored.environmentKeys)).toBe(true);
		expect(Object.isFrozen(restored.exactOutputArtifactRef)).toBe(true);
	});

	test("uses the existing file evidence store as its only physical backing", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-validation-receipt-"));
		temporaryWorkspaces.push(workspace);
		const artifacts = createFileEvidenceArtifactStore(workspace);
		const receipt = await completeReceipt(artifacts);
		const store = createValidationReceiptStore(artifacts);

		const ref = await store.publishValidationReceipt(receipt);

		expect(await store.readValidationReceipt(ref)).toEqual(receipt);
		expect(ref.kind).toBe(VALIDATION_RECEIPT_REF_KIND);
	});

	test("produces deterministic bytes and canonicalizes environment key order", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);
		const reordered = parseValidationReceipt({
			exactOutputArtifactRef: receipt.exactOutputArtifactRef,
			environmentKeys: ["PATH", "CI", "PATH"],
			outputCompleteness: receipt.outputCompleteness,
			outputDigest: receipt.outputDigest,
			exitCode: receipt.exitCode,
			coverageScope: receipt.coverageScope,
			commandClass: receipt.commandClass,
			commandDigest: receipt.commandDigest,
			command: receipt.command,
			completedAt: receipt.completedAt,
			startedAt: receipt.startedAt,
			sourceDigest: receipt.sourceDigest,
			featureId: receipt.featureId,
			featureRunId: receipt.featureRunId,
			kind: receipt.kind,
			schemaVersion: receipt.schemaVersion,
		});

		expect(reordered.environmentKeys).toEqual(["CI", "PATH"]);
		expect(canonicalValidationReceiptBytes(reordered)).toEqual(
			canonicalValidationReceiptBytes(receipt),
		);
	});

	test("rejects malformed, oversized, tampered, and noncanonical representations", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);
		const store = createValidationReceiptStore(artifacts);

		expect(() =>
			parseValidationReceipt({ ...receipt, callerSummary: "looks good" }),
		).toThrow();
		expect(() =>
			parseValidationReceipt({
				...receipt,
				command: "x".repeat(MAX_VALIDATION_COMMAND_BYTES + 1),
			}),
		).toThrow();
		expect(() =>
			parseCanonicalValidationReceiptBytes(
				new Uint8Array(MAX_VALIDATION_RECEIPT_BYTES + 1),
			),
		).toThrow(ValidationReceiptTooLargeError);

		const receiptRef = await store.publishValidationReceipt(receipt);
		const tampered = canonicalValidationReceiptBytes(receipt);
		tampered[tampered.byteLength - 2] =
			(tampered[tampered.byteLength - 2] ?? 0) ^ 1;
		artifacts.replace(receiptRef, tampered);
		await expect(store.readValidationReceipt(receiptRef)).rejects.toThrow(
			ValidationReceiptIntegrityError,
		);

		const prettyBytes = utf8.encode(
			JSON.stringify(
				JSON.parse(
					new TextDecoder().decode(canonicalValidationReceiptBytes(receipt)),
				),
				null,
				2,
			),
		);
		const rawPrettyRef = await artifacts.publishEvidenceArtifact(prettyBytes);
		await expect(
			store.readValidationReceipt({
				kind: VALIDATION_RECEIPT_REF_KIND,
				digest: rawPrettyRef.digest,
				byteLength: rawPrettyRef.byteLength,
			}),
		).rejects.toThrow(ValidationReceiptIntegrityError);
	});

	test("rejects timestamp inversion and command identity mismatch", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);

		expect(() =>
			parseValidationReceipt({
				...receipt,
				completedAt: "2026-07-19T18:59:59.000Z",
			}),
		).toThrow();
		expect(() =>
			parseValidationReceipt({
				...receipt,
				commandDigest: digest("different command"),
			}),
		).toThrow();
		expect(() =>
			parseValidationReceipt({ ...receipt, commandClass: "build" }),
		).toThrow();
	});

	test("accepts only uppercase environment names, rejects values, and dedupes", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);

		expect(() =>
			parseValidationReceipt({ ...receipt, environmentKeys: ["Path"] }),
		).toThrow();
		expect(() =>
			parseValidationReceipt({
				...receipt,
				environmentKeys: [{ API_TOKEN: "secret" }],
			}),
		).toThrow();
		expect(
			parseValidationReceipt({
				...receipt,
				environmentKeys: ["CI", "PATH", "CI"],
			}).environmentKeys,
		).toEqual(["CI", "PATH"]);
	});

	test("binds exact output only to complete host-visible bytes", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);

		expect(() =>
			parseValidationReceipt({
				...receipt,
				outputDigest: digest("different output"),
			}),
		).toThrow();
		const { exactOutputArtifactRef: _optionalExact, ...completeWithoutExact } =
			receipt;
		expect(parseValidationReceipt(completeWithoutExact)).toMatchObject({
			outputCompleteness: "complete",
		});
		expect(() =>
			parseValidationReceipt({
				...receipt,
				outputCompleteness: "truncated",
			}),
		).toThrow();

		const { exactOutputArtifactRef: _exact, ...withoutExact } = receipt;
		for (const outputCompleteness of ["truncated", "unknown"] as const) {
			expect(
				parseValidationReceipt({
					...withoutExact,
					outputCompleteness,
				}),
			).toMatchObject({ outputCompleteness });
		}

		if (!receipt.exactOutputArtifactRef) {
			throw new Error("Expected exact output evidence.");
		}
		artifacts.remove(receipt.exactOutputArtifactRef);
		await expect(
			createValidationReceiptStore(artifacts).publishValidationReceipt(receipt),
		).rejects.toThrow(ValidationReceiptIntegrityError);
	});

	test("re-verifies exact output bytes when reading a stored receipt", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);
		const store = createValidationReceiptStore(artifacts);
		const ref = await store.publishValidationReceipt(receipt);
		if (!receipt.exactOutputArtifactRef) {
			throw new Error("Expected exact output evidence.");
		}
		artifacts.replace(
			receipt.exactOutputArtifactRef,
			utf8.encode("tampered exact output"),
		);

		await expect(store.readValidationReceipt(ref)).rejects.toThrow(
			ValidationReceiptIntegrityError,
		);
	});

	test("rejects invalid and oversized public references before storage access", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const store = createValidationReceiptStore(artifacts);
		const invalid = {
			kind: VALIDATION_RECEIPT_REF_KIND,
			digest: digest("receipt"),
			byteLength: MAX_VALIDATION_RECEIPT_BYTES + 1,
		} as ValidationReceiptRef;

		expect(() => parseValidationReceiptRef(invalid)).toThrow();
		await expect(store.readValidationReceipt(invalid)).rejects.toThrow(
			InvalidValidationReceiptError,
		);
		expect(artifacts.readCount).toBe(0);
	});

	test("preserves receipt-owned run, source, command, and timing on materialization", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts, {
			featureRunId: "feature-run:runtime-owned",
			sourceDigest: digest("observed-before-execution"),
			startedAt: "2026-07-19T20:00:00.000Z",
			completedAt: "2026-07-19T20:00:02.000Z",
		});
		const binding = materializationBinding();

		const evidence: ValidationEvidence = materializeValidationEvidence(
			receipt,
			binding,
		);

		expect(evidence).toEqual({
			kind: "validation",
			...binding,
			featureRunId: receipt.featureRunId,
			sourceDigest: receipt.sourceDigest,
			commandDigest: receipt.commandDigest,
			commandClass: receipt.commandClass,
			startedAt: receipt.startedAt,
			completedAt: receipt.completedAt,
			exitCode: 0,
			outputDigest: receipt.outputDigest,
			artifactRef: receipt.exactOutputArtifactRef,
			environmentKeys: ["CI", "PATH"],
		});
	});

	test("materializes complete receipts without retaining raw command output", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const complete = await completeReceipt(artifacts);
		const { exactOutputArtifactRef: _exact, ...withoutRawOutput } = complete;
		const receipt = parseValidationReceipt(withoutRawOutput);

		expect(
			materializeValidationEvidence(receipt, materializationBinding()),
		).not.toHaveProperty("artifactRef");
	});

	test("rejects failed or incomplete receipts as review evidence", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const failed = await completeReceipt(artifacts, { exitCode: 1 });
		expect(() =>
			materializeValidationEvidence(failed, materializationBinding()),
		).toThrow(ValidationReceiptMaterializationError);

		const complete = await completeReceipt(artifacts);
		const { exactOutputArtifactRef: _exact, ...withoutExact } = complete;
		const incomplete = parseValidationReceipt({
			...withoutExact,
			outputCompleteness: "unknown",
		});
		expect(() =>
			materializeValidationEvidence(incomplete, materializationBinding()),
		).toThrow(ValidationReceiptMaterializationError);
	});

	test("rejects a causal binding whose snapshots disagree", async () => {
		const artifacts = new MemoryEvidenceArtifactStore();
		const receipt = await completeReceipt(artifacts);
		expect(() =>
			materializeValidationEvidence(receipt, {
				...materializationBinding(),
				snapshotId: digest("other-snapshot"),
			}),
		).toThrow();
	});
});
