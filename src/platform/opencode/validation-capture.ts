import { createHash, randomUUID } from "node:crypto";
import { canonicalValidationCommandDigest } from "../../domain/transitions.js";
import { validationCommandClass } from "../../domain/validation-command.js";
import type {
	ValidationReceiptRef,
	ValidationReceiptV1,
} from "../../domain/validation-receipt.js";
import {
	parseValidationReceipt,
	VALIDATION_RECEIPT_KIND,
} from "../../domain/validation-receipt.js";
import type { Hooks } from "./sdk.js";

const DEFAULT_MAX_CAPTURES = 128;
const DEFAULT_CAPTURE_TTL_MS = 15 * 60 * 1_000;

export type PreparedValidationCapture = {
	featureRunId: string;
	featureId: string;
	sourceDigest: `sha256:${string}`;
};

export type ArmValidationCaptureInput = PreparedValidationCapture & {
	sessionID: string;
	worktree: string;
	command: string;
	coverageScope: "focused" | "broad" | "artifact";
	environmentKeys: string[];
};

export type ArmedValidationCapture = {
	captureId: string;
	expiresAt: string;
	commandDigest: string;
};

type PendingCapture = ArmValidationCaptureInput & {
	captureId: string;
	armedAt: number;
	callID: string | null;
	startedAt: string | null;
};

export type ValidationCaptureCoordinatorOptions = {
	publishReceipt: (
		worktree: string,
		receipt: ValidationReceiptV1,
	) => Promise<ValidationReceiptRef>;
	now?: () => number;
	randomId?: () => string;
	maxCaptures?: number;
	captureTtlMs?: number;
};

type ToolBeforeInput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[0];
type ToolBeforeOutput = Parameters<
	NonNullable<Hooks["tool.execute.before"]>
>[1];
type ToolAfterInput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[0];
type ToolAfterOutput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[1];

export class ValidationCaptureError extends Error {
	readonly code = "FLOW_VALIDATION_CAPTURE";
}

function isoTime(epochMs: number): string {
	return new Date(epochMs).toISOString();
}

function commandFromArgs(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	const record = args as Record<string, unknown>;
	return typeof record.command === "string" ? record.command : null;
}

function exitCodeFromMetadata(metadata: unknown): number | null {
	if (!metadata || typeof metadata !== "object") return null;
	const record = metadata as Record<string, unknown>;
	// Pinned OpenCode 1.18.3 exposes the shell result as `metadata.exit`.
	// Accept only that structured field so unrelated metadata cannot attest success.
	const value = record.exit;
	if (typeof value === "number" && Number.isSafeInteger(value)) return value;
	return null;
}

function completenessFromMetadata(
	metadata: unknown,
): "complete" | "truncated" | "unknown" {
	if (!metadata || typeof metadata !== "object") return "unknown";
	const record = metadata as Record<string, unknown>;
	if (record.truncated === true) return "truncated";
	if (record.truncated === false || record.complete === true) return "complete";
	return "unknown";
}

function outputDigest(output: string): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(output).digest("hex")}`;
}

function isBashTool(tool: string): boolean {
	return tool.toLowerCase() === "bash";
}

export class ValidationCaptureCoordinator {
	readonly #publishReceipt: ValidationCaptureCoordinatorOptions["publishReceipt"];
	readonly #now: () => number;
	readonly #randomId: () => string;
	readonly #maxCaptures: number;
	readonly #captureTtlMs: number;
	readonly #pendingBySession = new Map<string, PendingCapture>();

	constructor(options: ValidationCaptureCoordinatorOptions) {
		this.#publishReceipt = options.publishReceipt;
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? randomUUID;
		this.#maxCaptures = options.maxCaptures ?? DEFAULT_MAX_CAPTURES;
		this.#captureTtlMs = options.captureTtlMs ?? DEFAULT_CAPTURE_TTL_MS;
		if (
			!Number.isSafeInteger(this.#maxCaptures) ||
			this.#maxCaptures < 1 ||
			!Number.isSafeInteger(this.#captureTtlMs) ||
			this.#captureTtlMs < 1
		) {
			throw new RangeError(
				"Validation capture bounds must be positive integers.",
			);
		}
	}

	#pruneExpired(): void {
		const cutoff = this.#now() - this.#captureTtlMs;
		for (const [sessionID, pending] of this.#pendingBySession) {
			// Once a concrete Bash call is bound, let the host completion/idle event
			// settle it. The arm TTL must not invalidate a legitimately long command.
			if (pending.callID !== null) continue;
			if (pending.armedAt >= cutoff) continue;
			this.#pendingBySession.delete(sessionID);
		}
	}

	arm(input: ArmValidationCaptureInput): ArmedValidationCapture {
		this.#pruneExpired();
		if (this.#pendingBySession.has(input.sessionID)) {
			throw new ValidationCaptureError(
				"This OpenCode session already has an armed validation capture.",
			);
		}
		if (this.#pendingBySession.size >= this.#maxCaptures) {
			throw new ValidationCaptureError(
				"Flow reached its bounded pending validation-capture capacity.",
			);
		}
		const armedAt = this.#now();
		const pending: PendingCapture = {
			...input,
			environmentKeys: [...input.environmentKeys],
			captureId: this.#randomId(),
			armedAt,
			callID: null,
			startedAt: null,
		};
		this.#pendingBySession.set(input.sessionID, pending);
		return {
			captureId: pending.captureId,
			expiresAt: isoTime(armedAt + this.#captureTtlMs),
			commandDigest: canonicalValidationCommandDigest(input.command),
		};
	}

	cancel(sessionID: string, captureId?: string): boolean {
		const pending = this.#pendingBySession.get(sessionID);
		if (!pending || (captureId && captureId !== pending.captureId))
			return false;
		return this.#pendingBySession.delete(sessionID);
	}

	observeToolBefore(input: ToolBeforeInput, output: ToolBeforeOutput): void {
		this.#pruneExpired();
		if (!isBashTool(input.tool)) return;
		const pending = this.#pendingBySession.get(input.sessionID);
		if (!pending || pending.callID !== null) return;
		const command = commandFromArgs(output.args);
		if (command !== pending.command) {
			this.#pendingBySession.delete(input.sessionID);
			throw new ValidationCaptureError(
				"The next Bash command did not exactly match the armed validation command; the capture was cancelled.",
			);
		}
		pending.callID = input.callID;
		pending.startedAt = isoTime(this.#now());
	}

	async observeToolAfter(
		input: ToolAfterInput,
		output: ToolAfterOutput,
	): Promise<ValidationReceiptRef | null> {
		this.#pruneExpired();
		if (!isBashTool(input.tool)) return null;
		const pending = this.#pendingBySession.get(input.sessionID);
		if (!pending || pending.callID !== input.callID || !pending.startedAt) {
			return null;
		}
		this.#pendingBySession.delete(input.sessionID);
		if (commandFromArgs(input.args) !== pending.command) {
			throw new ValidationCaptureError(
				"The executed Bash command no longer matched the armed validation command; Flow refused to issue a receipt.",
			);
		}
		const exitCode = exitCodeFromMetadata(output.metadata);
		if (exitCode === null) {
			throw new ValidationCaptureError(
				"OpenCode did not expose a structured Bash exit code; Flow refused to attest this validation.",
			);
		}
		const receipt = parseValidationReceipt({
			schemaVersion: 1,
			kind: VALIDATION_RECEIPT_KIND,
			featureRunId: pending.featureRunId,
			featureId: pending.featureId,
			sourceDigest: pending.sourceDigest,
			startedAt: pending.startedAt,
			completedAt: isoTime(this.#now()),
			command: pending.command,
			commandDigest: canonicalValidationCommandDigest(pending.command),
			commandClass: validationCommandClass(pending.command),
			coverageScope: pending.coverageScope,
			exitCode,
			outputDigest: outputDigest(output.output),
			outputCompleteness: completenessFromMetadata(output.metadata),
			environmentKeys: pending.environmentKeys,
		});
		const ref = await this.#publishReceipt(pending.worktree, receipt);
		output.output = `${output.output}\n\n[flow-validation-receipt] ${JSON.stringify(ref)}`;
		return ref;
	}

	pendingCount(): number {
		this.#pruneExpired();
		return this.#pendingBySession.size;
	}
}
