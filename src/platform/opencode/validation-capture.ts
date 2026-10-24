import { createHash, randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type {
	ObservedValidation,
	PreparedValidation,
} from "../../application/prepare-validation.js";
import type {
	ObservedAssertion,
	ValidationIneligibleReason,
	ValidationObservation,
} from "../../domain/session.js";
import { assertMutableWorkspaceRoot } from "../../infrastructure/fs/workspace-paths.js";
import { observeAssertions } from "../../infrastructure/junit-results.js";
import type {
	AutoValidationOrigin,
	AutoValidationReceipt,
} from "./auto-drive.js";
import { validationContinuationOutcome } from "./auto-drive-validation.js";
import type {
	NativeToolAfter,
	NativeToolBefore,
	OpenCodeEvent,
} from "./sdk.js";

const MAX_CAPTURES = 128;
const CAPTURE_TTL_MS = 15 * 60 * 1_000;
const MAX_HOST_OUTPUT_BYTES = 8 * 1024 * 1024;

type PendingCapture = PreparedValidation &
	Readonly<{
		captureId: string;
		sessionID: string;
		workspace: string;
		armedAt: number;
		origin: AutoValidationOrigin | null;
	}> & {
		execution: {
			id: string;
			messageID: string;
			agent: string;
			startedAt: number;
		} | null;
		priorReport: { digest: string; modifiedMs: number } | null;
	};

type ValidationCaptureOptions = Readonly<{
	readSession: (sessionID: string) => Promise<unknown>;
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
	readFullOutput?: ((path: string) => Promise<string | null>) | undefined;
	onRecorded?: (receipt: AutoValidationReceipt) => void;
	onReceiptError?: (error: unknown) => void;
}>;

const SessionIdentity = z.object({
	id: z.string(),
	agent: z.string(),
	parentID: z.string().optional(),
	location: z.object({ directory: z.string() }),
});
const ShellInput = z.object({
	command: z.string(),
	workdir: z.string().optional(),
});
const ShellOutput = z.object({
	exit: z.number().int().safe().optional(),
	truncated: z.boolean().optional(),
	status: z.string().optional(),
	output: z.string().optional(),
	timeout: z.boolean().optional(),
});
const ShellRecord = z.object({
	id: z.string(),
	file: z.string(),
	command: z.string(),
	cwd: z.string(),
	status: z.enum(["running", "exited", "timeout", "killed"]),
	exit: z.number().int().safe().optional(),
	metadata: z.object({ sessionID: z.string() }),
	time: z.object({ started: z.number() }),
});
type NativeShellRecord = z.output<typeof ShellRecord>;
type ShellObservation =
	| { kind: "exited"; exit: number; complete: boolean | null; text: string }
	| { kind: "failed"; text: string }
	| { kind: "unknown"; text: string };

class ValidationCaptureError extends Error {
	readonly code = "FLOW_VALIDATION_CAPTURE";
}
function textContent(
	result: NativeToolAfter & { status: "completed" },
): string {
	const content = result.result.content;
	return typeof content === "string"
		? content
		: (content ?? [])
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
}
function observeShell(input: NativeToolAfter): ShellObservation {
	if (input.status === "error")
		return { kind: "failed", text: input.error.message };
	const wire = ShellOutput.safeParse(input.result.output);
	const meta = ShellOutput.safeParse(input.result.metadata);
	const output = wire.success ? wire.data : {};
	const metadata = meta.success ? meta.data : {};
	const text = output.output ?? textContent(input);
	if (
		(input.result.output !== undefined && !wire.success) ||
		(input.result.metadata !== undefined && !meta.success)
	)
		return { kind: "unknown", text };
	if (
		output.timeout ||
		metadata.timeout ||
		(output.status && output.status !== "completed") ||
		(metadata.status && metadata.status !== "completed")
	)
		return { kind: "unknown", text };
	if (
		output.exit !== undefined &&
		metadata.exit !== undefined &&
		output.exit !== metadata.exit
	)
		return { kind: "unknown", text };
	if (
		output.truncated !== undefined &&
		metadata.truncated !== undefined &&
		output.truncated !== metadata.truncated
	)
		return { kind: "unknown", text };
	const exit = output.exit ?? metadata.exit;
	if (exit === undefined) return { kind: "unknown", text };
	const truncated = output.truncated ?? metadata.truncated;
	return {
		kind: "exited",
		exit,
		complete: truncated === undefined ? null : !truncated,
		text,
	};
}

function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

export async function readHostToolOutput(
	path: string,
	dataHome = process.env.XDG_DATA_HOME?.trim() ||
		join(homedir(), ".local", "share"),
): Promise<string | null> {
	if (!isAbsolute(path) || !/^sh_[a-zA-Z0-9]+\.out$/.test(basename(path)))
		return null;
	const root = join(dataHome, "opencode", "shell");
	const directory = dirname(path);
	if (dirname(directory) !== root || !/^[a-f0-9]+$/.test(basename(directory)))
		return null;
	try {
		if (
			dirname(await realpath(directory)) !== (await realpath(root)) ||
			basename(await realpath(directory)) !== basename(directory) ||
			dirname(await realpath(path)) !== (await realpath(directory))
		)
			return null;
		const file = await open(
			path,
			constants.O_RDONLY |
				(process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
		);
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > MAX_HOST_OUTPUT_BYTES) return null;
			const bytes = Buffer.alloc(stat.size + 1);
			let length = 0;
			while (length < bytes.length) {
				const read = await file.read(bytes, length, bytes.length - length);
				if (read.bytesRead === 0) break;
				length += read.bytesRead;
			}
			if (length !== stat.size || (await file.stat()).size !== stat.size)
				return null;
			return new TextDecoder("utf-8", { fatal: true }).decode(
				bytes.subarray(0, length),
			);
		} finally {
			await file.close();
		}
	} catch {
		return null;
	}
}

export class ValidationCaptureCoordinator {
	readonly #readSession: ValidationCaptureOptions["readSession"];
	readonly #shellRecords = new Map<string, NativeShellRecord>();
	readonly #persist: ValidationCaptureOptions["persistObservation"];
	readonly #readReport: ValidationCaptureOptions["readReport"];
	readonly #now: () => number;
	readonly #randomId: () => string;
	readonly #readFullOutput: (path: string) => Promise<string | null>;
	readonly #pending = new Map<string, PendingCapture>();
	readonly #onRecorded: ValidationCaptureOptions["onRecorded"];
	readonly #onReceiptError: ValidationCaptureOptions["onReceiptError"];

	constructor(options: ValidationCaptureOptions) {
		this.#readSession = options.readSession;
		this.#persist = options.persistObservation;
		this.#readReport = options.readReport;
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? randomUUID;
		this.#readFullOutput = options.readFullOutput ?? readHostToolOutput;
		this.#onRecorded = options.onRecorded;
		this.#onReceiptError = options.onReceiptError;
	}

	observeShellEvent(event: OpenCodeEvent): void {
		if (event.type === "shell.created") {
			const parsed = ShellRecord.safeParse(event.data.info);
			if (parsed.success) this.#shellRecords.set(parsed.data.id, parsed.data);
			if (this.#shellRecords.size > MAX_CAPTURES)
				this.#shellRecords.delete(this.#shellRecords.keys().next().value ?? "");
		} else if (event.type === "shell.exited") {
			const record = this.#shellRecords.get(event.data.id);
			if (record)
				this.#shellRecords.set(record.id, {
					...record,
					status: event.data.status,
					...(event.data.exit === undefined ? {} : { exit: event.data.exit }),
				});
		} else if (event.type === "shell.deleted")
			this.#shellRecords.delete(event.data.id);
	}

	async #completeSpilledOutput(
		capture: PendingCapture,
		input: NativeToolAfter,
		observed: ShellObservation,
	): Promise<string | null> {
		if (
			input.status !== "completed" ||
			observed.kind !== "exited" ||
			observed.complete !== false ||
			!capture.execution
		)
			return null;
		const matches = [
			...textContent(input).matchAll(/full output saved to ([^\]\n]+)/g),
		];
		if (matches.length !== 1) return null;
		const path = matches[0]?.[1];
		if (!path) return null;
		const id = basename(path, ".out");
		const record = this.#shellRecords.get(id);
		if (
			!record ||
			record.file !== path ||
			record.metadata.sessionID !== capture.sessionID ||
			record.command !== capture.command ||
			record.status !== "exited" ||
			record.exit !== observed.exit ||
			record.time.started < capture.execution.startedAt ||
			record.time.started > this.#now()
		)
			return null;
		try {
			if (assertMutableWorkspaceRoot(record.cwd) !== capture.workspace)
				return null;
			const tail = observed.text.replace(
				/\n\n\[showing lines [0-9]+-[0-9]+ of [0-9]+; full output saved to [^\]\n]+\]$/,
				"",
			);
			if (tail.length < 64 || tail === observed.text) return null;
			const full = await this.#readFullOutput(path);
			return full !== null &&
				full.length > tail.length &&
				(full.endsWith(tail) || full.endsWith(`${tail}\n`))
				? full
				: null;
		} catch {
			return null;
		}
	}

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
			if (capture.execution === null && capture.armedAt < cutoff) {
				this.#pending.delete(sessionID);
			}
		}
	}

	arm(
		sessionID: string,
		workspace: string,
		prepared: PreparedValidation,
		origin: AutoValidationOrigin | null = null,
	): Readonly<{ captureId: string; expiresInMs: number }> {
		this.#prune();
		workspace = assertMutableWorkspaceRoot(workspace);
		if (this.#pending.has(sessionID)) {
			throw new ValidationCaptureError(
				"This OpenCode session already has an armed validation command.",
			);
		}
		if (
			[...this.#pending.values()].some(
				(capture) => capture.workspace === workspace,
			)
		) {
			throw new ValidationCaptureError(
				"This workspace already has an armed validation command.",
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
			origin,
			execution: null,
			priorReport: null,
		});
		return { captureId, expiresInMs: CAPTURE_TTL_MS };
	}

	cancel(sessionID: string): boolean {
		return this.#pending.delete(sessionID);
	}

	clear(): void {
		this.#pending.clear();
		this.#shellRecords.clear();
	}

	async observeToolBefore(input: NativeToolBefore): Promise<void> {
		this.#prune();
		if (input.tool !== "shell") return;
		const capture = this.#pending.get(input.sessionID);
		if (!capture || capture.execution) return;
		const args = ShellInput.safeParse(input.input);
		capture.execution = {
			id: input.id,
			messageID: input.messageID,
			agent: input.agent,
			startedAt: this.#now(),
		};
		try {
			const identity = SessionIdentity.parse(
				await this.#readSession(input.sessionID),
			);
			if (
				!args.success ||
				args.data.command !== capture.command ||
				identity.id !== input.sessionID ||
				identity.agent !== input.agent ||
				identity.parentID !== undefined ||
				["flow-planner", "flow-worker", "flow-reviewer"].includes(
					input.agent,
				) ||
				assertMutableWorkspaceRoot(identity.location.directory) !==
					capture.workspace ||
				realpathSync(
					resolve(identity.location.directory, args.data.workdir ?? ""),
				) !== capture.workspace
			)
				throw new Error(
					"The shell identity, workspace, or command did not match the armed validation.",
				);
		} catch (error) {
			this.#pending.delete(input.sessionID);
			throw new ValidationCaptureError(
				"The next shell command did not match the armed validation; capture was cancelled.",
				{ cause: error },
			);
		}
		if (capture.resultsPath && capture.assertions.length > 0) {
			const report = await this.#report(capture.workspace, capture.resultsPath);
			capture.priorReport = report
				? { digest: digest(report.text), modifiedMs: report.modifiedMs }
				: null;
		}
	}

	async observeToolAfter(
		input: NativeToolAfter,
	): Promise<ValidationObservation | null> {
		this.#prune();
		if (input.tool !== "shell") return null;
		const capture = this.#pending.get(input.sessionID);
		const execution = capture?.execution;
		if (
			!capture ||
			!execution ||
			execution.id !== input.id ||
			execution.messageID !== input.messageID ||
			execution.agent !== input.agent
		)
			return null;
		this.#pending.delete(input.sessionID);
		const args = ShellInput.safeParse(input.input);
		const identity = SessionIdentity.parse(
			await this.#readSession(input.sessionID),
		);
		if (
			!args.success ||
			args.data.command !== capture.command ||
			identity.id !== input.sessionID ||
			identity.agent !== input.agent ||
			identity.parentID !== undefined ||
			assertMutableWorkspaceRoot(identity.location.directory) !==
				capture.workspace ||
			realpathSync(
				resolve(identity.location.directory, args.data.workdir ?? ""),
			) !== capture.workspace
		)
			throw new ValidationCaptureError(
				"The executed shell command or workspace changed after Flow armed it.",
			);
		const observed = observeShell(input);
		const observedExit = observed.kind === "exited" ? observed.exit : null;
		const observedComplete =
			observed.kind === "exited" ? observed.complete : null;
		const fullOutput = await this.#completeSpilledOutput(
			capture,
			input,
			observed,
		);
		const outputComplete = observedComplete === true || fullOutput !== null;
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
			intent: capture.intent,
			assertions: capture.assertions,
			resultsPath: capture.resultsPath,
			...(observedAssertions.length > 0 ? { observedAssertions } : {}),
			captureId: capture.captureId,
			exitCode: observedExit,
			outputDigest: digest(fullOutput ?? observed.text),
			outputComplete,
			...(hostGap ? { ineligibleReason: hostGap } : {}),
		});
		const outcome = validationContinuationOutcome(capture, observation);
		const receipt = `\n\n[flow-validation] ${JSON.stringify({
			id: observation.id,
			scope: observation.scope,
			intent: observation.intent ?? capture.intent,
			passed: outcome === "passed",
			observed: outcome === "observed",
			recordedRevision: observation.recordedRevision,
			...(observation.observedAssertions
				? { assertions: observation.observedAssertions }
				: {}),
			...(observation.ineligibleReason
				? { ineligibleReason: observation.ineligibleReason }
				: {}),
			...(fullOutput ? { fullOutputDigest: observation.outputDigest } : {}),
		})}`;
		if (input.status === "completed")
			input.result = {
				...input.result,
				content: [{ type: "text", text: textContent(input) + receipt }],
			};
		if (capture.origin) {
			try {
				this.#onRecorded?.({
					origin: capture.origin,
					captureId: capture.captureId,
					observation,
				});
			} catch (error) {
				try {
					this.#onReceiptError?.(error);
				} catch {}
			}
		}
		return observation;
	}

	pendingCount(): number {
		this.#prune();
		return this.#pending.size;
	}
}
