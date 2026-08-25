// Decision-layer recordings of a live eval run.
//
// A live attempt costs a real OpenCode host, a real model turn, and minutes. A
// cassette records the one part of that attempt Flow does not own — the model's
// decisions, in order, with their arguments — so every part Flow *does* own can be
// re-run for free.
//
// Deliberately the decision layer and not the HTTP wire. An HTTP cassette freezes
// tool *results* too, so on replay Flow's own tool handlers never execute and a
// broken refusal replays green — which is the exact class of defect this suite
// exists to catch. Here the recorded arguments are fed to the real handlers against
// a fresh workspace, so every transition, guard, and refusal is genuinely
// re-executed and the graders read durable state the replay just produced.
//
// A cassette is a build artifact of a paid run, so two rules are load-bearing:
// nothing that could be a credential is ever written into one, and the recording
// host's absolute paths are replaced by a token rather than baked in.

import type { EvidencePlatform } from "../src/domain/session.js";

export const CASSETTE_VERSION = 1;

/** Stands in for the recording host's project directory. */
export const WORKSPACE_TOKEN = "<flow-eval-workspace>";

/** Bash output kept per event, for diagnosis only — nothing compares it. */
const MAX_RECORDED_OUTPUT_BYTES = 4_096;

/**
 * What the live call reported, reduced to the identifiers replay has to rebind.
 *
 * The runtime issues a session id, an assignment id, and finding ids of its own, so
 * a recorded argument naming one of them cannot be replayed literally: the replayed
 * run mints different ones. Recording what the live call reported is what lets the
 * driver translate recorded id to replayed id instead of guessing.
 */
export type CassetteObserved = Readonly<{
	status: "ok" | "error";
	revision?: number | undefined;
	sessionId?: string | undefined;
	assignmentId?: string | undefined;
	findingIds?: readonly string[] | undefined;
}>;

export type CassetteEvent =
	| Readonly<{
			kind: "flow";
			tool: string;
			/** The agent that made the call; `flow_feature_complete` turns on it. */
			agent: string;
			sessionIndex: number;
			input: Record<string, unknown>;
			observed: CassetteObserved;
	  }>
	| Readonly<{
			kind: "bash";
			agent: string;
			sessionIndex: number;
			command: string;
			output: string;
			/**
			 * The host metadata the capture hook read: `exit`, and `truncated` or
			 * `complete`. Recorded verbatim because a host that reports neither is a
			 * state Flow has a documented answer for, and replay has to reach it.
			 */
			metadata: Record<string, unknown>;
	  }>
	| Readonly<{
			kind: "other";
			tool: string;
			agent: string;
			sessionIndex: number;
			input: Record<string, unknown>;
			rawOutput: string;
			/**
			 * Whether the host accepted the call, for the graders that distinguish an
			 * attempted write from one that landed.
			 *
			 * Recording keeps errored calls deliberately — an `edit` the model meant to
			 * make is evidence even when it failed — so without this the two are
			 * indistinguishable on replay, and a scenario that credits coverage would
			 * credit it to a file that was never written.
			 *
			 * Optional so cassettes recorded before it stay replayable: absent means
			 * completed, which is what replay assumed for every event when the field did
			 * not exist.
			 */
			status?: "completed" | "error" | undefined;
	  }>;

/** Conditions a decision-layer replay cannot reproduce, so it reports them. */
export type FidelityNote =
	| "source-drift-observed"
	| "no-flow-calls"
	| "run-aborted"
	| "run-unscored"
	| "host-error";

export type Cassette = Readonly<{
	cassetteVersion: number;
	flowVersion: string;
	recordedAt: string;
	scenario: string;
	model: string;
	attempt: number;
	/**
	 * The host the recording ran on. Injected on replay rather than read from the
	 * replaying machine: a cassette recorded on Linux must reproduce its Linux
	 * verdict when replayed on a Mac, or `ExternalEvidence.platform` would be
	 * checked against the wrong thing.
	 */
	hostPlatform: EvidencePlatform;
	files: Readonly<Record<string, string>>;
	events: readonly CassetteEvent[];
	/** What the live run scored. Replay reproduces this or the tier fails. */
	expected: Readonly<{
		verdict: string;
		issues: readonly string[];
		falseCompletion: boolean;
		closureKind: string | null;
	}>;
	/** Recorded for the graders that read model prose; never re-derived. */
	finalText: string;
	assistantMessages: number;
	/**
	 * Non-empty means the replayed verdict is reported and not gated. Everything
	 * here is a limit of recording at the decision layer, not a defect.
	 */
	fidelity: readonly FidelityNote[];
}>;

/**
 * Anything shaped like a credential, replaced by a fixed marker.
 *
 * The recording host carries the developer's real `auth.json`, and a model may echo
 * an environment variable, a header, or a token into a command or an argument. A
 * cassette is a committed artifact, so this runs over every string in one — before
 * it is written, never after.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
	// Provider key prefixes, longest first so a longer prefix is not half-matched.
	// `[-_]`, because the separator is not the same for all of them: Anthropic, OpenAI
	// and xAI hyphenate, while Groq, Hugging Face, DigitalOcean and Shopify use an
	// underscore. Requiring a hyphen meant `gsk_`, `hf_`, `dop_v1_` and `shpat_` were
	// four prefixes listed here that could never match — the scrubber read as covering
	// them while passing them straight into a committed artifact.
	/\b(?:sk-ant|sk-proj|sk-or|sk|xai|gsk|hf|dop_v1|shpat)[-_][A-Za-z0-9_-]{16,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{16,}/g,
	/\bAIza[A-Za-z0-9_-]{20,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	// A JSON web token, which is what an OAuth access token normally is.
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

/**
 * `"api_key": "…"` and `TOKEN=…` forms, where the value carries no recognizable
 * prefix and only the key says what it is.
 */
const SECRET_ASSIGNMENT =
	/((?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)([^\s"',;}&]{8,})/gi;

export const REDACTED = "[redacted]";

export function scrubSecrets(value: string): string {
	let scrubbed = value;
	for (const pattern of SECRET_PATTERNS) {
		scrubbed = scrubbed.replace(pattern, REDACTED);
	}
	return scrubbed.replace(SECRET_ASSIGNMENT, `$1${REDACTED}`);
}

/** Recursively rewrites every string in a JSON-shaped value. */
export function mapStrings(
	value: unknown,
	map: (text: string) => string,
): unknown {
	if (typeof value === "string") return map(value);
	if (Array.isArray(value)) return value.map((item) => mapStrings(item, map));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				map(key),
				mapStrings(item, map),
			]),
		);
	}
	return value;
}

/**
 * Everything volatile about the recording machine, removed in one pass: its
 * project path becomes a token, and anything credential-shaped becomes a marker.
 *
 * The path substitution is what makes a cassette portable at all. It is also the
 * reason the driver substitutes back rather than running in the recorded location,
 * which no replaying machine has.
 */
export function normalizeRecorded<T>(value: T, projectPath: string): T {
	const replaced = mapStrings(value, (text) =>
		scrubSecrets(
			projectPath.length > 0
				? text.split(projectPath).join(WORKSPACE_TOKEN)
				: text,
		),
	);
	return replaced as T;
}

/** Puts the replaying workspace back where the recording host's path was. */
export function bindWorkspace<T>(value: T, workspace: string): T {
	return mapStrings(value, (text) =>
		text.split(WORKSPACE_TOKEN).join(workspace),
	) as T;
}

export function boundedOutput(output: string): string {
	const encoder = new TextEncoder();
	if (encoder.encode(output).byteLength <= MAX_RECORDED_OUTPUT_BYTES)
		return output;
	return `${output.slice(0, MAX_RECORDED_OUTPUT_BYTES)}\n[flow-eval] output truncated for the cassette`;
}

/**
 * The `[flow-validation]` line the capture hook appends to a captured command's
 * output, removed so the cassette holds what Bash actually printed.
 */
export function stripValidationMarker(output: string): string {
	const marker = output.lastIndexOf("\n\n[flow-validation");
	return marker === -1 ? output : output.slice(0, marker);
}

/** A cassette is gated only when nothing about it is known to be unreproducible. */
export function isGated(cassette: Cassette): boolean {
	return cassette.fidelity.length === 0;
}

/** Every string under a key of this name, at any depth. */
function collectByKey(value: unknown, key: string, into: string[]): string[] {
	if (Array.isArray(value)) {
		for (const item of value) collectByKey(item, key, into);
		return into;
	}
	if (value && typeof value === "object") {
		for (const [name, item] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (name === key && typeof item === "string") into.push(item);
			else collectByKey(item, key, into);
		}
	}
	return into;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Reduces one live Flow response to the identifiers a replay has to rebind. */
export function observedFrom(output: unknown): CassetteObserved {
	const response = record(output);
	const data = record(response?.workflowData);
	const projection = record(data?.projection);
	const revision = projection?.revision;
	const sessionId = projection?.sessionId;
	const assignmentId = record(projection?.assignment)?.id;
	const findingIds = collectByKey(data, "findingId", []);
	return {
		status: response?.status === "ok" ? "ok" : "error",
		...(typeof revision === "number" ? { revision } : {}),
		...(typeof sessionId === "string" ? { sessionId } : {}),
		...(typeof assignmentId === "string" ? { assignmentId } : {}),
		...(findingIds.length > 0 ? { findingIds } : {}),
	};
}

type RecordedCall = Readonly<{
	tool: string;
	agent: string;
	sessionIndex: number;
	status: string;
	input: Record<string, unknown>;
	output: unknown;
	rawOutput: string;
	metadata: Record<string, unknown>;
}>;

/**
 * Turns one finished live attempt into a cassette.
 *
 * Only calls the host finished are recorded. A call still pending when the run
 * ended produced no result to reproduce, and replaying it would invent one.
 */
export function buildCassette(options: {
	readonly flowVersion: string;
	readonly scenario: string;
	readonly model: string;
	readonly attempt: number;
	readonly hostPlatform: EvidencePlatform;
	readonly files: Readonly<Record<string, string>>;
	readonly projectPath: string;
	readonly calls: readonly RecordedCall[];
	readonly finalText: string;
	readonly assistantMessages: number;
	readonly verdict: string;
	readonly issues: readonly string[];
	readonly falseCompletion: boolean;
	readonly documents: readonly Record<string, unknown>[];
	readonly extraFidelity: readonly FidelityNote[];
}): Cassette {
	const events: CassetteEvent[] = [];
	for (const call of options.calls) {
		if (call.status !== "completed" && call.status !== "error") continue;
		const base = {
			agent: call.agent,
			sessionIndex: call.sessionIndex,
		} as const;
		if (call.tool.startsWith("flow_")) {
			events.push({
				kind: "flow",
				tool: call.tool,
				...base,
				input: call.input,
				observed: observedFrom(call.output),
			});
			continue;
		}
		if (call.tool.toLowerCase() === "bash") {
			const command = call.input.command;
			events.push({
				kind: "bash",
				...base,
				command: typeof command === "string" ? command : "",
				output: boundedOutput(stripValidationMarker(call.rawOutput)),
				metadata: call.metadata,
			});
			continue;
		}
		events.push({
			kind: "other",
			tool: call.tool,
			...base,
			input: call.input,
			rawOutput: boundedOutput(call.rawOutput),
			status: call.status === "error" ? "error" : "completed",
		});
	}

	const drifted = options.documents.some((document) =>
		collectByKey(document, "ineligibleReason", []).includes("source-drift"),
	);
	const closure = record(
		options.documents.find((document) => document.closure)?.closure,
	);
	const closureKind = closure?.kind;
	const fidelity: FidelityNote[] = [...options.extraFidelity];
	if (drifted) fidelity.push("source-drift-observed");
	if (!events.some((event) => event.kind === "flow"))
		fidelity.push("no-flow-calls");

	return normalizeRecorded(
		{
			cassetteVersion: CASSETTE_VERSION,
			flowVersion: options.flowVersion,
			recordedAt: new Date().toISOString(),
			scenario: options.scenario,
			model: options.model,
			attempt: options.attempt,
			hostPlatform: options.hostPlatform,
			files: options.files,
			events,
			expected: {
				verdict: options.verdict,
				issues: options.issues,
				falseCompletion: options.falseCompletion,
				closureKind: typeof closureKind === "string" ? closureKind : null,
			},
			finalText: options.finalText,
			assistantMessages: options.assistantMessages,
			fidelity: [...new Set(fidelity)],
		} satisfies Cassette,
		options.projectPath,
	);
}

/** Stable, filesystem-safe name for one recorded attempt. */
export function cassetteFileName(
	scenario: string,
	model: string,
	attempt: number,
): string {
	const slug = model.replace(/[^a-zA-Z0-9.-]+/g, "_");
	return `${scenario}--${slug}--${attempt}.json`;
}
