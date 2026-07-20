import { createHash, randomUUID } from "node:crypto";
import type {
	ObservedValidation,
	PreparedValidation,
} from "../../application/prepare-validation.js";
import type { ValidationObservation } from "../../domain/session.js";
import type { Hooks } from "./sdk.js";

const MAX_CAPTURES = 128;
const CAPTURE_TTL_MS = 15 * 60 * 1_000;

type PendingCapture = PreparedValidation &
	Readonly<{
		captureId: string;
		sessionID: string;
		workspace: string;
		armedAt: number;
	}> & { callID: string | null };

export type ValidationCaptureOptions = Readonly<{
	persistObservation: (
		workspace: string,
		observation: ObservedValidation,
	) => Promise<ValidationObservation>;
	now?: (() => number) | undefined;
	randomId?: (() => string) | undefined;
}>;

type BeforeInput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[0];
type BeforeOutput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[1];
type AfterInput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[0];
type AfterOutput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[1];

export class ValidationCaptureError extends Error {
	readonly code = "FLOW_VALIDATION_CAPTURE";
}

function commandFromArgs(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const command = (value as Record<string, unknown>).command;
	return typeof command === "string" ? command : null;
}

function exitCode(value: unknown): number | null {
	if (!value || typeof value !== "object") return null;
	const exit = (value as Record<string, unknown>).exit;
	return typeof exit === "number" && Number.isSafeInteger(exit) ? exit : null;
}

function completeOutput(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const metadata = value as Record<string, unknown>;
	return metadata.truncated === false || metadata.complete === true;
}

function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function isBash(tool: string): boolean {
	return tool.toLowerCase() === "bash";
}

export class ValidationCaptureCoordinator {
	readonly #persist: ValidationCaptureOptions["persistObservation"];
	readonly #now: () => number;
	readonly #randomId: () => string;
	readonly #pending = new Map<string, PendingCapture>();

	constructor(options: ValidationCaptureOptions) {
		this.#persist = options.persistObservation;
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? randomUUID;
	}

	#prune(): void {
		const cutoff = this.#now() - CAPTURE_TTL_MS;
		for (const [sessionID, capture] of this.#pending) {
			if (capture.armedAt < cutoff) {
				this.#pending.delete(sessionID);
			}
		}
	}

	arm(
		sessionID: string,
		workspace: string,
		prepared: PreparedValidation,
	): Readonly<{ captureId: string; expiresInMs: number }> {
		this.#prune();
		if (this.#pending.has(sessionID)) {
			throw new ValidationCaptureError(
				"This OpenCode session already has an armed validation command.",
			);
		}
		if (this.#pending.size >= MAX_CAPTURES) {
			throw new ValidationCaptureError(
				"Flow validation capture is at capacity.",
			);
		}
		const captureId = this.#randomId();
		this.#pending.set(sessionID, {
			...prepared,
			captureId,
			sessionID,
			workspace,
			armedAt: this.#now(),
			callID: null,
		});
		return { captureId, expiresInMs: CAPTURE_TTL_MS };
	}

	cancel(sessionID: string): boolean {
		return this.#pending.delete(sessionID);
	}

	observeToolBefore(input: BeforeInput, output: BeforeOutput): void {
		this.#prune();
		if (!isBash(input.tool)) return;
		const capture = this.#pending.get(input.sessionID);
		if (!capture || capture.callID !== null) return;
		if (commandFromArgs(output.args) !== capture.command) {
			this.#pending.delete(input.sessionID);
			throw new ValidationCaptureError(
				"The next Bash command did not match the armed validation command; capture was cancelled.",
			);
		}
		capture.callID = input.callID;
	}

	async observeToolAfter(
		input: AfterInput,
		output: AfterOutput,
	): Promise<ValidationObservation | null> {
		this.#prune();
		if (!isBash(input.tool)) return null;
		const capture = this.#pending.get(input.sessionID);
		if (!capture || capture.callID !== input.callID) return null;
		this.#pending.delete(input.sessionID);
		if (commandFromArgs(input.args) !== capture.command) {
			throw new ValidationCaptureError(
				"The executed Bash command changed after Flow armed it.",
			);
		}
		const observedExit = exitCode(output.metadata);
		if (observedExit === null) {
			throw new ValidationCaptureError(
				"OpenCode did not expose a structured Bash exit code; validation was not recorded.",
			);
		}
		const observation = await this.#persist(capture.workspace, {
			featureId: capture.featureId,
			runId: capture.runId,
			command: capture.command,
			scope: capture.scope,
			sourceDigest: capture.sourceDigest,
			captureId: capture.captureId,
			exitCode: observedExit,
			outputDigest: digest(output.output),
			outputComplete: completeOutput(output.metadata),
		});
		output.output = `${output.output}\n\n[flow-validation] ${JSON.stringify({
			id: observation.id,
			scope: observation.scope,
			passed: observation.exitCode === 0 && observation.outputComplete,
		})}`;
		return observation;
	}

	pendingCount(): number {
		this.#prune();
		return this.#pending.size;
	}
}
