import {
	type EpisodeQuestion,
	EpisodeQuestionSchema,
} from "./recovery-decisions/episode-operator.js";
import type { ScenarioStep } from "./scenario-steps.js";
// Model-in-the-loop harness for Flow.
//
// tests/ proves the runtime and the *text* of prompts deterministically. This
// harness proves the thing neither can: that a real model, driven by the real
// prompts, actually reaches the intended workflow outcome. It asserts durable
// state and the observed tool-call sequence, never prompt wording, so prompt
// rewrites are cheap and prompt regressions are visible.
//
// Requires provider credentials, so it is never part of `bun run check`.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	chmod,
	cp,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	CredentialEntry,
	OpenCodeClient,
	SessionInfo,
} from "@opencode/client";
import packageJson from "../package.json" with { type: "json" };
import { consumePaidDispatch } from "../scripts/paid-budget.js";
import { isArtifactPath } from "../src/domain/artifact.js";
import { type BunToolchain, runPinnedBunSync } from "./bun-toolchain.js";
import { CampaignCancelled } from "./campaign-stop.js";
import { canonicalJson } from "./canonical-json.js";
import { normalizeRecorded } from "./cassette.js";
import {
	type AttemptFailure,
	attemptFailure,
	EvaluationPhaseError,
	evaluationPhase,
	type NativeExecutionFailure,
	nativeExecutionFailure,
	preservePrimaryFailure,
	providerFailure,
} from "./failure-origin.js";
import {
	pseudonymizeEvalIds,
	type ScenarioGradeInput,
} from "./grader-input.js";
import {
	artifactFile,
	type HostArtifactPaths,
	type HostArtifacts,
	HostArtifactsSchema,
	type HostArtifactVerification,
	processArtifactFile,
	stageHostArtifacts,
	verifyHostArtifacts,
} from "./host-artifacts.js";
import {
	extractObservedActor,
	guidanceLoad,
	isRecord,
	nonEmptyString,
	type ObservedActor,
	type ObservedGuidanceLoad,
	type ObservedSession,
	reviewerActorObservation,
	selectLineageValidatedReviewers,
} from "./host-observation.js";
import {
	collectHostTrace,
	type HostAbortObservation,
	HostAbortObservationSchema,
	type HostTrace,
	type NativeExecutionScope,
	type NativeToolProvenance,
	nativeExecution,
	nativeToolProvenance,
} from "./host-trace.js";
import { HTTP_TRANSPORT_PLUGIN_ID } from "./http-transport-plugin.js";
import {
	connectNativeAccountSource,
	type NativeAuthentication,
	type NativeAuthHost,
} from "./native-auth/host.js";
import {
	type EvalMessage,
	installedOpenCodePluginEntry,
	listNativeMessages,
	listNativeSessions,
	nativeModel,
	OpenCodeStartup,
	openCodeInvocation,
	projectEvalMessage,
	validateOpenCodeVersion,
} from "./opencode-host.js";
import {
	exactPackageVersion,
	packedPackageManifest,
	tarballSha256,
} from "./provenance.js";
import {
	type EpisodeReservationScope,
	EpisodeReservationScopeSchema,
	requestBudgetStatus,
} from "./recovery-decisions/request-budget.js";
import { datasetDigest } from "./recovery-decisions/schema.js";
import {
	ExperimentalLiveProfile,
	type RecoveryTreatment,
	RecoveryTreatmentSchema,
	validateTreatmentBudget,
} from "./recovery-decisions/treatment.js";
import { releaseHostPermissions } from "./release-policy.js";
import {
	collectReviewerPacketBytes,
	type ReviewerPacketBytes,
} from "./reviewer-packet-bytes.js";
import { normalizeStudyUsage, type StudyUsage } from "./study-usage.js";

const STARTUP_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 120_000;
const ABORT_TIMEOUT_MS = 3_000;

function checkCancellation(signal?: AbortSignal): void {
	signal?.throwIfAborted();
}

/** Observe even non-cooperative requests, without leaving rejected promises unhandled. */
async function abortable<T>(
	signal: AbortSignal | undefined,
	operation: () => Promise<T>,
): Promise<T> {
	if (!signal) return operation();
	signal.throwIfAborted();
	let onAbort = () => {};
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		const result = await Promise.race([operation(), aborted]);
		return result;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

/** What OpenCode names the error it stamps on a message an abort killed. */
const ABORT_ERROR_NAME = "aborted";
const STALLED_MS = 3 * 60_000;

/** A single tool invocation observed in the transcript. */
export type ObservedToolCall = {
	readonly native?: NativeToolProvenance | undefined;
	readonly tool: string;
	readonly status: "pending" | "running" | "completed" | "error";
	/**
	 * Which of the run's sessions this call came from, in the order they were used.
	 *
	 * Transcripts are joined into one spine, so without this a scenario that crosses
	 * a session boundary cannot tell what the resumed session did from what it had
	 * already been told before the interruption.
	 */
	readonly sessionIndex: number;
	/**
	 * The agent that made the call, as the host recorded it on the message.
	 *
	 * `flow_feature_complete` admits a new completion only from `flow-reviewer`, so
	 * a recording that loses this cannot be replayed: the same arguments take the
	 * replay path instead of the submitting one.
	 */
	readonly agent: string;
	readonly input: Record<string, unknown>;
	/** Tool output, parsed as JSON when the tool returned a Flow envelope. */
	readonly output: unknown;
	readonly rawOutput: string;
	/**
	 * Host-reported metadata for the call: for shell, the `exit` code and the
	 * truncation flag the validation capture hook reads. Recorded because those two
	 * fields decide whether an observation can ever be eligible.
	 */
	readonly metadata: Record<string, unknown>;
};

/**
 * How a step's wait ended.
 *
 * `escalated` means the model asked the user and stopped. That is often the right
 * move — it is what a model should do when a gate cannot pass, or after saving a
 * plan it wants approved — but nothing in this wait answers, so the turn is aborted
 * before returning. Whether that ends the run is the runner's call, not this one's:
 * a scenario with a step still to come answers the question with that step's prompt,
 * and only a question the last step ends on leaves the state mid-flight by
 * definition. That case is reported apart from a pass or a failure rather than
 * waited out and scored as one.
 */
export type CommandEnd = "quiet" | "escalated";
type RequestDelivery =
	| { readonly kind: "pending" }
	| { readonly kind: "accepted" }
	| {
			readonly kind: "rejected";
			readonly message: string;
			readonly error: unknown;
	  };

type SessionRequestInit = RequestInit & { readonly timeout: false };
type SessionFetch = (
	input: string | URL | Request,
	init: SessionRequestInit,
) => Promise<Response>;
type SessionPostOptions = {
	readonly signal: AbortSignal;
	readonly fetch?: SessionFetch;
};
type SessionPost = (
	url: string,
	body: unknown,
	options: SessionPostOptions,
) => Promise<unknown>;

type SessionRequest = {
	readonly state: () => RequestDelivery;
	readonly cancel: () => void;
	readonly settled: Promise<void>;
};

function startSessionRequest(input: {
	readonly post: SessionPost;
	readonly url: string;
	readonly body: unknown;
	readonly onRejected: (message: string) => void;
}): SessionRequest {
	const controller = new AbortController();
	const cancellation = new Error("Session request cancelled by eval harness.");
	let cancelled = false;
	let delivery: RequestDelivery = { kind: "pending" };
	const settled = input
		.post(input.url, input.body, { signal: controller.signal })
		.then(
			() => {
				if (!cancelled) delivery = { kind: "accepted" };
			},
			(error) => {
				if (
					error === cancellation ||
					(cancelled && error instanceof Error && error.name === "AbortError")
				)
					return;
				const message = String(error);
				delivery = { kind: "rejected", message, error };
				input.onRejected(message);
			},
		);
	return {
		state: () => delivery,
		cancel: () => {
			if (cancelled) return;
			cancelled = true;
			controller.abort(cancellation);
		},
		settled,
	};
}

export async function runSessionRequest(input: {
	readonly post: SessionPost;
	readonly url: string;
	readonly body: unknown;
	readonly onRejected: (message: string) => void;
	readonly wait: (request: SessionRequest) => Promise<CommandEnd>;
	readonly signal?: AbortSignal | undefined;
	readonly onCancelled?: () => Promise<void>;
	/**
	 * Set only when wait itself observes signal. Await it through any pending
	 * failure cleanup instead of racing it; non-cooperative waits keep the default.
	 */
	readonly waitOwnsCancellation?: boolean;
}): Promise<CommandEnd> {
	checkCancellation(input.signal);
	const request = startSessionRequest(input);
	try {
		// The production progress wait already observes the signal. Racing it again
		// would discard a known timeout/wedge while its bounded abort is draining.
		return await (input.waitOwnsCancellation
			? input.wait(request)
			: abortable(input.signal, () => input.wait(request)));
	} catch (error) {
		if (input.signal?.aborted && error === input.signal.reason) {
			// A rejected POST may have landed between progress polls. Cancellation
			// ends the wait, but cannot erase that already-observed real failure.
			const delivery = request.state();
			const primary = delivery.kind === "rejected" ? delivery.error : error;
			request.cancel();
			return preservePrimaryFailure<CommandEnd>(
				() => Promise.reject(primary),
				async () => {
					await input.onCancelled?.();
				},
			);
		}
		throw error;
	} finally {
		request.cancel();
	}
}

/**
 * What the questions a run asked mean for its result.
 *
 * A question the final step ended on has nothing left to answer it, so the durable
 * state is mid-flight: that is scored only where the scenario declared asking an
 * acceptable end. A question during an earlier step is not an exclusion — the runner
 * carries the run into the next step, whose prompt is the answer. Three scenarios
 * open with `flow-plan`, where asking for approval is the behaviour `plan-only-stops`
 * gates at 100%; excluding those attempts cost a correct run its score, and cost a
 * gated pair needing three scored attempts its qualification.
 */
export function askedScoring(
	escalatedSteps: readonly number[],
	stepCount: number,
	mayEscalate: boolean,
): { readonly escalated: boolean; readonly unscored: boolean } {
	return {
		escalated: escalatedSteps.length > 0,
		unscored: escalatedSteps.includes(stepCount - 1) && !mayEscalate,
	};
}

/** Everything a scenario is allowed to assert against. */
type ProviderErrorObservation = Readonly<{
	sessionId: string;
	name: string;
	message: string;
}>;

export type Outcome = {
	readonly abortObservation?: HostAbortObservation | undefined;
	readonly packetBytes?: readonly ReviewerPacketBytes[] | undefined;
	readonly hostTrace?: HostTrace | undefined;
	/** Ordered `flow_*` calls only — the workflow's observable spine. */
	readonly flowCalls: readonly ObservedToolCall[];
	/** Every tool call, including host tools like shell/edit/subagent. */
	readonly allCalls: readonly ObservedToolCall[];
	/** Actor identity observations from completed, non-error assistant messages. */
	readonly actors?: readonly ObservedActor[];
	/** Raw delivered flow_guidance output, with its measured UTF-8 size. */
	readonly guidanceLoads?: readonly ObservedGuidanceLoad[];
	/** Parsed `.flow/session.json`, or null when no active session exists. */
	readonly session: Record<string, unknown> | null;
	/** Parsed documents under `.flow/history/`. */
	readonly archives: readonly Record<string, unknown>[];
	readonly workspaceChanges?: WorkspaceChangeObservation | undefined;
	readonly reviewDocument?: ReviewDocumentObservation | undefined;
	readonly finalText: string;
	readonly tokens: {
		input: number;
		output: number;
		reasoning: number;
		cacheRead: number;
		cacheWrite: number;
	};
	readonly usageAvailability?: "observed" | "incomplete" | "unobserved";
	/**
	 * Total reported cost, or null when the provider priced nothing. Reporting an
	 * unpriced run as 0 reads as "this run was free", which is the opposite of
	 * true.
	 *
	 * A provider that does not price a run reports zero rather than omitting the
	 * field, so checking only for an absent number is not enough: every OpenAI run
	 * measured here reported `cost: 0` on real token use and printed `$0.0000`. A
	 * zero total against any reported token use is an unknown cost estimate.
	 * Host estimates do not establish invoice cost or the effective service tier.
	 */
	readonly costUsd: number | null;
	readonly assistantMessages: number;
	readonly durationMs: number;
	readonly providerError: AttemptFailure<"provider"> | null;
	readonly nativeFailure: NativeExecutionFailure | null;
	readonly providerErrorObservation?: ProviderErrorObservation | null;
};

export type WorkspaceChangeObservation =
	| Readonly<{ kind: "observed"; paths: readonly string[] }>
	| Readonly<{ kind: "unavailable"; reason: string }>;
export type ReviewDocumentObservation =
	| Readonly<{ kind: "observed"; content: string; sha256: string }>
	| Readonly<{ kind: "unavailable"; reason: string }>;

const SENSITIVE_DOCUMENT_ASSIGNMENT =
	/(?:^|[\s"'`{,])((?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:token|password|passwd|secret|key|authorization)[A-Za-z0-9_-]*)\s*["'`]?\s*(:|=)\s*(["'`]?[\S]+)/gim;
const SENSITIVE_DOCUMENT_FIELD_NAME =
	/\b(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:token|password|passwd|secret|key|authorization|credential)[A-Za-z0-9_-]*\b/i;
const SENSITIVE_DOCUMENT_DISCLOSURE =
	/(?:^|[\s"'`{,])((?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:token|password|passwd|secret|key|authorization|credential)[A-Za-z0-9_-]*)\s*["'`]?\s+((?:is|was|are|were|equals?|contains?)\s+["'`]?[\S]+)/gim;
const SENSITIVE_INLINE_ASSIGNMENT =
	/(?:token|password|passwd|secret|key|authorization)\s*=/i;

function documentPrefixHasCodeFence(prefix: string): boolean {
	let fence: { marker: string; length: number } | null = null;
	for (const line of prefix.split("\n")) {
		const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (!match?.[1]) continue;
		if (!fence) {
			fence = { marker: match[1][0] ?? "", length: match[1].length };
		} else if (
			match[1][0] === fence.marker &&
			match[1].length >= fence.length &&
			!match[2]?.trim()
		) {
			fence = null;
		}
	}
	return fence !== null;
}

function documentPrefixHasBlockQuote(prefix: string): boolean {
	const lines = prefix.split(/\r\n?|\n/);
	const current = lines.pop() ?? "";
	const quotePrefix = /^ {0,3}(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(?:>[ \t]*)+/;
	let quotedParagraph = false;
	for (const line of lines) {
		const quote = quotePrefix.exec(line);
		if (quote) {
			quotedParagraph = line.slice(quote[0].length).trim() !== "";
		} else if (
			!line.trim() ||
			/^ {0,3}(?:`{3,}|~{3,})/.test(line) ||
			/^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:[-*+]|1[.)])[ \t]+\S)/.test(line)
		) {
			quotedParagraph = false;
		}
	}
	if (quotePrefix.test(current)) return true;
	return (
		quotedParagraph &&
		!/^ {0,3}(?:#{1,6}[ \t]|(?:[-*+]|1[.)])[ \t]+)/.test(current)
	);
}

function isPermissionStatusClause(
	content: string,
	fieldStart: number,
	predicateStart: number,
): boolean {
	const lineStart =
		Math.max(
			content.lastIndexOf("\n", fieldStart),
			content.lastIndexOf("\r", fieldStart),
		) + 1;
	const linePrefix = content.slice(lineStart, fieldStart);
	const predicateLineStart =
		Math.max(
			content.lastIndexOf("\n", predicateStart),
			content.lastIndexOf("\r", predicateStart),
		) + 1;
	const predicateLinePrefix = content.slice(predicateLineStart, predicateStart);
	const prefix = linePrefix.split(/[.;!?](?=\s|$)/).at(-1) ?? "";
	if (
		documentPrefixHasBlockQuote(content.slice(0, fieldStart)) ||
		/[`"']/.test(linePrefix) ||
		/^(?: {4}| {0,3}\t)/.test(linePrefix) ||
		/^(?: {4}| {0,3}\t)/.test(predicateLinePrefix) ||
		/^ {0,3}#{1,6}\s/.test(linePrefix) ||
		documentPrefixHasCodeFence(
			content.slice(0, fieldStart).replace(/\r\n?/g, "\n"),
		) ||
		!/^\s*(?:[-*+]\s+)?(?:(?:the|this|separate|explicit|prior|additional|user|human)\s+)*$/i.test(
			prefix,
		)
	)
		return false;
	const remainder = content.slice(predicateStart);
	const boundary = remainder.search(/[;.!?](?=\s|$)|[\r\n]/);
	const predicate = (
		boundary < 0 ? remainder : remainder.slice(0, boundary)
	).trim();
	return /^(?:is|was|are|were)\s+(?:not\s+)?(?:required|needed|necessary|pending|requested|granted|denied|obtained)\s+(?:before|for|to)\s+(?:(?:(?:the|this|product|code|test|gate)\s+)*(?:repairs?|inspection|review|modification|deployment)(?:\s+(?:work|task))?|(?:repair(?:ing)?|inspect(?:ing)?|review(?:ing)?|modify|modifying|change|changing|deploy(?:ing)?)\s+(?:(?:the|this|product|code|test|gate)\s+)*(?:files|code|product|tests|gate))$/i.test(
		predicate,
	);
}

function hasSensitiveDocumentAssignment(content: string): boolean {
	for (const match of content.matchAll(SENSITIVE_DOCUMENT_DISCLOSURE)) {
		const fieldStart = match.index + match[0].indexOf(match[1] ?? "");
		const predicateStart = match.index + match[0].lastIndexOf(match[2] ?? "");
		if (
			match[1]?.toLowerCase() !== "authorization" ||
			!isPermissionStatusClause(content, fieldStart, predicateStart)
		)
			return true;
	}
	for (const match of content.matchAll(SENSITIVE_DOCUMENT_ASSIGNMENT)) {
		const keyStart = match.index + match[0].indexOf(match[1] ?? "");
		const prefix = content.slice(
			content.lastIndexOf("\n", keyStart) + 1,
			keyStart,
		);
		const valueStart = match.index + match[0].lastIndexOf(match[3] ?? "");
		const value =
			content
				.slice(valueStart)
				.split(/\r?\n[ \t]*\r?\n|\r?\n(?= {0,3}#{1,6}[ \t])/, 1)[0] ?? "";
		const permissionBody = value.replace(
			/^(?:obtain|request|seek)\s+(?:(?:explicit|separate|prior)\s+)?authorization\b/,
			"permission",
		);
		const permissionClause =
			match[1] === "authorization" &&
			match[2] === ":" &&
			!SENSITIVE_DOCUMENT_FIELD_NAME.test(permissionBody) &&
			!/[`"']/.test(prefix) &&
			!documentPrefixHasCodeFence(content.slice(0, keyStart)) &&
			!/^(?: {4}|\t)/.test(prefix) &&
			/\b(?:require[sd]?|need[sd]?|await[sd]?|awaiting|pending|subject to)\s+(?:(?:separate|explicit|prior|additional|user|human)\s+)*$/i.test(
				prefix,
			) &&
			/^(?:(?:this|the|its|our|that)\s+(?:review|inspection|audit|roadmap|report|plan|document|task)(?:\s+(?:only|merely))?\s+(?:[a-z]+s|is|has|does)\b|(?:obtain|request|seek)\s+(?:(?:explicit|separate|prior)\s+)?(?:approval|permission|authorization)\b)/.test(
				value,
			);
		if (!permissionClause) return true;
	}
	return false;
}

const HOST_INTERNAL_DIRS = new Set([
	".git",
	".flow",
	".opencode",
	"node_modules",
]);
const ROOT_GENERATED_DIRS = new Set([
	"dist",
	"build",
	"coverage",
	"test-results",
	".next",
	".turbo",
	".cache",
]);

type WorkspaceEntry = Readonly<{
	kind: "file" | "symlink" | "directory";
	mode: number;
	identity: string | null;
}>;
export type WorkspaceSnapshot =
	| Readonly<{ kind: "captured"; entries: ReadonlyMap<string, WorkspaceEntry> }>
	| Readonly<{ kind: "unavailable"; reason: string }>;

export async function captureWorkspaceSnapshot(
	project: string,
): Promise<WorkspaceSnapshot> {
	const entries = new Map<string, WorkspaceEntry>();
	let totalBytes = 0;
	const visit = async (relative: string): Promise<void> => {
		const directory = join(project, relative);
		for (const item of await readdir(directory, { withFileTypes: true })) {
			if (
				HOST_INTERNAL_DIRS.has(item.name) ||
				(relative === "" && ROOT_GENERATED_DIRS.has(item.name))
			)
				continue;
			const path = relative ? `${relative}/${item.name}` : item.name;
			if (!isArtifactPath(path) || entries.size >= 10_000)
				throw new Error("invalid snapshot path");
			const target = join(project, path);
			const stat = await lstat(target);
			if (stat.isDirectory()) {
				entries.set(path, {
					kind: "directory",
					mode: stat.mode & 0o7777,
					identity: null,
				});
				await visit(path);
				continue;
			}
			let identity: string;
			let kind: WorkspaceEntry["kind"];
			if (stat.isSymbolicLink()) {
				kind = "symlink";
				identity = await readlink(target);
			} else if (stat.isFile()) {
				kind = "file";
				if (
					stat.size > 32 * 1024 * 1024 ||
					totalBytes + stat.size > 256 * 1024 * 1024
				)
					throw new Error("snapshot size limit");
				const handle = await open(
					target,
					constants.O_RDONLY | constants.O_NOFOLLOW,
				);
				try {
					const opened = await handle.stat();
					if (!opened.isFile()) throw new Error("snapshot file changed kind");
					const bytes = await handle.readFile();
					if (
						bytes.length > 32 * 1024 * 1024 ||
						totalBytes + bytes.length > 256 * 1024 * 1024
					)
						throw new Error("snapshot size limit");
					totalBytes += bytes.length;
					identity = createHash("sha256").update(bytes).digest("hex");
				} finally {
					await handle.close();
				}
			} else {
				throw new Error("unsupported snapshot entry");
			}
			entries.set(path, { kind, mode: stat.mode & 0o7777, identity });
		}
	};
	try {
		await visit("");
		return { kind: "captured", entries };
	} catch {
		return { kind: "unavailable", reason: "workspace-snapshot-failed" };
	}
}

export async function observeWorkspaceChanges(
	project: string,
	baseline: WorkspaceSnapshot,
): Promise<WorkspaceChangeObservation> {
	return compareWorkspaceSnapshots(
		baseline,
		await captureWorkspaceSnapshot(project),
	);
}

function compareWorkspaceSnapshots(
	baseline: WorkspaceSnapshot,
	current: WorkspaceSnapshot,
): WorkspaceChangeObservation {
	if (baseline.kind !== "captured")
		return { kind: "unavailable", reason: baseline.reason };
	if (current.kind !== "captured")
		return { kind: "unavailable", reason: current.reason };
	const paths = [
		...new Set([...baseline.entries.keys(), ...current.entries.keys()]),
	]
		.filter((path) => {
			const before = baseline.entries.get(path);
			const after = current.entries.get(path);
			return (
				before?.kind !== after?.kind ||
				before?.mode !== after?.mode ||
				before?.identity !== after?.identity
			);
		})
		.sort();
	return { kind: "observed", paths };
}

export async function observeReviewDocument(
	project: string,
	current: WorkspaceSnapshot,
): Promise<ReviewDocumentObservation> {
	const path = "docs/codebase-review.md";
	if (current.kind !== "captured" || current.entries.get(path)?.kind !== "file")
		return { kind: "unavailable", reason: "review-document-not-regular" };
	try {
		const target = join(project, path);
		const stat = await lstat(target);
		if (!stat.isFile() || stat.size > 64 * 1024)
			return {
				kind: "unavailable",
				reason: "review-document-not-regular-or-oversize",
			};
		const handle = await open(
			target,
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			if (!(await handle.stat()).isFile())
				return { kind: "unavailable", reason: "review-document-not-regular" };
			const bytes = await handle.readFile();
			if (bytes.length > 64 * 1024)
				return { kind: "unavailable", reason: "review-document-oversize" };
			const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
			if (
				current.entries.get(path)?.identity !== sha256.slice("sha256:".length)
			)
				return {
					kind: "unavailable",
					reason: "review-document-changed-after-snapshot",
				};
			const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			if (
				!Buffer.from(content, "utf8").equals(bytes) ||
				hasSensitiveDocumentAssignment(content) ||
				SENSITIVE_INLINE_ASSIGNMENT.test(content) ||
				pseudonymizeEvalIds(normalizeRecorded(content, project)) !== content
			)
				return {
					kind: "unavailable",
					reason: "review-document-not-safe-to-retain",
				};
			return {
				kind: "observed",
				content,
				sha256,
			};
		} finally {
			await handle.close();
		}
	} catch {
		return { kind: "unavailable", reason: "review-document-read-failed" };
	}
}

/**
 * One measurable claim about Flow, and everything needed to price it.
 *
 * The shape is deliberately small, because a scenario is an experiment and the
 * suite's credibility rests on each one being readable in a sitting: a fixture, a
 * sequence of commands, and a `check` that turns a finished run into a list of
 * failures. Anything a scenario cannot express in those terms is a scenario that
 * measures the harness instead of the product.
 *
 * The two optional fields are both about what a run is *allowed* to do, since a
 * scenario that scores every unusual ending as a failure reports prompt defects
 * that are not there.
 */
export type Scenario = {
	/** Stable across runs: report rows, cassette names, and the gate index it. */
	readonly id: string;
	/** The claim in one sentence, printed beside the rate it produced. */
	readonly description: string;
	/** Files seeded into the fixture repository before the first command. */
	readonly files: Readonly<Record<string, string>>;
	/** Commands sent in order; each waits for the session to go quiet. */
	readonly steps: readonly ScenarioStep[];
	readonly title?: string;
	readonly replayRequires?: readonly "native-host-provenance"[];
	/**
	 * Asking the user is an acceptable terminal state for this scenario, so a run
	 * that ends by asking is checked rather than excluded from the pass rate.
	 *
	 * Set it where the contract leaves the model no move of its own: a gate that
	 * cannot pass makes `completed` closure unavailable, and any other closure needs
	 * authority only the user can grant, so asking is the correct end — not a
	 * missing result. It is consulted only for a question the *last* step ended on:
	 * an earlier step's question is answered by the step after it, so it needs no
	 * permission here and costs the attempt nothing.
	 */
	readonly mayEscalate?: boolean;
	/** Returns a list of failures. Empty means the scenario passed. */
	readonly check: (outcome: ScenarioGradeInput) => readonly string[];
};

/**
 * The child host runs with its own XDG dirs so it never touches the developer's
 * session database, but OpenCode keeps provider credentials in that same data
 * directory. Without carrying `auth.json` over, every scenario fails on auth
 * instead of on behavior unless the provider also reads an env var.
 *
 * Only the credential file is copied, into a 0700 scratch directory that is
 * removed in `stop()`. Set `FLOW_EVAL_NO_AUTH_COPY=1` to opt out and rely purely
 * on environment credentials.
 *
 * Returns the source/target paths so `stop()` can sync any rotated tokens back,
 * or `null` when opted out. Some providers (observed for both OpenAI and xAI)
 * issue single-use, rotating OAuth refresh tokens: refreshing consumes the old
 * one and the provider revokes it. A child host that refreshes only updates its
 * own scratch copy, which `stop()` then deletes, so the real `auth.json` is left
 * holding a now-dead refresh token. The *next* host copies that same stale file
 * and fails outright, and — because the token was genuinely rotated against the
 * provider, not merely misplaced locally — the credential is dead for the
 * developer's own OpenCode too until they log in again. One recorded run lost
 * an xAI account's refresh token this way after a single scenario.
 */
export type CredentialSync = {
	readonly source: string;
	readonly target: string;
	/**
	 * The bytes this host was handed, or null when there was no file to copy.
	 *
	 * Kept for the whole life of the host because it is the only thing that can
	 * tell a token this host rotated from one it merely carried: at sync time the
	 * real file may already hold another host's newer credential, and the child
	 * copy cannot say which of its own entries are stale.
	 */
	readonly snapshot: string | null;
	readonly provider?: "openai" | "xai";
};

/**
 * The two ends of the credential copy: the developer's real file, and the child's.
 *
 * `XDG_DATA_HOME` is read from the *parent* environment rather than the child's,
 * which is the point — the child's is deliberately redirected into scratch, so
 * resolving the source there would find the empty copy instead of the original.
 */
function providerCredentialPaths(childData: string): {
	source: string;
	target: string;
} {
	const parentData =
		process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
	return {
		source: join(parentData, "opencode", "auth.json"),
		target: join(childData, "opencode", "auth.json"),
	};
}

/**
 * Copies the developer's credentials into a host's scratch home, remembering what
 * was copied so `syncProviderCredentialsBack` can tell a rotation from a carry.
 *
 * Returns null only when opted out, which is the one case where there is nothing to
 * sync. A missing source file is not that: the host still runs, the provider may
 * authenticate from the environment, and a login the child performs is still worth
 * carrying back.
 */
export async function carryProviderCredentials(
	childData: string,
	provider?: "openai" | "xai",
): Promise<CredentialSync | null> {
	if (process.env.FLOW_EVAL_NO_AUTH_COPY === "1") return null;
	const paths = providerCredentialPaths(childData);
	await mkdir(join(childData, "opencode"), { recursive: true, mode: 0o700 });
	let snapshot: string | null = null;
	try {
		// Read-then-write rather than `copyFile`, because the bytes handed to the
		// child have to be the same bytes remembered as the snapshot. Copying and
		// then reading the source again would let a concurrent host's sync land in
		// between, and the snapshot would describe a file this host never saw.
		snapshot = await readFile(paths.source, "utf8");
		if (provider) snapshot = selectProviderCredentials(snapshot, provider);
		await writeFile(paths.target, snapshot, { mode: 0o600 });
	} catch (error) {
		if (provider && (error as NodeJS.ErrnoException).code !== "ENOENT")
			throw new Error("Selected provider credentials unavailable.");
		// No stored credentials; the provider may still authenticate from the env.
	}
	return { ...paths, snapshot, ...(provider ? { provider } : {}) };
}

function selectProviderCredentials(
	contents: string,
	provider: "openai" | "xai",
): string {
	let entries: unknown;
	try {
		entries = JSON.parse(contents);
	} catch {
		throw new Error("Invalid provider credential store.");
	}
	if (!isRecord(entries)) throw new Error("Invalid provider credential store.");
	return JSON.stringify(
		Object.hasOwn(entries, provider) ? { [provider]: entries[provider] } : {},
	);
}

/**
 * The real file's contents with this host's own credential changes applied, or
 * null when it rotated nothing.
 *
 * Serializing the writes was only half the fix. Every host copies the same
 * snapshot, so a host that refreshed nothing still holds a full credential file,
 * and writing it back wholesale reverts every rotation that landed while it was
 * running. Concurrently that is the ordinary case rather than a corner: a matrix
 * runs one host per model, each authenticating to a different provider, so the
 * last host out would discard the other two providers' new refresh tokens — and
 * a discarded rotation is dead at the provider, not merely misplaced here.
 *
 * So a sync carries entries and not files. Per top-level key, which is per
 * provider in OpenCode's `auth.json`:
 *
 * - Changed against the snapshot: this host rotated it, so it wins.
 * - Equal to the snapshot: this host only carried it, so whatever the real file
 *   holds now wins — that is either the same value or a newer host's rotation.
 * - Present in the snapshot and gone from the child: the child logged out of it,
 *   which is a change like any other and is applied as a removal.
 * - Present in the real file and in neither: another host's new provider, left
 *   alone.
 *
 * With no snapshot there is nothing to diff against, so every child entry reads
 * as changed and merges over the current file. That is the pre-existing
 * behaviour, narrowed from the whole file to the keys the child actually holds.
 */
export function mergeCredentials(
	current: string,
	child: string,
	snapshot: string | null,
): string | null {
	const asRecord = (text: string | null): Record<string, unknown> | null => {
		if (text === null) return null;
		try {
			const parsed: unknown = JSON.parse(text);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	};
	const childEntries = asRecord(child);
	// The caller has already refused an unparseable child; a non-object one is the
	// same refusal, since there are no entries to carry out of it.
	if (!childEntries) return null;
	const currentEntries = asRecord(current);
	// Nothing coherent to merge into. Returning the child whole is the old
	// behaviour and the only one available, and it beats leaving a broken file.
	if (!currentEntries) return child;
	const before = asRecord(snapshot) ?? {};

	const merged: Record<string, unknown> = { ...currentEntries };
	const same = (left: unknown, right: unknown) =>
		JSON.stringify(left) === JSON.stringify(right);
	for (const [provider, value] of Object.entries(childEntries)) {
		if (!same(value, before[provider])) merged[provider] = value;
	}
	for (const provider of Object.keys(before)) {
		if (!(provider in childEntries)) delete merged[provider];
	}

	// A host that rotated nothing does not write at all, which is the common case
	// and the one worth not touching the developer's credential store over.
	if (same(merged, currentEntries)) return null;
	return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Serializes credential sync-backs, and counts them for unique temp names.
 *
 * Hosts run concurrently and every one of them ends in `stop()`, but they all
 * write the *same* real `auth.json`, so the syncs have to be made sequential
 * again by hand. Two concurrent `writeFile`s on one path can interleave and a
 * `rename` then publishes the mix — and the JSON check cannot catch that,
 * because it validates the child file before the write, not the bytes that
 * land.
 */
const syncCredentials = sequencer();
let credentialSyncCount = 0;

/**
 * Carries a host's rotated credentials back into the real `auth.json` it was
 * copied from, so a refresh propagates instead of being discarded with the
 * scratch directory — and so it propagates without reverting anyone else's.
 *
 * Four failure modes get guarded against explicitly, because what is being
 * overwritten is the developer's own live credential store, not scratch state:
 *
 * - A child copy that fails to parse as JSON must never replace a good file —
 *   this is what stands between a bug in a scenario and a broken `auth.json`.
 * - A host must not write back what it did not change. `mergeCredentials` says
 *   why at length; the short version is that every host holds a full copy of the
 *   same snapshot, so writing files instead of entries makes the last host out
 *   the one that decides, and revokes what the others rotated.
 * - The write itself goes to a temp file beside the real one and is `rename`d
 *   into place, which is atomic on the same filesystem. A plain overwrite that
 *   is interrupted (a kill, a crash, a lost power) would leave the real file
 *   truncated instead.
 * - Concurrent hosts must not write at once. Every call takes a temp path no
 *   other call can name and waits its turn in `syncCredentials`, so a parallel
 *   matrix run reads and replaces the file one host at a time — and a failed
 *   sync's cleanup can only ever remove its own temp file. The read of the real
 *   file happens inside that turn, since a merge that read it before waiting
 *   would compute its result against a file another host has since replaced.
 */
export async function syncProviderCredentialsBack(
	paths: CredentialSync | null,
): Promise<void> {
	if (!paths) return;
	credentialSyncCount += 1;
	const tempPath = `${paths.source}.eval-sync-${process.pid}-${credentialSyncCount}.tmp`;
	await syncCredentials(async () => {
		let contents: string;
		try {
			contents = await readFile(paths.target, "utf8");
		} catch (error) {
			// The child never wrote a credential file (no refresh happened, or the
			// provider authenticated purely from the env); nothing to carry back.
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		try {
			if (!isRecord(JSON.parse(contents))) throw new Error("Not an object");
		} catch {
			// Parser diagnostics can quote credentials. Report only the retained path.
			throw new Error(
				`Eval host credentials are invalid; retained at ${paths.target}.`,
			);
		}
		let current = paths.provider ? "{}" : "";
		try {
			current = await readFile(paths.source, "utf8");
		} catch (error) {
			// The real file is gone — the developer logged out mid-run, or there was
			// never one to copy. The child's own entries are all there is.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (paths.provider) {
			selectProviderCredentials(current, paths.provider);
			contents = selectProviderCredentials(contents, paths.provider);
		}
		const merged = mergeCredentials(current, contents, paths.snapshot);
		// Nothing this host rotated, so nothing to publish. Leaving the file alone is
		// the point: an untouched credential store cannot be damaged by a sync.
		if (merged === null) return;
		try {
			await writeFile(tempPath, merged, { mode: 0o600 });
			await rename(tempPath, paths.source);
		} catch (error) {
			// Preserve scratch on failure: its rotated credential may be the only
			// usable copy left. stop() must not remove it after a failed publication.
			console.error(
				`eval harness: could not sync credentials back to ${paths.source}: ${error instanceof Error ? error.message : String(error)}`,
			);
			await preservePrimaryFailure(
				() => Promise.reject(error),
				() => rm(tempPath, { force: true }),
			);
		}
	});
}

/**
 * Ports this process has already handed out.
 *
 * The kernel picks a free port for a listener that asks for 0, but that
 * listener has to be closed before the child server can take the port — and
 * once it is closed the same port is free to be picked again. Sequentially the
 * previous host still held its port, so a repeat was impossible; concurrently
 * two hosts can be handed one port and the second dies on bind. Remembering
 * what was handed out closes that, since all the hosts are in one process.
 */
const reservedPorts = new Set<number>();

/**
 * A loopback port no host in this process has been given yet.
 *
 * Bounded retries rather than a loop, because the kernel handing out a port this
 * process already reserved is a collision to skip, while twenty of them in a row
 * means something else is wrong and a hang would be the worst way to report it.
 */
async function availablePort(): Promise<number> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const server = createServer();
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		const port =
			address && typeof address !== "string" ? address.port : undefined;
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		if (port === undefined) break;
		if (reservedPorts.has(port)) continue;
		reservedPorts.add(port);
		return port;
	}
	throw new Error("Could not reserve a local port.");
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
	const pid = child.pid;
	if (pid === undefined) return;
	try {
		if (process.platform === "win32") {
			if (child.exitCode === null) child.kill(signal);
		} else {
			process.kill(-pid, signal);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

/**
 * Enumerating a process table is inherently racy: a member can exit between the
 * readdir and the read of its entry. Linux reports that as ENOENT when the
 * directory is already gone and ESRCH when the process is mid-reap, and both
 * mean the same thing here. Signalling already treats ESRCH as gone; teardown
 * enumeration once did not, so a host that exited promptly failed its own stop.
 */
export function processVanished(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ESRCH";
}

async function processGroupMembers(groupPid: number): Promise<number[]> {
	if (process.platform === "linux") {
		const entries = await readdir("/proc", { withFileTypes: true });
		const members = await Promise.all(
			entries
				.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
				.map(async (entry) => {
					try {
						const stat = await readFile(`/proc/${entry.name}/stat`, "utf8");
						const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
						return Number(fields[2]) === groupPid ? Number(entry.name) : null;
					} catch (error) {
						if (processVanished(error)) return null;
						throw error;
					}
				}),
		);
		return members.filter((member): member is number => member !== null);
	}
	const listed = spawnSync("ps", ["-axo", "pid=,pgid="], {
		encoding: "utf8",
	});
	if (listed.status !== 0 || typeof listed.stdout !== "string") return [];
	return listed.stdout.split("\n").flatMap((line) => {
		const [memberText, groupText] = line.trim().split(/\s+/);
		const member = Number(memberText);
		return Number.isInteger(member) && Number(groupText) === groupPid
			? [member]
			: [];
	});
}

async function signalProcessTreeDescendants(
	child: ChildProcess,
	signal: NodeJS.Signals,
): Promise<void> {
	const pid = child.pid;
	if (pid === undefined || process.platform === "win32") return;
	for (const member of await processGroupMembers(pid)) {
		if (member === pid) continue;
		try {
			process.kill(member, signal);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	}
}

async function processTreeAlive(child: ChildProcess): Promise<boolean> {
	const pid = child.pid;
	if (pid === undefined) return false;
	const childExited = child.exitCode !== null || child.signalCode !== null;
	if (process.platform === "win32") return !childExited;
	for (let probe = 0; ; probe++) {
		try {
			process.kill(-pid, 0);
			return true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ESRCH") return false;
			if (code !== "EPERM") throw error;
			if (probe === 5) {
				throw new Error(
					`Could not confirm eval host process tree ${pid} terminated: permission denied.`,
				);
			}
			await Bun.sleep(50);
		}
	}
}

export async function terminateChildProcessTree(
	child: ChildProcess,
): Promise<void> {
	if (!(await processTreeAlive(child))) return;
	const exited = new Promise<void>((resolve) =>
		child.once("exit", () => resolve()),
	);
	await signalProcessTreeDescendants(child, "SIGTERM");
	await Promise.race([exited, Bun.sleep(500)]);
	if (!(await processTreeAlive(child))) return;
	signalProcessTree(child, "SIGTERM");
	const gracefulDeadline = Date.now() + 3_000;
	while ((await processTreeAlive(child)) && Date.now() < gracefulDeadline) {
		await Bun.sleep(50);
	}
	if (await processTreeAlive(child)) {
		signalProcessTree(child, "SIGKILL");
		const killedDeadline = Date.now() + 1_000;
		while ((await processTreeAlive(child)) && Date.now() < killedDeadline) {
			await Bun.sleep(50);
		}
		if (await processTreeAlive(child)) {
			throw new Error(
				`Could not confirm eval host process tree ${child.pid} terminated after SIGKILL.`,
			);
		}
	}
	if (child.exitCode === null) {
		await Promise.race([exited, Bun.sleep(1_000)]);
	}
}

/**
 * A GET against the child host, with a non-2xx raised rather than returned.
 *
 * The body is read into the error on purpose: a failing host request is a harness
 * defect or a dead server, and the status alone has never been enough to tell
 * those apart from a scenario's own output.
 */
async function postJsonResponse(url: string, response: Response) {
	if (!response.ok) {
		throw new Error(
			`POST ${url} failed with ${response.status}: ${await response.text()}`,
		);
	}
	return response.json();
}

export async function postSessionJson(
	url: string,
	body: unknown,
	options: SessionPostOptions,
): Promise<unknown> {
	const init: SessionRequestInit = {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: options.signal,
		timeout: false,
	};
	const response = await (options.fetch ?? fetch)(url, init);
	return postJsonResponse(url, response);
}

/**
 * Splits `providerID/modelID` on the *first* slash only.
 *
 * A gateway provider's model id contains slashes of its own — `openrouter`
 * carries `openai/gpt-5.6-sol` — so splitting on the last slash, or on every
 * slash, silently addresses the wrong model.
 */
export function splitModel(
	model: string,
): Readonly<{ providerID: string; modelID: string }> {
	const boundary = model.indexOf("/");
	if (boundary <= 0 || boundary === model.length - 1) {
		throw new Error(
			`Model id "${model}" is not in providerID/modelID form, as OpenCode requires.`,
		);
	}
	return {
		providerID: model.slice(0, boundary),
		modelID: model.slice(boundary + 1),
	};
}

/**
 * True when every incomplete tool call is a question, so the session is waiting
 * on an answer that will never come.
 *
 * Any other incomplete call means work could still land, and a long command is
 * exactly that: `bash:running` alone, or beside a question, is progress waiting to
 * happen and must not end the step.
 */
export function onlyAwaitingAnswer(pending: readonly string[]): boolean {
	return (
		pending.length > 0 && pending.every((call) => call.startsWith("question:"))
	);
}

/**
 * One incomplete tool call, named well enough to diagnose after the run.
 *
 * `bash:running` was the whole diagnostic a wedged attempt left behind, and it does
 * not say whether the model armed something interactive or something slow. The
 * command is already in the recorded input, bounded to its first line here because
 * this goes into an error message. The tool name stays the prefix so
 * `onlyAwaitingAnswer` keeps matching.
 */
export function pendingCallLabel(part: {
	tool?: string;
	state?: { status: string; input?: Record<string, unknown> };
}): string {
	const label = `${part.tool ?? "tool"}:${part.state?.status}`;
	const command = part.state?.input?.command;
	const line =
		typeof command === "string" ? (command.split("\n")[0] ?? "") : "";
	if (line === "") return label;
	return `${label} (${line.length > 120 ? `${line.slice(0, 117)}...` : line})`;
}

export function isSelfAbortError(
	error: unknown,
	selfAborted: boolean,
): boolean {
	if (!selfAborted || !error || typeof error !== "object") return false;
	return isRecord(error) && error.type === ABORT_ERROR_NAME;
}

export function isWedged(
	pending: readonly string[],
	unchangedMs: number,
	thresholdMs: number,
): boolean {
	return pending.length > 0 && unchangedMs >= thresholdMs;
}

/**
 * A gate that runs what it is handed one job at a time, in the order handed to it.
 *
 * For work that is only safe alone: writing the developer's real `auth.json`, which
 * every host does on its way out and which concurrency turned from a sequence into
 * a race. A promise chain rather than a lock, because there is one thread — each
 * caller appends itself to the tail and waits on what is already there. The tail is
 * always a settled-either-way promise, or one rejection would strand every job
 * behind it.
 */
export function sequencer(): <T>(job: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(job: () => Promise<T>) => {
		const run = tail.then(job);
		tail = run.catch(() => {});
		return run;
	};
}

/**
 * Runs `queues` with at most `concurrency` of them in flight, each queue in order.
 *
 * The nesting is the contract. Attempts across queues are independent — every one
 * boots its own host on its own port over its own temp workspace — but a queue is
 * keyed by model, and running its own jobs one at a time is what keeps it from
 * racing itself for a single provider's rate limit. So queues go wide and jobs go
 * deep, never the other way around.
 */
export async function runQueues<Job, Result>(
	queues: readonly (readonly Job[])[],
	concurrency: number,
	run: (job: Job) => Promise<Result>,
	shouldStop?: (result: Result) => boolean,
	signal?: AbortSignal,
): Promise<Result[]> {
	const results: Result[] = [];
	let next = 0;
	let stopped = false;
	let failed = false;
	let failure: unknown;
	await Promise.all(
		Array.from(
			{ length: Math.max(1, Math.min(concurrency, queues.length)) },
			async () => {
				for (;;) {
					if (stopped || signal?.aborted) return;
					// Read and advance in one synchronous step, so no two workers can claim
					// the same queue.
					const queue = queues[next];
					next += 1;
					if (!queue) return;
					for (const job of queue) {
						if (stopped || signal?.aborted) return;
						try {
							const result = await run(job);
							results.push(result);
							if (shouldStop?.(result)) stopped = true;
						} catch (error) {
							if (signal?.aborted && error === signal.reason) return;
							if (!failed) failure = error;
							stopped = true;
							failed = true;
							return;
						}
					}
				}
			},
		),
	);
	if (failed) throw failure;
	return results;
}

/**
 * Everything the model asked the user, as recorded tool input.
 *
 * A model at a wall it may not climb puts the blocker in its question rather than
 * in a closing summary, so this is where the reasoning for an escalation lives —
 * both for a human judging whether asking was right and for a check that reads
 * whether the blocker was named at all.
 */
export function askedQuestions(outcome: Pick<Outcome, "allCalls">): string[] {
	return outcome.allCalls
		.filter((call) => call.tool === "question")
		.map((call) => JSON.stringify(call.input));
}

/**
 * Broad-scope claims the runtime refused, either for selecting which tests the
 * command runs or for not being the plan-declared gate.
 *
 * The declared gate closed a real hole, but it also added a rule a model can walk
 * into. Each refusal costs a turn, and no durable document can show one: the write
 * never happened. A run that recovers looks identical to a run that never erred.
 * Recovering is correct, so this is reported and never scored; a rising count means
 * the plan surface is not naming the gate clearly enough.
 */
export function refusedBroadScope(
	calls: readonly { readonly tool: string; readonly rawOutput: string }[],
): number {
	return calls.filter(
		(call) =>
			call.tool === "flow_validation_start" &&
			/A broad observation (?:cannot select|must run)/.test(call.rawOutput),
	).length;
}

/**
 * Indices where a call came from a different session than the one before it.
 *
 * Transcripts are joined into one spine for assertion, which erases the boundary
 * the recovery scenario turns on. Reporting the boundary keeps a failure of it
 * diagnosable without paying for another run.
 */
export function sessionBoundaries(
	calls: readonly { readonly sessionIndex: number }[],
): number[] {
	return calls.flatMap((call, index) =>
		index > 0 && call.sessionIndex !== calls[index - 1]?.sessionIndex
			? [index]
			: [],
	);
}

/**
 * Passes per attempt for each scenario and model pair, in run order. Provider and
 * host failures or an unallowed ask are excluded gaps; evaluator failures are
 * aborted measurements. Every scenario still gets a row.
 *
 */
export function passRates(
	results: readonly {
		readonly scenario: string;
		readonly model: string;
		readonly passed: boolean;
		readonly unscored?: boolean;
		readonly failure?: {
			readonly origin: "provider" | "host" | "evaluator";
		};
	}[],
): [string, PassRate][] {
	const rates = new Map<string, PassRate>();
	for (const result of results) {
		const label = `${result.scenario} @ ${result.model}`;
		const rate = rates.get(label) ?? {
			passed: 0,
			attempts: 0,
			unscored: 0,
			aborted: 0,
		};
		if (
			result.unscored ||
			result.failure?.origin === "provider" ||
			result.failure?.origin === "host"
		)
			rate.unscored += 1;
		else if (result.failure?.origin === "evaluator") rate.aborted += 1;
		else {
			rate.attempts += 1;
			if (result.passed) rate.passed += 1;
		}
		rates.set(label, rate);
	}
	return [...rates];
}

/**
 * One scenario-and-model pair's result, kept as four numbers rather than a ratio.
 *
 * The distinctions are the whole point, and collapsing any of them into the
 * denominator is a defect this suite has already shipped once. `attempts` counts
 * only what was scored, so it is not `passed + failed` plus everything else:
 * `unscored` is an attempt the scenario refused to judge, and `aborted` one that
 * never finished. Both are reasons to re-run a pair, not a smaller sample of it —
 * an excluded attempt once shrank a pair to two and let it clear a 100% threshold
 * on the two that remained.
 */
export type PassRate = {
	passed: number;
	/** Attempts that produced a judgeable result, which is the only honest base. */
	attempts: number;
	/** Attempts the scenario declined to score, e.g. an ask it does not allow. */
	unscored: number;
	/** Attempts that never finished: a wedge, a timeout, a lost turn. */
	aborted: number;
};

/** One pass-rate row. Nothing scored says so, rather than reading as `0/0`. */
export function formatRate(rate: PassRate): string {
	const excluded = [
		rate.unscored > 0 ? `${rate.unscored} excluded` : "",
		rate.aborted > 0 ? `${rate.aborted} aborted` : "",
	].filter(Boolean);
	const suffix = excluded.length === 0 ? "" : `  ${excluded.join(", ")}`;
	if (rate.attempts === 0) return `nothing scored${suffix}`;
	const flaky = rate.passed > 0 && rate.passed < rate.attempts ? "  FLAKY" : "";
	return `${rate.passed}/${rate.attempts}${flaky}${suffix}`;
}

/**
 * The cost to report, or null when the provider priced nothing.
 *
 * `total` is null when no message carried a cost at all. Zero needs the same
 * treatment: a provider that does not price a run reports `cost: 0` rather than
 * omitting the field, and every OpenAI run measured here did exactly that, so
 * checking only for an absent number printed `$0.0000` over real spend. A run that
 * has no reported token use can report zero. Any metered category makes a zero
 * estimate unknown. Historical outputTokens fields retain the host output bucket.
 */
export function reportedCost(
	total: number | null,
	tokens: number | Outcome["tokens"],
): number | null {
	if (total === null) return null;
	const used =
		typeof tokens === "number"
			? tokens > 0
			: Object.values(tokens).some((count) => count > 0);
	return total > 0 || !used ? total : null;
}

/** Reduces a host error payload to one readable line. */
function summarizeError(failure: unknown): string {
	if (typeof failure === "string") return failure;
	if (failure && typeof failure === "object") {
		const record = failure as Record<string, unknown>;
		const data = record.data as Record<string, unknown> | undefined;
		const message = data?.message ?? record.message ?? record.name;
		if (typeof message === "string" && message.trim()) {
			return message.split("\n")[0] ?? message;
		}
	}
	return JSON.stringify(failure);
}

function providerErrorObservation(
	failure: unknown,
	sessionId: string,
): ProviderErrorObservation | null {
	if (typeof failure === "string" && failure.trim()) {
		return { sessionId, name: "provider-error", message: failure };
	}
	if (!failure || typeof failure !== "object") return null;
	const record = failure as Record<string, unknown>;
	const data =
		record.data && typeof record.data === "object"
			? (record.data as Record<string, unknown>)
			: undefined;
	const name = data?.name ?? record.type ?? record.name;
	const message = data?.message ?? record.message;
	if (typeof name !== "string" || !name.trim()) return null;
	return {
		sessionId,
		name,
		message:
			typeof message === "string" && message.trim()
				? message
				: summarizeError(failure),
	};
}

/** Packs the working tree once and reuses the tarball across every run. */
export async function packPlugin(
	repositoryRoot: string,
	into: string,
	toolchain: BunToolchain,
): Promise<string> {
	const build = runPinnedBunSync(toolchain, ["run", "build"], {
		cwd: repositoryRoot,
	});
	if (build.status !== 0)
		throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);
	const pack = runPinnedBunSync(
		toolchain,
		["pm", "pack", "--destination", into],
		{
			cwd: repositoryRoot,
		},
	);
	if (pack.status !== 0)
		throw new Error(`pack failed:\n${pack.stdout}\n${pack.stderr}`);
	const manifest = JSON.parse(
		await readFile(join(repositoryRoot, "package.json"), "utf8"),
	);
	return join(into, `opencode-plugin-flow-${manifest.version}.tgz`);
}

/**
 * Installs the packed tarball once into a template of OpenCode's exact-version
 * package cache, which every host then copies.
 *
 * Installing per host made one `bun install` per attempt, all of them reaching the
 * registry for the same bytes: a fifteen-attempt pass took fifteen network round
 * trips, and a single blip killed an attempt that had already paid for its host
 * boot. Five consecutive attempts were lost this way in one recorded run.
 */
export async function preparePackageCache(
	tarball: string,
	into: string,
	toolchain: BunToolchain,
): Promise<string> {
	const version = exactPackageVersion(
		(await packedPackageManifest(tarball)).version,
	);
	const digest = (await tarballSha256(tarball)).replace(":", "-");
	const cache = join(into, digest, `opencode-plugin-flow@${version}`);
	await mkdir(cache, { recursive: true });
	await writeFile(
		join(cache, "package.json"),
		`${JSON.stringify({ dependencies: { "opencode-plugin-flow": `file:${tarball}` } }, null, 2)}\n`,
		"utf8",
	);
	const install = runPinnedBunSync(toolchain, ["install"], {
		cwd: cache,
	});
	if (install.status !== 0)
		throw new Error(`cache install failed:\n${install.stderr}`);
	return cache;
}

type MessageEntry = EvalMessage;

type OwnedProgressSession = {
	id: string;
	messages: readonly MessageEntry[];
	metadata?: SessionInfo;
};
type NativeCommandObservation = {
	scope: NativeExecutionScope;
	metadata: SessionInfo | null;
	stop: "observing" | "question-escalated";
};
function isProgressId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		!/\s/.test(value)
	);
}
function activeProgressSnapshot(
	sessions: readonly OwnedProgressSession[],
	completedMessages: Set<string>,
	completedParts: Set<string>,
) {
	const active: string[] = [];
	const messageIds = new Set<string>();
	const partIds = new Set<string>();
	const toolCallIds = new Set<string>();
	for (const session of sessions) {
		for (const entry of session.messages) {
			const message = entry.info.id;
			if (
				!isProgressId(message) ||
				entry.info.sessionID !== session.id ||
				messageIds.has(message)
			)
				throw new Error("Owned progress transcript is malformed.");
			messageIds.add(message);
			for (const [partIndex, part] of entry.parts.entries()) {
				if (
					!isProgressId(part.type) ||
					part.sessionID !== session.id ||
					part.messageID !== message ||
					partIds.has(canonicalJson([message, partIndex]))
				)
					throw new Error("Owned progress transcript is malformed.");
				if (
					part.type === "tool" &&
					(!isProgressId(part.tool) ||
						!isProgressId(part.callID) ||
						!part.state ||
						!["pending", "running", "completed", "error"].includes(
							part.state.status,
						))
				)
					throw new Error("Owned progress tool is malformed.");
				if (part.type === "tool") {
					const callKey = canonicalJson([session.id, message, part.callID]);
					if (toolCallIds.has(callKey))
						throw new Error("Owned progress tool is malformed.");
					toolCallIds.add(callKey);
				}
				partIds.add(canonicalJson([message, partIndex]));
			}
			const messageKey = canonicalJson([session.id, message]);
			if (
				(entry.native.type !== "assistant" &&
					!(
						entry.native.type === "compaction" &&
						entry.native.status === "running"
					)) ||
				entry.info.time?.completed !== undefined
			)
				completedMessages.add(messageKey);
			if (completedMessages.has(messageKey)) continue;
			active.push(canonicalJson([messageKey, "assistant"]));
			for (const [partIndex, part] of entry.parts.entries()) {
				const key = canonicalJson([session.id, message, partIndex]);
				const terminal =
					part.time?.end !== undefined ||
					(part.type === "tool" &&
						(part.state?.status === "completed" ||
							part.state?.status === "error"));
				if (terminal) completedParts.add(key);
				if (completedParts.has(key)) continue;
				let value: unknown = null;
				if (part.type === "text" || part.type === "reasoning") {
					if (typeof part.text !== "string")
						throw new Error("Owned progress content is malformed.");
					value = part.text;
				} else if (part.type === "tool") {
					if (!part.state || !isRecord(part.state.input))
						throw new Error("Owned progress tool input is malformed.");
					if (
						part.state.status === "pending" &&
						part.state.raw !== undefined &&
						typeof part.state.raw !== "string"
					)
						throw new Error("Owned progress pending arguments are malformed.");
					value = [
						part.tool,
						part.callID,
						part.state.status,
						part.state.input,
						part.state.status === "pending" ? (part.state.raw ?? "") : null,
					];
				}
				active.push(
					canonicalJson([
						key,
						part.type,
						createHash("sha256").update(canonicalJson(value)).digest("hex"),
					]),
				);
			}
		}
	}
	return createHash("sha256")
		.update(
			canonicalJson([
				active.toSorted(),
				[...completedMessages].sort(),
				[...completedParts].sort(),
			]),
		)
		.digest("hex");
}

type SessionMessages = ObservedSession & {
	readonly messages: readonly MessageEntry[] | null;
};

export type EvalReviewerOptions = Readonly<{
	model?: string;
	variant?: string;
	steps?: number;
}>;

export class EvalHost {
	private server: ChildProcess | null = null;
	private workspaceBaseline: WorkspaceSnapshot | null = null;
	private retainReviewDocument = false;
	private serverLog = "";
	private baseUrl = "";
	private nativeClient: OpenCodeClient | null = null;
	get client(): OpenCodeClient {
		if (!this.nativeClient) throw new Error("OpenCode client is not ready.");
		return this.nativeClient;
	}
	private lastSelfAbortAt = 0;
	private commandAbortObservation: HostAbortObservation | undefined;
	private readonly nativeCommands = new Map<string, NativeCommandObservation>();
	private polledNativeFailure: {
		sessionId: string;
		failure: NativeExecutionFailure;
		sessions: readonly OwnedProgressSession[];
		childrenComplete: boolean;
	} | null = null;
	private readonly escalationQuestions = new Map<string, EpisodeQuestion>();
	escalationQuestion(sessionId: string): EpisodeQuestion {
		const question = this.escalationQuestions.get(sessionId);
		if (!question) throw new Error("No captured escalation question.");
		return structuredClone(question);
	}

	private artifacts:
		| { paths: HostArtifactPaths; identity: HostArtifacts }
		| undefined;
	private verifiedArtifacts: HostArtifactVerification | undefined;
	get artifactVerification(): HostArtifactVerification | undefined {
		return this.verifiedArtifacts
			? structuredClone(this.verifiedArtifacts)
			: undefined;
	}
	get artifactIdentity(): HostArtifacts | undefined {
		return this.artifacts
			? structuredClone(this.artifacts.identity)
			: undefined;
	}
	private async verifyArtifacts() {
		if (this.artifacts)
			await verifyHostArtifacts(
				this.artifacts.paths,
				this.artifacts.identity,
				this.signal,
				this.server?.pid,
			);
	}
	readonly project: string;
	private readonly scratch: string;
	private credentialHandoff:
		| {
				before: readonly CredentialEntry[];
				onStop: (input: {
					before: readonly CredentialEntry[];
					after: readonly CredentialEntry[];
				}) => Promise<void>;
		  }
		| undefined;
	private nativeAuthSource:
		| ReturnType<typeof connectNativeAccountSource>
		| undefined;
	private nativeAuthHost: NativeAuthHost | undefined;
	private polledProviderFailure: {
		sessionId: string;
		messages: MessageEntry[];
		failure: AttemptFailure<"provider">;
		observation: ProviderErrorObservation | null;
	} | null = null;
	private stopPromise: Promise<void> | undefined;
	private projectRetention: ((project: string) => Promise<void>) | undefined;
	private readonly signal: AbortSignal | undefined;

	private constructor(project: string, scratch: string, signal?: AbortSignal) {
		this.project = project;
		this.scratch = scratch;
		this.signal = signal;
	}

	/** Boots a throwaway OpenCode host over a git fixture. */
	static async start(options: {
		toolchain: BunToolchain;
		frozenArtifacts?: { opencodeExecutable: string; identity: HostArtifacts };
		frozenTreatmentBundle?: { bytes: Uint8Array; sha256: string };
		/** Prepared by `preparePackageCache`, copied in rather than reinstalled. */
		packageCache: string;
		packageVersion?: string;
		reviewerEnvironment?: "inherit" | "disabled";
		ambientConfig?: "inherit" | "disabled";
		opencodeVersion: string;
		opencodeExecutable?: string;
		files: Readonly<Record<string, string>>;
		retainReviewDocument?: boolean;
		/** Configures the hidden reviewer through the native plugin options. */
		reviewer?: EvalReviewerOptions;
		/** False creates the paired benchmark's ordinary OpenCode control host. */
		withFlow?: boolean;
		providerCredentials?: "inherit" | "disabled";
		nativeAuthentication?: NativeAuthentication;
		credentialHandoff?: {
			entries: readonly CredentialEntry[];
			onStop: (input: {
				before: readonly CredentialEntry[];
				after: readonly CredentialEntry[];
			}) => Promise<void>;
		};
		recoveryTreatment?: RecoveryTreatment;
		requestBudget?: {
			scope?: EpisodeReservationScope;
			directory: string;
			authorizationDigest: string;
			managerModel: "openai/gpt-6-sol" | "xai/grok-4.6";
		};
		signal?: AbortSignal;
	}): Promise<EvalHost> {
		checkCancellation(options.signal);
		validateOpenCodeVersion(options.opencodeVersion);
		if (options.frozenArtifacts) {
			const { signal, credentialHandoff, ...configuration } = options;
			options = {
				...structuredClone(configuration),
				...(signal ? { signal } : {}),
				...(credentialHandoff ? { credentialHandoff } : {}),
			};
		}
		if (options.requestBudget)
			options = {
				...options,
				requestBudget: {
					...options.requestBudget,
					directory: resolve(options.requestBudget.directory),
					...(options.requestBudget.scope
						? {
								scope: Object.freeze(
									EpisodeReservationScopeSchema.parse(
										options.requestBudget.scope,
									),
								),
							}
						: {}),
				},
			};
		const frozenArtifacts = options.frozenArtifacts
			? structuredClone(options.frozenArtifacts)
			: undefined;
		if (frozenArtifacts)
			frozenArtifacts.identity = HostArtifactsSchema.parse(
				frozenArtifacts.identity,
			);
		checkCancellation(options.signal);
		if (options.recoveryTreatment)
			options = {
				...options,
				recoveryTreatment: RecoveryTreatmentSchema.parse(
					options.recoveryTreatment,
				),
			};
		const liveTreatment = options.recoveryTreatment?.origin === "live";
		const simulationTreatment =
			options.recoveryTreatment?.origin === "simulation";
		const frozenTreatmentBundle = options.frozenTreatmentBundle
			? {
					bytes: new Uint8Array(options.frozenTreatmentBundle.bytes),
					sha256: options.frozenTreatmentBundle.sha256,
				}
			: undefined;
		if (frozenTreatmentBundle) {
			if (
				!liveTreatment ||
				createHash("sha256")
					.update(frozenTreatmentBundle.bytes)
					.digest("hex") !== frozenTreatmentBundle.sha256
			)
				throw new Error("Frozen treatment bundle differs from registration.");
		}
		const jevKey =
			liveTreatment && options.recoveryTreatment?.arm === "manager-plus-jev"
				? options.toolchain.environment.TYPESAFE_API_KEY
				: undefined;
		if (
			liveTreatment &&
			!["inherit", "disabled"].includes(options.providerCredentials ?? "")
		)
			throw new Error(
				"Live treatment requires an explicit provider credential policy.",
			);
		if (
			liveTreatment &&
			options.recoveryTreatment?.arm === "manager-plus-jev" &&
			!jevKey
		)
			throw new Error("Live evaluation credential unavailable.");
		if (options.recoveryTreatment) {
			await validateTreatmentBudget(
				options.recoveryTreatment,
				options.requestBudget,
				options.signal,
			);
			if (options.withFlow === false)
				throw new Error("Treatment requires Flow composition.");
		}
		if (options.requestBudget) {
			const budget = await requestBudgetStatus(
				options.requestBudget.directory,
				options.signal,
			);
			if (
				budget.authorizationDigest !==
					options.requestBudget.authorizationDigest ||
				budget.cancelled ||
				Date.parse(budget.authorization.expiresAt) <= Date.now() ||
				!budget.authorization.models.some(
					(row) => row.model === options.requestBudget?.managerModel,
				)
			)
				throw new Error("Invalid host request budget.");
			if (options.opencodeVersion !== "2.1.4")
				throw new Error("Request gate is verified only for OpenCode 2.1.4.");
		}
		const version = exactPackageVersion(
			options.packageVersion ?? packageJson.version,
		);
		const scratch = await mkdtemp(join(tmpdir(), "workspace-"));
		const project = join(scratch, "project");
		const host = new EvalHost(project, scratch, options.signal);
		host.retainReviewDocument = options.retainReviewDocument === true;
		try {
			checkCancellation(options.signal);
			await chmod(scratch, 0o700);
			const childHome = join(scratch, "home");
			const childCache = join(scratch, "cache");
			const childData = join(childHome, ".local", "share");
			await mkdir(childHome, { recursive: true });
			await mkdir(join(scratch, "tmp"));
			await mkdir(join(project, ".opencode"), { recursive: true });
			const gitConfig = join(scratch, "gitconfig");
			const gitHooks = join(scratch, "git-hooks");
			await writeFile(gitConfig, "");
			await mkdir(gitHooks);
			const environment: NodeJS.ProcessEnv = {
				...Object.fromEntries(
					Object.entries(
						options.recoveryTreatment
							? { PATH: options.toolchain.environment.PATH }
							: options.toolchain.environment,
					).filter(([name]) => !name.startsWith("GIT_")),
				),
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: gitConfig,
			};
			delete environment.FLOW_EVAL_AUTHORIZATION;
			delete environment.TYPESAFE_API_KEY;
			delete environment.FLOW_EVAL_NATIVE_AUTH;
			if (options.nativeAuthentication) {
				for (const name of Object.keys(environment))
					if (name.startsWith("OPENCODE_")) delete environment[name];
				const configurationDirectory = join(childHome, ".config", "opencode");
				await mkdir(configurationDirectory, { recursive: true, mode: 0o700 });
				await writeFile(
					join(configurationDirectory, "opencode.json"),
					JSON.stringify({
						warming: false,
						update: "disable",
						share: "disabled",
					}),
					{ mode: 0o600 },
				);
			}

			if (options.ambientConfig === "disabled" || options.requestBudget) {
				for (const name of [
					"OPENCODE_CONFIG",
					"OPENCODE_CONFIG_CONTENT",
					"OPENCODE_CONFIG_DIR",
				])
					delete environment[name];
			}
			if (options.nativeAuthentication) {
				if (
					options.credentialHandoff ||
					options.providerCredentials === "disabled" ||
					simulationTreatment
				)
					throw new Error(
						"Native authentication requires exclusive credential ownership.",
					);
				host.nativeAuthSource = connectNativeAccountSource(
					options.nativeAuthentication.configuration,
				);
				host.nativeAuthHost = await host.nativeAuthSource.prepareHost({
					directory: join(scratch, "native-auth"),
					models: options.nativeAuthentication.models,
					...(options.signal ? { signal: options.signal } : {}),
				});
				await writeFile(
					join(childHome, ".config", "opencode", "opencode.json"),
					JSON.stringify({
						warming: false,
						update: "disable",
						share: "disabled",
						plugins: [host.nativeAuthHost.plugin],
					}),
					{ mode: 0o600 },
				);
				options = {
					...options,
					providerCredentials: "inherit",
					credentialHandoff: host.nativeAuthHost.credentialHandoff,
				};
			}
			if (
				options.credentialHandoff &&
				(options.providerCredentials === "disabled" || simulationTreatment)
			)
				throw new Error("Native credentials are disabled for this host.");
			if (
				options.providerCredentials === "inherit" &&
				!options.credentialHandoff
			)
				throw new Error(
					"V2 credential inheritance requires an explicit native credentialHandoff; auth.json is unsupported.",
				);

			// Flow derives source identity from git, so the fixture must be a repo.
			for (const [relative, contents] of Object.entries(options.files)) {
				checkCancellation(options.signal);
				const target = join(project, relative);
				await mkdir(join(target, ".."), { recursive: true });
				await writeFile(target, contents, "utf8");
			}
			for (const argv of [
				["init", "--initial-branch=main"],
				["config", "user.email", "project@example.invalid"],
				["config", "user.name", "Project"],
				["add", "-A"],
				["commit", "-m", "fixture"],
			]) {
				checkCancellation(options.signal);
				const git = spawnSync(
					"git",
					[
						"-c",
						`core.hooksPath=${gitHooks}`,
						"-c",
						"commit.gpgSign=false",
						"-c",
						"tag.gpgSign=false",
						...argv,
					],
					{ cwd: project, encoding: "utf8", env: environment },
				);
				if (git.status !== 0)
					throw new Error(`git ${argv[0]} failed:\n${git.stderr}`);
			}

			// Copy rather than race filesystem writes against cancellation: cleanup
			// must wait until no copy can recreate scratch after its removal.
			if (frozenArtifacts) {
				if (
					frozenArtifacts.identity.bun.version !==
						options.toolchain.actualVersion ||
					frozenArtifacts.identity.opencode.version !==
						options.opencodeVersion ||
					(frozenArtifacts.identity.packageCache === null) !==
						(Boolean(options.recoveryTreatment) || options.withFlow === false)
				)
					throw new Error("Host artifact configuration mismatch.");
				if (
					options.recoveryTreatment &&
					JSON.stringify(
						process.platform === "linux"
							? await processArtifactFile(process.pid, options.signal)
							: await artifactFile(
									await realpath(process.execPath),
									options.signal,
								),
					) !== JSON.stringify(frozenArtifacts.identity.bun.bytes)
				)
					throw new Error(
						"Treatment builder differs from registered Bun bytes.",
					);
				const paths = await stageHostArtifacts({
					paths: {
						bun: options.toolchain.executable,
						opencode: frozenArtifacts.opencodeExecutable,
						packageCache:
							frozenArtifacts.identity.packageCache === null
								? null
								: options.packageCache,
					},
					expected: frozenArtifacts.identity,
					directory: join(scratch, "bin"),
					packageCache:
						frozenArtifacts.identity.packageCache === null
							? null
							: join(
									childCache,
									"opencode",
									"packages",
									`opencode-plugin-flow@${version}`,
								),
					signal: options.signal,
				});
				host.artifacts = { paths, identity: frozenArtifacts.identity };
				environment.PATH = `${dirname(paths.bun)}${delimiter}${environment.PATH ?? ""}`;
			} else if (options.withFlow !== false && !options.recoveryTreatment) {
				const packages = join(childCache, "opencode", "packages");
				await mkdir(packages, { recursive: true });
				await cp(
					options.packageCache,
					join(packages, `opencode-plugin-flow@${version}`),
					{
						recursive: true,
						filter: () => {
							checkCancellation(options.signal);
							return true;
						},
					},
				);
			}
			checkCancellation(options.signal);
			let pluginEntry =
				options.withFlow !== false && !options.recoveryTreatment
					? await installedOpenCodePluginEntry(
							join(
								childCache,
								"opencode",
								"packages",
								`opencode-plugin-flow@${version}`,
								"node_modules",
								"opencode-plugin-flow",
							),
							join(scratch, "flow-plugin-entry"),
						)
					: "";
			let treatmentBundleDigest: string | undefined;
			if (options.recoveryTreatment) {
				if (frozenTreatmentBundle) {
					const destination = join(scratch, "treatment", "index.js");
					await mkdir(dirname(destination), { recursive: true });
					await writeFile(destination, frozenTreatmentBundle.bytes);
					checkCancellation(options.signal);
					pluginEntry = dirname(destination);
					treatmentBundleDigest = frozenTreatmentBundle.sha256;
				} else {
					const built = await Bun.build({
						entrypoints: [
							fileURLToPath(
								new URL(
									liveTreatment
										? "./recovery-decisions/live-treatment-plugin.ts"
										: "./recovery-decisions/treatment-plugin.ts",
									import.meta.url,
								),
							),
						],
						outdir: join(scratch, "treatment"),
						target: "bun",
						format: "esm",
						minify: false,
					});
					checkCancellation(options.signal);
					if (!built.success || !built.outputs[0])
						throw new Error("Evaluation treatment bundle failed.");
					await rename(
						built.outputs[0].path,
						join(scratch, "treatment", "index.js"),
					);
					pluginEntry = join(scratch, "treatment");
					treatmentBundleDigest = createHash("sha256")
						.update(await readFile(join(scratch, "treatment", "index.js")))
						.digest("hex");
				}
			}

			const budgetEntry = join(scratch, "budget-plugin");
			if (options.requestBudget && !liveTreatment) {
				await mkdir(budgetEntry);
				await writeFile(
					join(budgetEntry, "index.ts"),
					`export { default } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./recovery-decisions/budget-plugin.ts", import.meta.url))).href)};\n`,
				);
			}

			const pluginOptions = options.recoveryTreatment
				? {
						...(liveTreatment
							? { origin: "live" }
							: { treatment: options.recoveryTreatment }),
						budget: options.requestBudget,
						readyPath: join(scratch, "treatment-ready.json"),
						budgetReadyPath: join(scratch, "budget-ready.json"),
					}
				: options.reviewer
					? { reviewer: options.reviewer }
					: {};
			const httpTransportEntry = join(scratch, HTTP_TRANSPORT_PLUGIN_ID);
			if (options.withFlow === false) {
				await mkdir(httpTransportEntry);
				await writeFile(
					join(httpTransportEntry, "index.ts"),
					`export { default } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./http-transport-plugin.ts", import.meta.url))).href)};\n`,
				);
			}
			const plugins = [
				...(options.requestBudget && !liveTreatment
					? [
							{
								package: budgetEntry,
								options: {
									directory: options.requestBudget.directory,
									authorizationDigest:
										options.requestBudget.authorizationDigest,
									...(options.requestBudget.scope
										? { scope: options.requestBudget.scope }
										: {}),
									readyPath: join(scratch, "budget-ready.json"),
									...(simulationTreatment
										? {
												simulationScript:
													options.recoveryTreatment?.origin === "simulation"
														? options.recoveryTreatment.script
														: undefined,
											}
										: {}),
								},
							},
						]
					: []),
				...(options.withFlow === false
					? [{ package: httpTransportEntry }]
					: [{ package: pluginEntry, options: pluginOptions }]),
			];
			const permissions = releaseHostPermissions(version);
			if (permissions !== undefined && !Array.isArray(permissions))
				throw new Error("Active evals require a V2 host permission policy.");
			await writeFile(
				join(project, "opencode.json"),
				`${JSON.stringify({ plugins, ...(permissions ? { permissions } : {}) }, null, 2)}\n`,
				"utf8",
			);

			return await evaluationPhase(
				"host",
				"host-start-failed",
				true,
				async () => {
					const port = await availablePort();
					checkCancellation(options.signal);
					host.baseUrl = `http://127.0.0.1:${port}`;
					await host.verifyArtifacts();
					checkCancellation(options.signal);
					const args = [
						"serve",
						"--hostname",
						"127.0.0.1",
						"--port",
						String(port),
					];
					const invocation = host.artifacts
						? { command: host.artifacts.paths.opencode, args }
						: options.opencodeExecutable
							? { command: options.opencodeExecutable, args }
							: openCodeInvocation(args, options.opencodeVersion);
					host.server = spawn(invocation.command, invocation.args, {
						cwd: project,
						detached: process.platform !== "win32",
						env: {
							...environment,
							...(jevKey ? { TYPESAFE_API_KEY: jevKey } : {}),
							...(options.reviewerEnvironment === "disabled"
								? {
										OPENCODE_FLOW_REVIEWER_MODEL: "",
										OPENCODE_FLOW_REVIEWER_VARIANT: "",
										OPENCODE_FLOW_REVIEWER_STEPS: "",
									}
								: {}),
							HOME: childHome,
							TMPDIR: join(scratch, "tmp"),
							XDG_CACHE_HOME: childCache,
							XDG_CONFIG_HOME: join(childHome, ".config"),
							XDG_DATA_HOME: childData,
							XDG_STATE_HOME: join(childHome, ".local", "state"),
						},
						stdio: ["ignore", "pipe", "pipe"],
					});
					const startup = new OpenCodeStartup();
					let loggedBytes = 0;
					const record = (chunk: unknown, stream: string) => {
						startup.consume(String(chunk), stream);
						const safe = startup.log;
						host.serverLog += safe.slice(loggedBytes);
						loggedBytes = safe.length;
					};
					host.server.stdout?.on("data", (chunk) => record(chunk, "stdout"));
					host.server.stderr?.on("data", (chunk) => record(chunk, "stderr"));
					let spawnError: Error | undefined;
					host.server.once("error", (error) => {
						spawnError = error;
					});

					const deadline = Date.now() + STARTUP_TIMEOUT_MS;
					const versionMismatch = new Error(
						"OpenCode reports an unexpected version.",
					);
					for (;;) {
						checkCancellation(options.signal);
						if (spawnError) throw spawnError;
						try {
							const client = startup.client(host.baseUrl, project);
							if (client) {
								const healthSignal = AbortSignal.any([
									...(options.signal ? [options.signal] : []),
									AbortSignal.timeout(3000),
								]);
								const health = await abortable(healthSignal, () =>
									client.server.info({ signal: healthSignal }),
								);
								if (health.version !== options.opencodeVersion)
									throw versionMismatch;
								host.nativeClient = client;
								startup.clear();
								break;
							}
						} catch (error) {
							if (
								error instanceof CampaignCancelled ||
								error === versionMismatch ||
								(options.signal?.aborted && error === options.signal.reason)
							)
								throw error;
						}
						if (Date.now() > deadline) {
							throw new Error(
								`OpenCode did not become healthy.\n${host.serverLog}`,
							);
						}
						await abortable(options.signal, () => Bun.sleep(500));
					}
					const ready = await host.nativeRequest(
						(request) =>
							host.client.session.create(
								{
									title: "flow-eval readiness",
									location: { directory: project },
								},
								request,
							),
						options.signal ?? null,
						Math.max(1, deadline - Date.now()),
					);
					await host.deleteSession(ready.id);
					await host.nativeRequest(
						(request) =>
							host.client.config.get(
								{ location: { directory: project } },
								request,
							),
						options.signal ?? null,
						Math.max(1, deadline - Date.now()),
					);
					const expectedPlugins = new Set(
						await Promise.all(
							[
								...(host.nativeAuthHost ? [host.nativeAuthHost.plugin] : []),
								...plugins,
							].map((plugin) => realpath(plugin.package)),
						),
					);
					for (;;) {
						checkCancellation(options.signal);
						if (Date.now() >= deadline)
							throw new Error(
								"Native evaluation plugins did not become active before the startup deadline.",
							);
						const observed = await host.nativeRequest(
							(request) =>
								host.client.plugin.list(
									{ location: { directory: project } },
									request,
								),
							options.signal ?? null,
							Math.max(1, deadline - Date.now()),
						);
						const active = new Set<string>();
						for (const plugin of observed.data) {
							if (plugin.source.type !== "local") continue;
							const path = await realpath(plugin.source.path);
							const entry = expectedPlugins.has(path)
								? path
								: /[/\\]index\.(?:ts|js)$/.test(path) &&
										expectedPlugins.has(dirname(path))
									? dirname(path)
									: null;
							if (!entry) continue;
							if (plugin.state.status === "failed")
								throw new Error(
									"An expected native evaluation plugin failed to load.",
								);
							active.add(entry);
						}
						if ([...expectedPlugins].every((path) => active.has(path))) break;
						await abortable(options.signal, () =>
							Bun.sleep(Math.min(20, Math.max(1, deadline - Date.now()))),
						);
					}
					if (options.credentialHandoff) {
						const before = structuredClone(options.credentialHandoff.entries);
						host.credentialHandoff = {
							before,
							onStop: options.credentialHandoff.onStop,
						};
						for (const entry of before) {
							await host.client.credential.create(
								{
									id: entry.id,
									integrationID: entry.integrationID,
									label: entry.label,
									value: entry.value,
									activate: entry.active,
								},
								host.requestOptions(),
							);
						}
					}
					if (options.requestBudget) {
						const receipt = JSON.parse(
							await readFile(join(scratch, "budget-ready.json"), "utf8"),
						);
						if (
							receipt.scopeDigest !==
								(options.requestBudget.scope
									? datasetDigest(options.requestBudget.scope)
									: null) ||
							receipt.authorizationDigest !==
								options.requestBudget.authorizationDigest ||
							(receipt.pid !== host.server.pid &&
								(!host.server.pid ||
									process.platform === "win32" ||
									!(await processGroupMembers(host.server.pid)).includes(
										receipt.pid,
									)))
						)
							throw new Error(
								"Request gate did not initialize in the host process.",
							);
					}
					if (options.recoveryTreatment) {
						const receipt = JSON.parse(
							await readFile(join(scratch, "treatment-ready.json"), "utf8"),
						);
						const budgetReceipt = JSON.parse(
							await readFile(join(scratch, "budget-ready.json"), "utf8"),
						);
						if (
							receipt.pid !== budgetReceipt.pid ||
							receipt.authorizationDigest !==
								options.requestBudget?.authorizationDigest ||
							(simulationTreatment &&
								receipt.treatmentDigest !==
									datasetDigest(options.recoveryTreatment)) ||
							(liveTreatment &&
								(budgetReceipt.origin !== "live" ||
									budgetReceipt.scriptDigest !== null ||
									receipt.scopeDigest !==
										datasetDigest(options.requestBudget?.scope) ||
									receipt.qualification !== "experimental-evaluation" ||
									receipt.profileDigest !==
										(options.recoveryTreatment.arm === "manager-plus-jev"
											? datasetDigest(ExperimentalLiveProfile)
											: null))) ||
							receipt.pluginEntrySha256 !== treatmentBundleDigest ||
							receipt.origin !== options.recoveryTreatment.origin ||
							receipt.arm !== options.recoveryTreatment.arm
						)
							throw new Error(
								"Treatment did not initialize with the expected identity.",
							);
						if (simulationTreatment) {
							const integrationID =
								options.requestBudget?.managerModel.split("/")[0];
							if (!integrationID)
								throw new Error(
									"Simulation manager integration is unavailable.",
								);
							const integration = await host.client.integration.get(
								{ integrationID },
								host.requestOptions(),
							);
							const method = integration.data.methods.find(
								(method) => method.type === "oauth",
							);
							if (method?.type !== "oauth")
								throw new Error(
									"Simulation requires a native OAuth integration method.",
								);
							await host.client.credential.create(
								{
									integrationID,
									label: "Isolated simulated evaluation",
									activate: true,
									value: {
										type: "oauth",
										methodID: method.id,
										access: "simulation-access",
										refresh: "simulation-refresh",
										expires: Date.now() + 3600000,
									},
								},
								host.requestOptions(),
							);
						}
					}
					checkCancellation(options.signal);
					await host.verifyArtifacts();
					checkCancellation(options.signal);
					if (host.artifacts)
						host.verifiedArtifacts = {
							manifestDigest: datasetDigest(host.artifacts.identity),
							method:
								process.platform === "linux"
									? "copied-files-and-linux-process"
									: "copied-files-and-direct-spawn",
						};
					host.workspaceBaseline = await captureWorkspaceSnapshot(project);
					return host;
				},
			);
		} catch (error) {
			return preservePrimaryFailure<EvalHost>(
				() => Promise.reject(error),
				() => host.stop(),
			);
		}
	}

	private requestOptions(signal = this.signal, timeout = REQUEST_TIMEOUT_MS) {
		return {
			signal: AbortSignal.any([
				...(signal ? [signal] : []),
				AbortSignal.timeout(timeout),
			]),
		};
	}

	private nativeRequest<T>(
		operation: (options: { signal: AbortSignal }) => Promise<T>,
		signal: AbortSignal | null = this.signal ?? null,
		timeout = REQUEST_TIMEOUT_MS,
	): Promise<T> {
		const options = {
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
				: AbortSignal.timeout(timeout),
		};
		return abortable(options.signal, () => operation(options));
	}

	get log(): string {
		return this.serverLog;
	}

	get url(): string {
		return this.baseUrl;
	}

	/**
	 * Model ids the child host lists in its catalog, as `providerID/modelID`.
	 *
	 * This is a spelling check, not an entitlement check. OpenCode builds the
	 * catalog from Models.dev overlaid with configured providers, so an id appears
	 * here whenever the provider is configured and the catalog knows the model —
	 * whether or not the stored credential may actually call it. Use
	 * `probeModel` to establish that.
	 */
	async catalogModels(): Promise<string[]> {
		return (await this.catalogProfiles()).map((profile) => profile.model);
	}

	async catalogProfiles(): Promise<
		Array<{ model: string; variants: string[] | null }>
	> {
		const listed = await this.nativeRequest((options) =>
			this.client.model.list(
				{ location: { directory: this.project } },
				options,
			),
		);
		return listed.data
			.filter((model) => model.enabled)
			.map((model) => ({
				model: `${model.providerID}/${model.id}`,
				variants: model.variants.map((variant) => variant.id),
			}));
	}

	/**
	 * Sends one tiny real completion and reports why it failed, or `null` when the
	 * model answered.
	 *
	 * A catalog hit does not prove the credential is entitled to the model, which
	 * matters most for a freshly released or preview-gated model: the id resolves,
	 * the run starts, and the provider rejects the first request partway into a
	 * paid pass. One near-free request converts that into an upfront failure.
	 */
	async probeModel(
		model: string,
		options?: {
			variant?: string;
			onDispatch?: () => void;
			observeUsage?: (usage: StudyUsage) => void;
		},
	): Promise<string | null> {
		await this.verifyArtifacts();
		const sessionId = await this.createSession(`flow-eval probe ${model}`);
		let usage = normalizeStudyUsage({ tokens: {}, costUsd: null });
		try {
			checkCancellation(this.signal);
			await consumePaidDispatch({ model, kind: "probe" });
			options?.onDispatch?.();
			await this.nativeRequest((request) =>
				this.client.session.switchModel(
					{ sessionID: sessionId, model: nativeModel(model, options?.variant) },
					request,
				),
			);
			await this.nativeRequest((request) =>
				this.client.session.prompt(
					{
						sessionID: sessionId,
						text: "Reply with the single word OK. Call no tools.",
					},
					request,
				),
			);
			await this.nativeRequest((request) =>
				this.client.session.wait({ sessionID: sessionId }, request),
			);
			const entries = await this.messages(sessionId, this.signal);
			const reply = entries.findLast(
				(entry) => entry.native.type === "assistant",
			);
			if (!reply) throw new Error("Model probe produced no assistant message.");
			const tokens = reply.info?.tokens;
			usage = normalizeStudyUsage({
				tokens: tokens
					? {
							input: tokens.input,
							output: tokens.output,
							reasoning: tokens.reasoning,
							...(tokens.cache
								? {
										cacheRead: tokens.cache.read,
										cacheWrite: tokens.cache.write,
									}
								: {}),
						}
					: {},
				costUsd: reply.info?.cost,
			});
			const failure = reply.info?.error;
			return failure ? summarizeError(failure) : null;
		} catch (error) {
			if (error instanceof CampaignCancelled) {
				await this.abortSession(sessionId);
				throw error;
			}
			return error instanceof Error ? error.message : String(error);
		} finally {
			await this.deleteSession(sessionId);
			options?.observeUsage?.(usage);
		}
	}

	private async deleteSession(sessionId: string): Promise<void> {
		await this.nativeRequest(
			(options) =>
				this.client.session.remove({ sessionID: sessionId }, options),
			null,
			ABORT_TIMEOUT_MS,
		).catch(() => {});
	}

	async createSession(title: string): Promise<string> {
		const session = await this.nativeRequest((options) =>
			this.client.session.create(
				{ title, agent: "build", location: { directory: this.project } },
				options,
			),
		);
		return session.id;
	}

	private async commandObservation(
		sessionId: string,
	): Promise<NativeCommandObservation> {
		if (this.polledNativeFailure?.sessionId === sessionId)
			this.polledNativeFailure = null;
		let metadata: SessionInfo | null = null;
		try {
			const observed = await this.nativeRequest((options) =>
				this.client.session.get({ sessionID: sessionId }, options),
			);
			if (isRecord(observed) && observed.id === sessionId) metadata = observed;
		} catch (error) {
			if (this.signal?.aborted && error === this.signal.reason) throw error;
		}
		const messages = await this.messages(sessionId, this.signal);
		const last = messages.at(-1);
		if (last && !isProgressId(last.info.id))
			throw new Error("Native command boundary is malformed.");
		const observation: NativeCommandObservation = {
			metadata,
			scope: { sessionId, afterMessageId: last?.info.id ?? null },
			stop: "observing",
		};
		this.nativeCommands.set(sessionId, observation);
		return observation;
	}

	/**
	 * Sends one slash command and returns when the session has been quiet for
	 * `quietMs`. The quiet window (rather than a single idle event) is what lets
	 * `/flow-auto` auto-continuation run to its natural stopping point.
	 */
	async runCommand(
		sessionId: string,
		command: string,
		args: string,
		model: string,
		options: {
			quietMs?: number;
			timeoutMs?: number;
			stalledMs?: number;
			variant?: string;
		} = {},
	): Promise<CommandEnd> {
		this.commandAbortObservation = undefined;
		checkCancellation(this.signal);
		await this.verifyArtifacts();
		checkCancellation(this.signal);
		this.escalationQuestions.delete(sessionId);
		await consumePaidDispatch({ model, kind: "command" });
		await this.nativeRequest((request) =>
			this.client.session.switchModel(
				{ sessionID: sessionId, model: nativeModel(model, options.variant) },
				request,
			),
		);
		const { variant: _variant, ...waitOptions } = options;
		const observation = await this.commandObservation(sessionId);
		return runSessionRequest({
			signal: this.signal,
			waitOwnsCancellation: true,
			onCancelled: () => this.abortSession(sessionId),
			post: (_url, _body, request) =>
				this.client.session.command(
					{ sessionID: sessionId, name: command, text: args },
					{ signal: request.signal },
				),
			url: this.baseUrl,
			body: null,
			onRejected: (message) => {
				this.serverLog += `\ncommand POST rejected: ${message}`;
			},
			wait: (request) =>
				this.waitForQuiet(sessionId, {
					...waitOptions,
					request,
					observation,
				}),
		});
	}

	/** Sends an ordinary user prompt for the benchmark control arm. */
	async runPrompt(
		sessionId: string,
		prompt: string,
		model: string,
		options: {
			quietMs?: number;
			timeoutMs?: number;
			stalledMs?: number;
			variant?: string;
		} = {},
	): Promise<CommandEnd> {
		this.commandAbortObservation = undefined;
		checkCancellation(this.signal);
		await this.verifyArtifacts();
		checkCancellation(this.signal);
		this.escalationQuestions.delete(sessionId);
		await consumePaidDispatch({ model, kind: "prompt" });
		await this.nativeRequest((request) =>
			this.client.session.switchModel(
				{ sessionID: sessionId, model: nativeModel(model, options.variant) },
				request,
			),
		);
		const { variant: _variant, ...waitOptions } = options;
		const observation = await this.commandObservation(sessionId);
		return runSessionRequest({
			signal: this.signal,
			waitOwnsCancellation: true,
			onCancelled: () => this.abortSession(sessionId),
			post: (_url, _body, request) =>
				this.client.session.prompt(
					{ sessionID: sessionId, text: prompt },
					{ signal: request.signal },
				),
			url: this.baseUrl,
			body: null,
			onRejected: (message) => {
				this.serverLog += `\nmessage POST rejected: ${message}`;
			},
			wait: (request) =>
				this.waitForQuiet(sessionId, {
					...waitOptions,
					request,
					observation,
				}),
		});
	}

	private async waitForQuiet(
		sessionId: string,
		options: {
			quietMs?: number;
			timeoutMs?: number;
			stalledMs?: number;
			request: SessionRequest;
			observation: NativeCommandObservation;
		},
	): Promise<CommandEnd> {
		this.commandAbortObservation = undefined;
		const startedAt = Date.now();
		const completedMessages = new Set<string>();
		const completedParts = new Set<string>();
		let activitySignature = "";
		let lastSessions: readonly OwnedProgressSession[] = [];
		let rootMessages: readonly MessageEntry[] = [];
		let treeComplete = false;
		let observedAt = startedAt;
		const quietMs = options.quietMs ?? 25_000;
		const timeoutMs = options.timeoutMs ?? 20 * 60_000;
		const stalledMs = Math.min(options.stalledMs ?? STALLED_MS, timeoutMs);
		const poll = 2_000;
		// Deadlines are wall-clock, so suspending the machine mid-scenario blows
		// them the instant it resumes and reports a hang that never happened. An
		// iteration that took far longer than its own sleep is time this process
		// did not observe, so it is credited back to every deadline rather than
		// charged to the model.
		const suspendFloor = poll * 10;
		let deadline = Date.now() + timeoutMs;
		let signature = "";
		let settledAt = Date.now();
		// Tracked separately from `settledAt`, which `busy` alone keeps alive: one
		// tool part wedged in `running` resets the quiet timer forever while nothing
		// progresses. Without this, a genuinely stuck session and a model looping
		// productively both time out with the same message and neither is
		// diagnosable after the fact.
		let changedAt = Date.now();
		let pending: string[] = [];
		let ownedPending: string[] = [];
		let suspendedMs = 0;
		const pinNativeFailure = (): NativeExecutionFailure | null => {
			if (
				options.observation.stop === "question-escalated" ||
				this.polledProviderFailure?.sessionId === sessionId
			)
				return null;
			const rootTrace = collectHostTrace({
				runnerRootSessionIds: [sessionId],
				directory: this.project,
				sessionMetadata: options.observation.metadata
					? [options.observation.metadata]
					: [],
				sessionMessages: [
					{ sessionId, messages: rootMessages.map((entry) => entry.native) },
				],
				childrenComplete: true,
			});
			const failure = nativeExecutionFailure(
				nativeExecution(rootTrace, [options.observation.scope]),
			);
			if (failure)
				this.polledNativeFailure = {
					sessionId,
					failure,
					sessions: structuredClone(lastSessions),
					childrenComplete: treeComplete,
				};
			return failure;
		};
		const abortWait = async (inspectNative = true) => {
			const failure = inspectNative ? pinNativeFailure() : null;
			const cleanup = async () => {
				const aborting = this.abortSession(sessionId);
				options.request.cancel();
				await aborting;
			};
			if (failure)
				return preservePrimaryFailure(
					() => Promise.reject(new EvaluationPhaseError(failure, undefined)),
					cleanup,
				);
			await cleanup();
		};
		const suspensionNote = () =>
			suspendedMs > 0
				? ` Excluded ${Math.round(suspendedMs / 1_000)}s this process did not observe, most likely machine suspend.`
				: "";
		const wedgeNote = (elapsedMs: number) =>
			`No observed activity for ${Math.round(elapsedMs / 1_000)}s while these tool calls stayed incomplete: ${ownedPending.join(", ") || "none"}. Activity does not establish useful progress.`;
		const captureAbort = (kind: "stall" | "deadline") => {
			const pending: HostAbortObservation["pending"] = [];
			for (const session of lastSessions)
				for (const entry of session.messages)
					for (const [partIndex, part] of entry.parts.entries()) {
						if (
							part.type !== "tool" ||
							(part.state?.status !== "running" &&
								part.state?.status !== "pending")
						)
							continue;
						const native = nativeToolProvenance(
							session.id,
							entry.info,
							part,
							partIndex,
							entry.native,
						);
						if (!native || !part.tool || !isRecord(part.state.input)) return;
						pending.push({
							native,
							tool: part.tool,
							status: part.state.status,
							input: part.state.input,
						});
					}
			const abortRequestedAt = Date.now();
			const trigger =
				kind === "stall"
					? {
							kind,
							unchangedMs: abortRequestedAt - changedAt,
							lastActivityAt: changedAt,
							thresholdMs: stalledMs,
						}
					: {
							kind,
							observedElapsedMs: abortRequestedAt - startedAt - suspendedMs,
							timeoutMs,
						};
			const candidate = {
				rootSessionId: sessionId,
				observedAt,
				abortRequestedAt,
				startedAt,
				excludedMs: suspendedMs,
				trigger,
				pending,
			};
			if (Buffer.byteLength(JSON.stringify(candidate)) > 256 * 1024) return;
			const result = HostAbortObservationSchema.safeParse(candidate);
			this.commandAbortObservation = result.success
				? structuredClone(result.data)
				: undefined;
		};
		const failDeadline = async (): Promise<never> => {
			const stalled = Date.now() - changedAt;
			const [count = "0", parts = "0"] = signature.split(":");
			captureAbort("deadline");
			await abortWait();
			throw new Error(
				(stalled >= quietMs
					? `Scenario exceeded ${timeoutMs}ms without going quiet. ${wedgeNote(stalled)}`
					: `Scenario exceeded ${timeoutMs}ms without going quiet. Observed activity continued near the deadline (${count} messages, ${parts} parts). This does not establish useful progress.`) +
					suspensionNote(),
			);
		};
		try {
			for (;;) {
				treeComplete = false;
				const before = Date.now();
				let accountedInPoll = 0;
				const accountPollElapsed = () => {
					const elapsed = Date.now() - before;
					if (elapsed < suspendFloor) return;
					const credit = Math.min(
						Math.max(0, elapsed - accountedInPoll),
						timeoutMs - suspendedMs,
					);
					accountedInPoll = elapsed;
					suspendedMs += credit;
					deadline += credit;
					settledAt += credit;
					changedAt += credit;
				};
				await abortable(this.signal, () => Bun.sleep(poll));
				const delivery = options.request.state();
				if (delivery?.kind === "rejected") {
					throw delivery.error;
				}
				const messages = (await this.messages(
					sessionId,
					this.signal,
				)) as MessageEntry[];
				rootMessages = messages;
				lastSessions = [
					{
						id: sessionId,
						messages,
						...(options.observation.metadata
							? { metadata: options.observation.metadata }
							: {}),
					},
					...lastSessions.filter((session) => session.id !== sessionId),
				];
				const failed = messages.find(
					(entry) =>
						(entry.native.type === "assistant" ||
							entry.native.type === "compaction") &&
						entry.info.error &&
						!isSelfAbortError(
							entry.info.error,
							this.lastSelfAbortAt > 0 &&
								(entry.info.time?.created === undefined ||
									entry.info.time.created <= this.lastSelfAbortAt),
						),
				);
				if (failed) {
					const failure = providerFailure(failed.info.error);
					this.polledProviderFailure = {
						sessionId,
						messages,
						failure,
						observation: providerErrorObservation(failed.info.error, sessionId),
					};
					await abortWait(false);
					throw new EvaluationPhaseError(failure, failed.info.error);
				}
				accountPollElapsed();
				const remaining = deadline - Date.now();
				if (remaining < 0) await failDeadline();
				if (remaining === 0) continue;
				const observerDeadline = AbortSignal.timeout(remaining);
				let sessions: readonly OwnedProgressSession[];
				try {
					sessions = await this.ownedProgressSessions(
						sessionId,
						messages,
						AbortSignal.any([
							...(this.signal ? [this.signal] : []),
							observerDeadline,
						]),
						options.observation.metadata,
					);
				} catch (error) {
					accountPollElapsed();
					if (this.signal?.aborted && error === this.signal.reason) throw error;
					if (observerDeadline.aborted && error === observerDeadline.reason) {
						if (Date.now() < deadline) continue;
						await failDeadline();
					}
					await abortWait();
					throw error;
				}
				accountPollElapsed();
				lastSessions = sessions;
				treeComplete = true;
				observedAt = Date.now();
				let nextActivity: string;
				try {
					nextActivity = activeProgressSnapshot(
						sessions,
						completedMessages,
						completedParts,
					);
				} catch (error) {
					await abortWait();
					throw error;
				}
				const ownedMessages = sessions.flatMap((session) => session.messages);
				pending = messages.flatMap((entry) =>
					entry.parts
						.filter(
							(part) =>
								part.type === "tool" &&
								part.state?.status &&
								part.state.status !== "completed" &&
								part.state.status !== "error",
						)
						.map((part) => pendingCallLabel(part)),
				);
				ownedPending = ownedMessages.flatMap((entry) =>
					entry.parts
						.filter(
							(part) =>
								part.type === "tool" &&
								part.state?.status &&
								part.state.status !== "completed" &&
								part.state.status !== "error",
						)
						.map((part) => pendingCallLabel(part)),
				);
				const busy =
					delivery?.kind === "pending" ||
					ownedPending.length > 0 ||
					ownedMessages.some(
						(entry) =>
							(entry.native.type === "assistant" &&
								!entry.native.time.completed) ||
							(entry.native.type === "compaction" &&
								entry.native.status === "running"),
					);
				const counts = sessions
					.map((session) => ({
						id: session.id,
						messages: session.messages.length,
						parts: session.messages.reduce(
							(total, entry) => total + entry.parts.length,
							0,
						),
					}))
					.toSorted((left, right) => left.id.localeCompare(right.id));
				const next = `${ownedMessages.length}:${ownedMessages.reduce((total, entry) => total + entry.parts.length, 0)}:${JSON.stringify(counts)}`;
				const changed = nextActivity !== activitySignature;
				activitySignature = nextActivity;
				signature = next;
				if (changed) changedAt = Date.now();
				if (changed || busy) settledAt = Date.now();
				else if (Date.now() - settledAt >= quietMs) {
					if (pinNativeFailure()) await abortWait();
					return "quiet";
				}
				const unansweredQuestionReachedQuiet =
					onlyAwaitingAnswer(pending) && Date.now() - changedAt >= quietMs;
				if (unansweredQuestionReachedQuiet) {
					const captured = EpisodeQuestionSchema.safeParse({
						sessionId,
						calls: messages.flatMap((entry) =>
							entry.parts
								.filter(
									(part) =>
										part.type === "tool" &&
										part.tool === "question" &&
										(part.state?.status === "running" ||
											part.state?.status === "pending"),
								)
								.map((part) => ({
									messageId: part.messageID ?? entry.info.id,
									callId: part.callID,
									input: part.state?.input,
								})),
						),
					});
					if (captured.success)
						this.escalationQuestions.set(sessionId, captured.data);
					options.observation.stop = "question-escalated";
					await abortWait(false);
					return "escalated";
				}
				const stalled = Date.now() - changedAt;
				if (isWedged(ownedPending, stalled, stalledMs)) {
					captureAbort("stall");
					await abortWait();
					throw new Error(
						`Scenario had no observed activity for ${stalledMs}ms. ${wedgeNote(stalled)}${suspensionNote()}`,
					);
				}
				if (Date.now() > deadline) {
					await failDeadline();
				}
			}
		} catch (error) {
			if (
				!(error instanceof EvaluationPhaseError) &&
				options.request.state().kind !== "rejected" &&
				pinNativeFailure()
			)
				await abortWait();
			throw error;
		}
	}

	private async ownedProgressSessions(
		root: string,
		messages: readonly MessageEntry[],
		signal: AbortSignal,
		rootMetadata: SessionInfo | null,
	): Promise<readonly OwnedProgressSession[]> {
		const listed = await this.nativeRequest(
			(options) =>
				listNativeSessions(this.client, this.project, options.signal),
			signal ?? null,
		);
		const ids = [root];
		const known = new Set(ids);
		for (const parent of ids) {
			for (const child of listed) {
				if (
					child?.parentID !== parent ||
					!isProgressId(child.id) ||
					typeof child.location?.directory !== "string" ||
					known.has(child.id) ||
					(await realpath(child.location.directory)) !==
						(await realpath(this.project))
				)
					continue;
				if (known.size >= 128)
					throw new Error("Owned progress tree exceeds 128 sessions.");
				known.add(child.id);
				ids.push(child.id);
			}
		}
		const sessions: OwnedProgressSession[] = [
			{
				id: root,
				messages,
				...(rootMetadata ? { metadata: rootMetadata } : {}),
			},
		];
		for (const id of ids.slice(1)) {
			const metadata = listed.find((session) => session.id === id);
			sessions.push({
				id,
				messages: await this.messages(id, signal),
				...(metadata ? { metadata } : {}),
			});
		}
		return sessions;
	}

	/**
	 * Ends a wait this harness will not win, and remembers that it did.
	 *
	 * The timestamp is what keeps `outcome` from reporting Flow's own abort as a
	 * host error. Stamped before the request rather than after it, because a
	 * rejected POST does not mean the abort failed to land — and because every
	 * message the abort can be blamed for was already created by now.
	 */
	private async abortSession(sessionId: string): Promise<void> {
		this.lastSelfAbortAt = Date.now();
		const observation = this.nativeCommands.get(sessionId);
		if (observation)
			observation.scope = {
				...observation.scope,
				abort: {
					requestedAt: this.lastSelfAbortAt,
					priorFailure:
						this.polledNativeFailure?.sessionId === sessionId ||
						this.polledProviderFailure?.sessionId === sessionId,
				},
			};
		await this.nativeRequest(
			(options) =>
				this.client.session.interrupt(
					{ sessionID: sessionId, resume: false },
					options,
				),
			null,
			ABORT_TIMEOUT_MS,
		).catch(() => {});
	}

	private async messages(
		sessionId: string,
		signal?: AbortSignal,
	): Promise<MessageEntry[]> {
		return (
			await this.nativeRequest(
				(options) => listNativeMessages(this.client, sessionId, options.signal),
				signal ?? null,
			)
		).map((message) => projectEvalMessage(message, sessionId));
	}

	/**
	 * Every session descended from the given ones, breadth-first, appended after
	 * them.
	 *
	 * A reviewer runs as a subtask in a child session, so its transcript is not in
	 * the parent's. Reading only the parents left the whole independent review
	 * invisible: no recorded report contained a single `flow_feature_complete` call,
	 * and the check for submissions the runtime rejected could never fire.
	 *
	 * A host that does not expose children yields nothing rather than failing —
	 * losing the subtask transcript is a smaller loss than losing the run.
	 */
	private async descendantSessions(
		sessionIds: readonly string[],
		signal?: AbortSignal,
	): Promise<{
		readonly sessions: readonly ObservedSession[];
		readonly endpointFailed: boolean;
		readonly metadata: readonly unknown[];
	}> {
		let listed: SessionInfo[];
		try {
			listed = await this.nativeRequest(
				(options) =>
					listNativeSessions(this.client, this.project, options.signal),
				signal ?? null,
			);
		} catch (error) {
			if (signal?.aborted) throw error;
			return { sessions: [], endpointFailed: true, metadata: [] };
		}
		const known = new Set(sessionIds);
		const found: ObservedSession[] = [];
		const metadata: SessionInfo[] = [];
		const frontier = [...sessionIds];
		for (const parent of frontier) {
			for (const child of listed) {
				if (
					child.parentID !== parent ||
					known.has(child.id) ||
					(await realpath(child.location.directory)) !==
						(await realpath(this.project))
				)
					continue;
				if (known.size >= 128)
					throw new Error("Outcome tree exceeds 128 sessions.");
				known.add(child.id);
				frontier.push(child.id);
				metadata.push(child);
				found.push({
					id: child.id,
					agent: child.agent ?? null,
					parentID: child.parentID ?? null,
				});
			}
		}
		return { sessions: found, endpointFailed: false, metadata };
	}

	/**
	 * Collects the durable and observed outcome a scenario asserts against.
	 *
	 * Sessions are read in the order they were used, their subtask sessions appended
	 * after them, and every transcript merged in message-creation order — so a
	 * scenario that resumes in a fresh session, or dispatches a reviewer subtask,
	 * still sees one continuous tool-call spine in the order the calls happened.
	 *
	 * Merging by time rather than by session matters for the subtasks: a reviewer's
	 * submission belongs between the manager's review dispatch and whatever the
	 * manager did next, and appending it at the end would record a sequence no run
	 * ever performed.
	 */
	async outcome(
		sessionIds: readonly string[],
		durationMs: number,
		// Deliberately explicit, not this.signal: evidence after a real failure
		// must remain readable even when the campaign has been stopped.
		signal?: AbortSignal,
	): Promise<Outcome> {
		const polled =
			this.polledProviderFailure &&
			sessionIds.includes(this.polledProviderFailure.sessionId)
				? this.polledProviderFailure
				: null;
		const nativePin =
			!polled &&
			this.polledNativeFailure &&
			sessionIds.includes(this.polledNativeFailure.sessionId)
				? this.polledNativeFailure
				: null;
		let nativeFailure = nativePin?.failure ?? null;
		const pinned = polled !== null || nativePin !== null;
		if (!pinned) checkCancellation(signal);
		const descendantResult = nativePin
			? {
					sessions: nativePin.sessions.flatMap((session) =>
						session.metadata && !sessionIds.includes(session.id)
							? [
									{
										id: session.id,
										agent: session.metadata.agent ?? null,
										parentID: session.metadata.parentID ?? null,
									},
								]
							: [],
					),
					endpointFailed: !nativePin.childrenComplete,
					metadata: nativePin.sessions.flatMap((session) =>
						session.metadata ? [session.metadata] : [],
					),
				}
			: polled
				? { sessions: [], endpointFailed: false, metadata: [] }
				: await this.descendantSessions(sessionIds, signal);
		if (!pinned) checkCancellation(signal);
		const nativeSessionMetadata: unknown[] = [...descendantResult.metadata];
		let rootMetadataComplete = nativePin
			? sessionIds.every((id) =>
					nativePin.sessions.some(
						(session) => session.id === id && session.metadata !== undefined,
					),
				)
			: !polled;
		if (!pinned) {
			for (const sessionId of sessionIds) {
				try {
					const metadata = await this.nativeRequest(
						(options) =>
							this.client.session.get({ sessionID: sessionId }, options),
						signal ?? null,
					);
					if (!isRecord(metadata) || metadata.id !== sessionId)
						rootMetadataComplete = false;
					nativeSessionMetadata.push(metadata);
				} catch (error) {
					if (signal?.aborted && error === signal.reason) throw error;
					rootMetadataComplete = false;
				}
			}
		}
		const descendants = descendantResult.sessions;
		const sessionRecords: readonly ObservedSession[] = [
			...sessionIds.map((id) => ({ id, agent: null, parentID: null })),
			...descendants,
		];
		const ordered = sessionRecords.map((session) => session.id);
		const messages: { sessionIndex: number; entry: MessageEntry }[] = [];
		const sessionMessages: SessionMessages[] = [];
		let messagesComplete = true;
		for (const [sessionIndex, sessionId] of ordered.entries()) {
			if (polled && sessionId !== polled.sessionId) continue;
			let entries: readonly MessageEntry[] | null;
			try {
				entries = nativePin
					? (nativePin.sessions.find((session) => session.id === sessionId)
							?.messages ?? null)
					: polled
						? polled.messages
						: ((await this.messages(sessionId, signal)) as MessageEntry[]);
			} catch (error) {
				// Reduce transcripts already fetched before deciding whether cancellation
				// can discard this attempt. An earlier provider error still counts.
				messagesComplete = false;
				if (nativeFailure || (signal?.aborted && error === signal.reason))
					break;
				throw new EvaluationPhaseError(
					attemptFailure("host", "session-messages-read-failed", error, true),
					error,
				);
			}
			const session = sessionRecords[sessionIndex];
			if (session) sessionMessages.push({ ...session, messages: entries });
			if (entries) {
				for (const entry of entries) messages.push({ sessionIndex, entry });
				const observation = this.nativeCommands.get(sessionId);
				if (
					sessionIds.includes(sessionId) &&
					observation?.stop !== "question-escalated"
				) {
					const metadata = nativeSessionMetadata.find(
						(candidate) => isRecord(candidate) && candidate.id === sessionId,
					);
					const scope = observation?.scope;
					nativeFailure ??= nativeExecutionFailure(
						nativeExecution(
							collectHostTrace({
								runnerRootSessionIds: [sessionId],
								directory: this.project,
								sessionMetadata: metadata ? [metadata] : [],
								sessionMessages: [
									{ sessionId, messages: entries.map((entry) => entry.native) },
								],
								childrenComplete: true,
							}),
							scope ? [scope] : [],
						),
					);
				}
			}
		}
		messages.sort(
			(left, right) =>
				(left.entry.info.time?.created ?? 0) -
				(right.entry.info.time?.created ?? 0),
		);
		const allCalls: ObservedToolCall[] = [];
		const tokens = {
			input: 0,
			output: 0,
			reasoning: 0,
			cacheRead: 0,
			cacheWrite: 0,
		};
		let costUsd = 0;
		let costReported = false;
		let unknownMessageCost = false;
		let assistantMessages = 0;
		let completeUsageMessages = 0;
		let anyUsageMessages = 0;
		let providerError: AttemptFailure<"provider"> | null =
			polled?.failure ?? null;
		let observedProviderError: NonNullable<
			Outcome["providerErrorObservation"]
		> | null = polled?.observation ?? null;
		let finalText = "";
		const guidanceLoads: ObservedGuidanceLoad[] = [];
		let guidanceSequence = 0;

		for (const { sessionIndex, entry } of messages) {
			if (
				entry.info.role === "assistant" ||
				(entry.native.type === "compaction" &&
					entry.native.status !== "running")
			) {
				assistantMessages += 1;
				const used = entry.info.tokens;
				const messageCost = reportedCost(
					typeof entry.info.cost === "number" ? entry.info.cost : null,
					{
						input: used?.input ?? 0,
						output: used?.output ?? 0,
						reasoning: used?.reasoning ?? 0,
						cacheRead: used?.cache?.read ?? 0,
						cacheWrite: used?.cache?.write ?? 0,
					},
				);
				if (messageCost === null) unknownMessageCost = true;
				else {
					costUsd += messageCost;
					costReported = true;
				}
				if (used) {
					anyUsageMessages += 1;
					if (
						[
							used.input,
							used.output,
							used.reasoning,
							used.cache?.read,
							used.cache?.write,
						].every((count) => typeof count === "number")
					)
						completeUsageMessages += 1;
					tokens.input += used.input ?? 0;
					tokens.output += used.output ?? 0;
					tokens.reasoning += used.reasoning ?? 0;
					tokens.cacheRead += used.cache?.read ?? 0;
					tokens.cacheWrite += used.cache?.write ?? 0;
				}
				// An abort this harness issued is not a condition of the host, so it is
				// not reported as one. A message with no creation time cannot be placed
				// against the abort, so it keeps the older, broader attribution.
				const created = entry.info.time?.created;
				if (
					entry.info.error &&
					!providerError &&
					!isSelfAbortError(
						entry.info.error,
						this.lastSelfAbortAt > 0 &&
							(created === undefined || created <= this.lastSelfAbortAt),
					)
				) {
					providerError = providerFailure(entry.info.error);
					observedProviderError = providerErrorObservation(
						entry.info.error,
						ordered[sessionIndex] ?? "unobserved-session",
					);
				}
			}
			for (const [partIndex, part] of entry.parts.entries()) {
				if (
					part.type === "text" &&
					!part.synthetic &&
					entry.info.role === "assistant" &&
					// Only the sessions the scenario drove. A reviewer subtask reports to
					// the manager, not to the user, so its closing text is not the run's
					// final report and must not displace it.
					sessionIndex < sessionIds.length
				) {
					finalText = part.text ?? finalText;
				}
				if (part.type !== "tool" || !part.tool) continue;
				const raw = part.state?.output || part.state?.error || "";
				let parsed: unknown = raw;
				try {
					parsed = JSON.parse(raw);
				} catch {
					// Non-JSON output (flow_guidance returns markdown) stays a string.
				}
				const native = nativeToolProvenance(
					ordered[sessionIndex] ?? "",
					entry.info,
					part,
					partIndex,
					entry.native,
				);
				allCalls.push({
					...(native ? { native } : {}),
					tool: part.tool,
					sessionIndex,
					agent: entry.info.agent ?? "",
					status: part.state?.status ?? "pending",
					input: part.state?.input ?? {},
					output: parsed,
					rawOutput: raw,
					metadata: part.state?.metadata ?? {},
				});
				if (part.tool === "flow_guidance") {
					const input = part.state?.input ?? {};
					guidanceLoads.push(
						guidanceLoad({
							sequence: guidanceSequence,
							sessionIndex,
							agent: entry.info.agent ?? "",
							id: nonEmptyString(input.id),
							rawOutput: raw,
						}),
					);
					guidanceSequence += 1;
				}
			}
		}
		const parentSessions = sessionMessages.filter((session) =>
			sessionIds.includes(session.id),
		);
		const reviewerSessions = selectLineageValidatedReviewers(
			sessionIds,
			descendants,
		);
		const reviewerActor = reviewerActorObservation({
			childEndpointFailed: descendantResult.endpointFailed,
			sessions: reviewerSessions.flatMap((session) => {
				const messagesForSession = sessionMessages.find(
					(candidate) => candidate.id === session.id,
				);
				return messagesForSession
					? [
							{
								id: session.id,
								messages:
									messagesForSession.messages?.map((entry) => entry.native) ??
									null,
							},
						]
					: [];
			}),
		});
		const actors: readonly ObservedActor[] = [
			extractObservedActor({
				role: "manager",
				sessions: parentSessions.map((session) => ({
					id: session.id,
					messages: session.messages?.map((entry) => entry.native) ?? null,
				})),
			}),
			reviewerActor,
		];

		let session: Record<string, unknown> | null = null;
		let archives: Record<string, unknown>[] = [];
		try {
			if (!pinned) {
				checkCancellation(signal);
				session = await this.readJson(
					join(this.project, ".flow", "session.json"),
					signal,
				);
				checkCancellation(signal);
				archives = await this.readArchives(signal);
				checkCancellation(signal);
			}
		} catch (error) {
			// Cancelled workspace enrichment must not erase a provider failure
			// already observed in the transcript.
			if (
				(!providerError && !nativeFailure) ||
				!signal?.aborted ||
				error !== signal.reason
			)
				throw error;
		}
		const currentWorkspace = await captureWorkspaceSnapshot(this.project);
		const hostTrace = collectHostTrace({
			runnerRootSessionIds: sessionIds,
			directory: this.project,
			sessionMetadata: nativeSessionMetadata,
			sessionMessages: sessionMessages.map(({ id, messages }) => ({
				sessionId: id,
				messages: messages?.map((entry) => entry.native) ?? null,
			})),
			childrenComplete:
				messagesComplete &&
				rootMetadataComplete &&
				!descendantResult.endpointFailed,
		});
		return {
			packetBytes: collectReviewerPacketBytes(allCalls, [
				...(session ? [session] : []),
				...archives,
			]),
			hostTrace,
			...(this.commandAbortObservation &&
			sessionIds.includes(this.commandAbortObservation.rootSessionId)
				? { abortObservation: this.commandAbortObservation }
				: {}),
			allCalls,
			flowCalls: allCalls.filter((call) => call.tool.startsWith("flow_")),
			actors,
			guidanceLoads,
			session,
			archives,
			workspaceChanges: compareWorkspaceSnapshots(
				this.workspaceBaseline ?? {
					kind: "unavailable",
					reason: "workspace-baseline-unavailable",
				},
				currentWorkspace,
			),
			...(this.retainReviewDocument
				? {
						reviewDocument: await observeReviewDocument(
							this.project,
							currentWorkspace,
						),
					}
				: {}),
			finalText,
			tokens,
			usageAvailability:
				assistantMessages > 0 && completeUsageMessages === assistantMessages
					? "observed"
					: anyUsageMessages > 0
						? "incomplete"
						: "unobserved",
			costUsd: reportedCost(
				costReported && !unknownMessageCost ? costUsd : null,
				tokens,
			),
			assistantMessages,
			durationMs,
			providerError,
			nativeFailure,
			providerErrorObservation: observedProviderError,
		};
	}

	private async readJson(
		path: string,
		signal?: AbortSignal,
	): Promise<Record<string, unknown> | null> {
		try {
			return JSON.parse(
				await abortable(signal, () =>
					readFile(path, { encoding: "utf8", ...(signal ? { signal } : {}) }),
				),
			) as Record<string, unknown>;
		} catch (error) {
			if (
				signal?.aborted &&
				(error === signal.reason ||
					(error instanceof Error && error.name === "AbortError"))
			)
				throw signal.reason;
			if (
				error instanceof SyntaxError ||
				(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				return null;
			throw new EvaluationPhaseError(
				attemptFailure("host", "workspace-read-failed", error, true),
				error,
			);
		}
	}

	private async readArchives(
		signal?: AbortSignal,
	): Promise<Record<string, unknown>[]> {
		const history = join(this.project, ".flow", "history");
		let names: string[];
		try {
			names = await abortable(signal, () => readdir(history));
		} catch (error) {
			if (signal?.aborted && error === signal.reason) throw error;
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return [];
			throw new EvaluationPhaseError(
				attemptFailure("host", "archive-directory-read-failed", error, true),
				error,
			);
		}
		const documents: Record<string, unknown>[] = [];
		for (const name of names
			.filter((entry) => entry.endsWith(".json"))
			.sort()) {
			checkCancellation(signal);
			const document = await this.readJson(join(history, name), signal);
			checkCancellation(signal);
			if (document) documents.push(document);
		}
		return documents;
	}

	stop(): Promise<void> {
		this.stopPromise ??= this.stopOnce();
		return this.stopPromise;
	}

	retainProjectOnStop(retain: (project: string) => Promise<void>): void {
		if (this.stopPromise || this.projectRetention)
			throw new Error(
				"Project retention must be registered once before shutdown.",
			);
		this.projectRetention = retain;
	}

	private async stopOnce(): Promise<void> {
		const handoff = this.credentialHandoff;
		const drainResult =
			handoff && this.nativeClient
				? await Promise.allSettled([
						(async () => {
							const active = await this.nativeRequest(
								(options) => this.client.session.active(options),
								null,
								ABORT_TIMEOUT_MS,
							);
							await Promise.all(
								Object.keys(active).map(async (sessionID) => {
									await this.nativeRequest(
										(options) =>
											this.client.session.interrupt(
												{ sessionID, resume: false },
												options,
											),
										null,
										ABORT_TIMEOUT_MS,
									);
									await this.nativeRequest(
										(options) =>
											this.client.session.wait({ sessionID }, options),
										null,
										ABORT_TIMEOUT_MS,
									);
								}),
							);
						})(),
					])
				: [];
		const credentialResult =
			handoff && this.nativeClient
				? await Promise.allSettled([
						this.nativeRequest(
							(options) => this.client.credential.list(options),
							null,
							ABORT_TIMEOUT_MS,
						),
					])
				: [];
		try {
			if (this.server) await terminateChildProcessTree(this.server);
		} catch (error) {
			try {
				await this.nativeAuthSource?.dispose();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Native host termination and authentication cleanup failed.",
				);
			}
			throw error;
		}
		this.nativeClient = null;
		const results = await Promise.allSettled([
			Promise.resolve().then(async () => {
				const snapshot = credentialResult[0];
				if (snapshot?.status === "rejected") throw snapshot.reason;
				if (snapshot?.status === "fulfilled" && handoff)
					await handoff.onStop({
						before: handoff.before,
						after: snapshot.value,
					});
			}),
			Promise.resolve().then(() => this.projectRetention?.(this.project)),
			Promise.resolve().then(() => this.nativeAuthSource?.dispose()),
		]);
		const failures = [...drainResult, ...results].flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(
				failures,
				"Credential synchronization and project retention did not complete.",
			);
		await rm(this.scratch, { recursive: true, force: true });
	}
}
