import { createHash, randomUUID } from "node:crypto";
import type {
	ObservedValidation,
	PreparedValidation,
} from "../../application/prepare-validation.js";
import type {
	ObservedAssertion,
	ValidationIneligibleReason,
	ValidationObservation,
} from "../../domain/session.js";
import { observeAssertions } from "../../domain/test-results.js";
import { isValidationEligible } from "../../domain/validation.js";
import type { Hooks } from "./sdk.js";

const MAX_CAPTURES = 128;
const CAPTURE_TTL_MS = 15 * 60 * 1_000;

type PendingCapture = PreparedValidation &
	Readonly<{
		captureId: string;
		sessionID: string;
		workspace: string;
		armedAt: number;
	}> & {
		callID: string | null;
		priorReport: { digest: string; modifiedMs: number } | null;
	};

type ValidationCaptureOptions = Readonly<{
	persistObservation: (
		workspace: string,
		observation: ObservedValidation,
	) => Promise<ValidationObservation>;
	readReport?:
		| ((
				workspace: string,
				relativePath: string,
		  ) => Promise<{ text: string; modifiedMs: number } | null>)
		| undefined;
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

/**
 * Whether the host reported that it captured the whole command output.
 *
 * `null` means the host reported neither flag, which is different from reporting
 * truncation: the output may well be complete, but Flow has no evidence of it, so
 * the observation is recorded as ineligible rather than silently treated as
 * truncated.
 */
function completeOutput(value: unknown): boolean | null {
	if (!value || typeof value !== "object") return null;
	const metadata = value as Record<string, unknown>;
	if (metadata.truncated === true || metadata.complete === false) return false;
	if (metadata.truncated === false || metadata.complete === true) return true;
	return null;
}

function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function isBash(tool: string): boolean {
	return tool.toLowerCase() === "bash";
}

export class ValidationCaptureCoordinator {
	readonly #persist: ValidationCaptureOptions["persistObservation"];
	readonly #readReport: ValidationCaptureOptions["readReport"];
	readonly #now: () => number;
	readonly #randomId: () => string;
	readonly #pending = new Map<string, PendingCapture>();

	constructor(options: ValidationCaptureOptions) {
		this.#persist = options.persistObservation;
		this.#readReport = options.readReport;
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? randomUUID;
	}

	/**
	 * What the command's own report says about each name the plan declared.
	 *
	 * Every route that is not a report this command wrote lands on `absent`, because
	 * they mean the same thing: nothing observed those cases.
	 */
	async #observeAssertions(
		capture: PendingCapture,
		observedAt: number,
	): Promise<ObservedAssertion[]> {
		if (capture.assertions.length === 0) return [];
		const absent = capture.assertions.map((name) => ({
			name,
			status: "absent" as const,
		}));
		if (!capture.resultsPath || !this.#readReport) return absent;
		const report = await this.#report(capture.workspace, capture.resultsPath);
		// `<=`, not `<`: the contract is that this command wrote the report, so a report
		// whose mtime only *equals* the arming instant has not been shown to postdate it.
		// Not a one-millisecond window either — mtime granularity is a whole second on
		// some filesystems, which is wide enough for a stale report to share it.
		if (
			!report ||
			report.modifiedMs <= capture.armedAt ||
			report.modifiedMs > observedAt ||
			(capture.priorReport?.modifiedMs === report.modifiedMs &&
				capture.priorReport.digest === digest(report.text))
		)
			return absent;
		return observeAssertions(capture.assertions, report.text);
	}

	async #report(workspace: string, path: string) {
		if (!this.#readReport) return null;
		try {
			return await this.#readReport(workspace, path);
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				typeof error.code === "string"
			)
				return null;
			throw error;
		}
	}

	#prune(): void {
		const cutoff = this.#now() - CAPTURE_TTL_MS;
		for (const [sessionID, capture] of this.#pending) {
			if (capture.callID === null && capture.armedAt < cutoff) {
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
			priorReport: null,
		});
		return { captureId, expiresInMs: CAPTURE_TTL_MS };
	}

	cancel(sessionID: string): boolean {
		return this.#pending.delete(sessionID);
	}

	async observeToolBefore(
		input: BeforeInput,
		output: BeforeOutput,
	): Promise<void> {
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
		if (capture.resultsPath && capture.assertions.length > 0) {
			const report = await this.#report(capture.workspace, capture.resultsPath);
			capture.priorReport = report
				? { digest: digest(report.text), modifiedMs: report.modifiedMs }
				: null;
		}
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
		// A host that reports no exit code or no completeness flag still gets a
		// durable observation, recorded as ineligible. Failing closed by throwing
		// would lose the record entirely and make Flow unusable on such a host.
		const observedExit = exitCode(output.metadata);
		const observedComplete = completeOutput(output.metadata);
		const hostGap: ValidationIneligibleReason | null =
			observedExit === null
				? "exit-code-unavailable"
				: observedComplete === null
					? "output-completeness-unknown"
					: null;
		const observedAssertions = await this.#observeAssertions(
			capture,
			this.#now(),
		);
		const observation = await this.#persist(capture.workspace, {
			featureId: capture.featureId,
			runId: capture.runId,
			command: capture.command,
			scope: capture.scope,
			sourceDigest: capture.sourceDigest,
			hostPlatform: capture.hostPlatform,
			assertions: capture.assertions,
			resultsPath: capture.resultsPath,
			...(observedAssertions.length > 0 ? { observedAssertions } : {}),
			captureId: capture.captureId,
			exitCode: observedExit,
			outputDigest: digest(output.output),
			outputComplete: observedComplete === true,
			...(hostGap ? { ineligibleReason: hostGap } : {}),
		});
		output.output = `${output.output}\n\n[flow-validation] ${JSON.stringify({
			id: observation.id,
			scope: observation.scope,
			passed: isValidationEligible(observation),
			recordedRevision: observation.recordedRevision,
			// Reported back because a declared case that came out `skipped` or `absent` is
			// exactly the state exit zero hides, and the caller has to be told before it
			// reads the exit code as proof.
			...(observation.observedAssertions
				? { assertions: observation.observedAssertions }
				: {}),
			...(observation.ineligibleReason
				? { ineligibleReason: observation.ineligibleReason }
				: {}),
		})}`;
		return observation;
	}

	pendingCount(): number {
		this.#prune();
		return this.#pending.size;
	}
}
