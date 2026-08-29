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
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { type BunToolchain, runPinnedBunSync } from "./bun-toolchain.js";
import {
	type AttemptFailure,
	attemptFailure,
	EvaluationPhaseError,
	evaluationPhase,
	preservePrimaryFailure,
	providerFailure,
} from "./failure-origin.js";
import type { ScenarioGradeInput } from "./grader-input.js";
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

const STARTUP_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 120_000;
/** What OpenCode names the error it stamps on a message an abort killed. */
const ABORT_ERROR_NAME = "MessageAbortedError";
/**
 * How long a session may make no progress at all before it is called wedged.
 *
 * Distinct from the whole-scenario deadline, which a wedge would otherwise wait
 * out in full: three of the four recorded timeouts sat with the same incomplete
 * tool call for twenty minutes, and the diagnostic the deadline printed said so.
 * Once nothing has changed for this long while a call stays incomplete, waiting
 * the remaining seventeen minutes buys no further evidence.
 *
 * Generous on purpose. It bounds a *silent* session, not a slow one — any new
 * message or part resets it — so the only way to trip it honestly is a command
 * that emits nothing for three minutes, which no scenario fixture does.
 */
const STALLED_MS = 3 * 60_000;

/** A single tool invocation observed in the transcript. */
export type ObservedToolCall = {
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
	 * Host-reported metadata for the call: for Bash, the `exit` code and the
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
	| { readonly kind: "rejected"; readonly message: string };

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
				if (error === cancellation) return;
				const message = String(error);
				delivery = { kind: "rejected", message };
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
}): Promise<CommandEnd> {
	const request = startSessionRequest(input);
	try {
		return await input.wait(request);
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
	/** Ordered `flow_*` calls only — the workflow's observable spine. */
	readonly flowCalls: readonly ObservedToolCall[];
	/** Every tool call, including host tools like bash/edit/task. */
	readonly allCalls: readonly ObservedToolCall[];
	/** Actor identity observations from completed, non-error assistant messages. */
	readonly actors?: readonly ObservedActor[];
	/** Raw delivered flow_guidance output, with its measured UTF-8 size. */
	readonly guidanceLoads?: readonly ObservedGuidanceLoad[];
	/** Parsed `.flow/session.json`, or null when no active session exists. */
	readonly session: Record<string, unknown> | null;
	/** Parsed documents under `.flow/history/`. */
	readonly archives: readonly Record<string, unknown>[];
	/** Final assistant text, for reporting only — never assert on wording. */
	readonly finalText: string;
	readonly tokens: {
		input: number;
		output: number;
		reasoning: number;
		cacheRead: number;
		cacheWrite: number;
	};
	/**
	 * Total reported cost, or null when the provider priced nothing. Reporting an
	 * unpriced run as 0 reads as "this run was free", which is the opposite of
	 * true.
	 *
	 * A provider that does not price a run reports zero rather than omitting the
	 * field, so checking only for an absent number is not enough: every OpenAI run
	 * measured here reported `cost: 0` on real token use and printed `$0.0000`. A
	 * zero total against non-zero output tokens is an unknown spend.
	 */
	readonly costUsd: number | null;
	readonly assistantMessages: number;
	readonly durationMs: number;
	readonly providerError: AttemptFailure<"provider"> | null;
	readonly providerErrorObservation?: ProviderErrorObservation | null;
};

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
	readonly steps: readonly {
		readonly command: string;
		readonly arguments: string;
		/**
		 * Runs this step in a new host session over the same project directory.
		 *
		 * The model carries no transcript across that boundary, so it has to recover
		 * the lifecycle from `.flow/` alone. That is what an interruption actually
		 * looks like, and it is the only way to prove durable state — not
		 * conversational memory — is what drives the next action.
		 */
		readonly freshSession?: boolean;
	}[];
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
async function carryProviderCredentials(
	childData: string,
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
		await writeFile(paths.target, snapshot, { mode: 0o600 });
	} catch {
		// No stored credentials; the provider may still authenticate from the env.
	}
	return { ...paths, snapshot };
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
		} catch {
			// The child never wrote a credential file (no refresh happened, or the
			// provider authenticated purely from the env); nothing to carry back.
			return;
		}
		try {
			JSON.parse(contents);
		} catch {
			console.error(
				`eval harness: child auth.json at ${paths.target} did not parse as JSON; leaving the real credential file untouched.`,
			);
			return;
		}
		let current = "";
		try {
			current = await readFile(paths.source, "utf8");
		} catch {
			// The real file is gone — the developer logged out mid-run, or there was
			// never one to copy. The child's own entries are all there is.
		}
		const merged = mergeCredentials(current, contents, paths.snapshot);
		// Nothing this host rotated, so nothing to publish. Leaving the file alone is
		// the point: an untouched credential store cannot be damaged by a sync.
		if (merged === null) return;
		try {
			await writeFile(tempPath, merged, { mode: 0o600 });
			await rename(tempPath, paths.source);
		} catch (error) {
			// Failing to sync back must not crash the run over a host that already
			// finished its scenario; it only means the next host risks the same stale
			// credential this whole mechanism exists to avoid, which is no worse than
			// before this fix existed.
			console.error(
				`eval harness: could not sync credentials back to ${paths.source}: ${error instanceof Error ? error.message : String(error)}`,
			);
			await rm(tempPath, { force: true });
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
						if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
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

function processTreeAlive(child: ChildProcess): boolean {
	const pid = child.pid;
	if (pid === undefined) return false;
	if (process.platform === "win32") return child.exitCode === null;
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

export async function terminateChildProcessTree(
	child: ChildProcess,
): Promise<void> {
	if (!processTreeAlive(child)) return;
	const exited = new Promise<void>((resolve) =>
		child.once("exit", () => resolve()),
	);
	await signalProcessTreeDescendants(child, "SIGTERM");
	await Promise.race([exited, Bun.sleep(500)]);
	if (!processTreeAlive(child)) return;
	signalProcessTree(child, "SIGTERM");
	const gracefulDeadline = Date.now() + 3_000;
	while (processTreeAlive(child) && Date.now() < gracefulDeadline) {
		await Bun.sleep(50);
	}
	if (processTreeAlive(child)) signalProcessTree(child, "SIGKILL");
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
async function fetchJson(
	url: string,
	timeout = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
	if (!response.ok) {
		throw new Error(
			`GET ${url} failed with ${response.status}: ${await response.text()}`,
		);
	}
	return response.json();
}

/** `fetchJson` for the requests that drive a session, with the same error rule. */
async function postJson(
	url: string,
	body: unknown,
	options: { readonly signal?: AbortSignal } = {},
): Promise<unknown> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	return postJsonResponse(url, response);
}

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

/**
 * Whether an error on an assistant message is one this harness caused.
 *
 * Both abort sites in `runCommand` are Flow ending a wait it cannot win — an
 * escalation nothing here answers, or a deadline — and OpenCode stamps
 * `MessageAbortedError` on the message it killed. Reporting that as a host error
 * put 88 false alarms in front of the 4 real timeouts across 408 recorded runs,
 * because escalating is the designed end of six scenarios.
 *
 * Attributed by the flag rather than by session id: aborting a parent kills its
 * reviewer subtask too, and that child's abort has the same cause. It takes the
 * flag as an argument because with no abort issued, an abort error is real news —
 * something outside this process ended the turn.
 */
export function isSelfAbortError(
	error: unknown,
	selfAborted: boolean,
): boolean {
	if (!selfAborted || !error || typeof error !== "object") return false;
	return (error as { name?: unknown }).name === ABORT_ERROR_NAME;
}

/**
 * Whether a session has stopped rather than slowed.
 *
 * An incomplete tool call is what separates the two: with one outstanding and no
 * new message or part for this long, nothing is coming, and the whole-scenario
 * deadline would only reach the same finding with the same evidence after
 * seventeen more minutes of it. With nothing outstanding the session is between
 * turns, which is the quiet window's business, not this one's.
 */
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
					if (stopped) return;
					// Read and advance in one synchronous step, so no two workers can claim
					// the same queue.
					const queue = queues[next];
					next += 1;
					if (!queue) return;
					for (const job of queue) {
						if (stopped) return;
						try {
							const result = await run(job);
							results.push(result);
							if (shouldStop?.(result)) stopped = true;
						} catch (error) {
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
 * produced no output tokens really can be free, so only a zero against real output
 * is unknown.
 */
export function reportedCost(
	total: number | null,
	outputTokens: number,
): number | null {
	if (total === null) return null;
	return total > 0 || outputTokens === 0 ? total : null;
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
	const name = data?.name ?? record.name;
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
	return join(into, `opencode-plugin-flow-${packageJson.version}.tgz`);
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
	const cache = join(into, `opencode-plugin-flow@${packageJson.version}`);
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

/**
 * One message as the host's HTTP API returns it, narrowed to what scoring reads.
 *
 * Declared rather than imported because it is another process's wire format, and a
 * host upgrade that drops a field should surface here as a scoring change to think
 * about — not as a type error in a dependency, and not as a silent zero.
 */
type MessageEntry = {
	info: {
		role: string;
		agent?: string;
		model?: { providerID?: unknown; modelID?: unknown };
		providerID?: unknown;
		modelID?: unknown;
		time?: { created: number; completed?: number };
		error?: unknown;
		cost?: number;
		tokens?: {
			input: number;
			output: number;
			reasoning: number;
			cache?: { read: number; write: number };
		};
	};
	parts: {
		type: string;
		tool?: string;
		text?: string;
		synthetic?: boolean;
		state?: {
			status: string;
			input?: Record<string, unknown>;
			output?: string;
			error?: string;
			metadata?: Record<string, unknown>;
		};
	}[];
};

type SessionMessages = ObservedSession & {
	readonly messages: readonly MessageEntry[] | null;
};

/**
 * One throwaway OpenCode host, over one fixture repository, for one attempt.
 *
 * The isolation is the measurement. Every host gets its own port, its own XDG
 * directories, its own scratch copy of the plugin and of `auth.json`, and its own
 * git fixture — so nothing an attempt does can reach the developer's sessions, and
 * nothing about the developer's machine can explain a result. `stop()` is what
 * makes that true rather than aspirational, and it is why the credential sync has
 * to happen before the scratch directory goes.
 *
 * Constructed through `start` rather than `new`, because a host is only meaningful
 * once the server is listening and the fixture is committed, and a half-booted one
 * would be scored as a failed attempt.
 */
export class EvalHost {
	private server: ChildProcess | null = null;
	private serverLog = "";
	private baseUrl = "";
	/**
	 * When this harness last aborted a session itself, or 0 if it never did.
	 *
	 * Both abort sites in `runCommand` are Flow ending a wait it cannot win — an
	 * escalation nothing here answers, or a deadline. OpenCode stamps
	 * `MessageAbortedError` on the message it killed, and reporting that as a host
	 * error puts 88 false alarms in front of the 4 real timeouts across 408
	 * recorded runs: escalating is the designed end of six scenarios, so almost
	 * every one of them carried it.
	 *
	 * A timestamp rather than a flag, because a scenario runs several commands
	 * against one host: a message an abort killed was created before that abort,
	 * so an abort error on a message created *after* the last one this harness
	 * issued is real news — something outside this process ended a later turn —
	 * and a bare flag would have swallowed it for the rest of the attempt.
	 */
	private lastSelfAbortAt = 0;

	readonly project: string;
	private readonly scratch: string;
	private credentialPaths: CredentialSync | null = null;

	private constructor(project: string, scratch: string) {
		this.project = project;
		this.scratch = scratch;
	}

	/** Boots a throwaway OpenCode host over a git fixture. */
	static async start(options: {
		toolchain: BunToolchain;
		/** Prepared by `preparePackageCache`, copied in rather than reinstalled. */
		packageCache: string;
		opencodeVersion: string;
		files: Readonly<Record<string, string>>;
		/** Pins the hidden reviewer child independently from the command model. */
		reviewerModel?: string;
		/** False creates the paired benchmark's ordinary OpenCode control host. */
		withFlow?: boolean;
	}): Promise<EvalHost> {
		const scratch = await mkdtemp(join(tmpdir(), "flow-eval-"));
		await chmod(scratch, 0o700);
		const childHome = join(scratch, "home");
		const childCache = join(scratch, "cache");
		const childData = join(childHome, ".local", "share");
		const project = join(scratch, "project");
		await mkdir(childHome, { recursive: true });
		await mkdir(join(project, ".opencode"), { recursive: true });
		const credentialPaths = await evaluationPhase(
			"host",
			"credential-copy-failed",
			true,
			() => carryProviderCredentials(childData),
		);

		// Flow derives source identity from git, so the fixture must be a repo.
		for (const [relative, contents] of Object.entries(options.files)) {
			const target = join(project, relative);
			await mkdir(join(target, ".."), { recursive: true });
			await writeFile(target, contents, "utf8");
		}
		for (const argv of [
			["init", "--initial-branch=main"],
			["config", "user.email", "eval@example.com"],
			["config", "user.name", "Flow Eval"],
			["add", "-A"],
			["commit", "-m", "fixture"],
		]) {
			const git = spawnSync("git", argv, { cwd: project, encoding: "utf8" });
			if (git.status !== 0)
				throw new Error(`git ${argv[0]} failed:\n${git.stderr}`);
		}

		// Populate OpenCode's exact-version cache from the prepared install so Flow
		// runs exercise the bytes a user would install, without touching the network.
		// The ordinary OpenCode benchmark arm deliberately receives no plugin config.
		if (options.withFlow !== false) {
			const packages = join(childCache, "opencode", "packages");
			await mkdir(packages, { recursive: true });
			await cp(
				options.packageCache,
				join(packages, `opencode-plugin-flow@${packageJson.version}`),
				{ recursive: true },
			);
		}
		await writeFile(
			join(project, "opencode.json"),
			`${JSON.stringify(
				options.withFlow === false
					? {}
					: { plugin: [`opencode-plugin-flow@${packageJson.version}`] },
				null,
				2,
			)}\n`,
			"utf8",
		);

		const host = new EvalHost(project, scratch);
		host.credentialPaths = credentialPaths;
		return evaluationPhase("host", "host-start-failed", true, async () => {
			const port = await availablePort();
			host.baseUrl = `http://127.0.0.1:${port}`;
			host.server = spawn(
				options.toolchain.executable,
				[
					"x",
					`opencode-ai@${options.opencodeVersion}`,
					"serve",
					"--port",
					String(port),
					"--hostname",
					"127.0.0.1",
				],
				{
					cwd: project,
					detached: process.platform !== "win32",
					env: {
						...options.toolchain.environment,
						...(options.reviewerModel
							? { OPENCODE_FLOW_REVIEWER_MODEL: options.reviewerModel }
							: {}),
						HOME: childHome,
						XDG_CACHE_HOME: childCache,
						XDG_CONFIG_HOME: join(childHome, ".config"),
						XDG_DATA_HOME: childData,
						XDG_STATE_HOME: join(childHome, ".local", "state"),
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			const record = (chunk: unknown) => {
				host.serverLog += String(chunk);
			};
			host.server.stdout?.on("data", record);
			host.server.stderr?.on("data", record);

			try {
				const deadline = Date.now() + STARTUP_TIMEOUT_MS;
				for (;;) {
					try {
						const health = (await fetchJson(
							`${host.baseUrl}/global/health`,
							3_000,
						)) as {
							healthy?: boolean;
						};
						if (health.healthy) break;
					} catch {
						// still starting
					}
					if (Date.now() > deadline) {
						throw new Error(
							`OpenCode did not become healthy.\n${host.serverLog}`,
						);
					}
					await Bun.sleep(500);
				}
				const ready = (await postJson(
					`${host.baseUrl}/session`,
					{ title: "flow-eval readiness" },
					{
						signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
					},
				)) as { id?: unknown };
				if (typeof ready.id !== "string" || !ready.id) {
					throw new Error("OpenCode readiness session had no id.");
				}
				await fetch(`${host.baseUrl}/session/${ready.id}`, {
					method: "DELETE",
					signal: AbortSignal.timeout(10_000),
				}).catch(() => {});
				return host;
			} catch (error) {
				return preservePrimaryFailure<EvalHost>(
					() => Promise.reject(error),
					() => host.stop(),
				);
			}
		});
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
		const listed = (await fetchJson(`${this.baseUrl}/config/providers`)) as {
			providers?: { id: string; models?: Record<string, unknown> }[];
		};
		return (listed.providers ?? []).flatMap((provider) =>
			Object.keys(provider.models ?? {}).map(
				(modelId) => `${provider.id}/${modelId}`,
			),
		);
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
	async probeModel(model: string): Promise<string | null> {
		const sessionId = await this.createSession(`flow-eval probe ${model}`);
		try {
			const reply = (await postJson(
				`${this.baseUrl}/session/${sessionId}/message`,
				{
					// `/session/:id/message` takes a split model, unlike `/command`,
					// which takes the joined string.
					model: splitModel(model),
					system: "Reply with the single word OK. Call no tools.",
					parts: [{ type: "text", text: "ping" }],
				},
			)) as MessageEntry;
			const failure = reply.info?.error;
			return failure ? summarizeError(failure) : null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		} finally {
			await fetch(`${this.baseUrl}/session/${sessionId}`, {
				method: "DELETE",
			}).catch(() => {});
		}
	}

	async createSession(title: string): Promise<string> {
		const session = (await postJson(`${this.baseUrl}/session`, { title })) as {
			id: string;
		};
		return session.id;
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
		options: { quietMs?: number; timeoutMs?: number; stalledMs?: number } = {},
	): Promise<CommandEnd> {
		return runSessionRequest({
			post: postSessionJson,
			url: `${this.baseUrl}/session/${sessionId}/command`,
			body: { command, arguments: args, model },
			onRejected: (message) => {
				this.serverLog += `\ncommand POST rejected: ${message}`;
			},
			wait: (request) =>
				this.waitForQuiet(sessionId, {
					...options,
					request,
				}),
		});
	}

	/** Sends an ordinary user prompt for the benchmark control arm. */
	async runPrompt(
		sessionId: string,
		prompt: string,
		model: string,
		options: { quietMs?: number; timeoutMs?: number; stalledMs?: number } = {},
	): Promise<CommandEnd> {
		return runSessionRequest({
			post: postSessionJson,
			url: `${this.baseUrl}/session/${sessionId}/message`,
			body: {
				model: splitModel(model),
				parts: [{ type: "text", text: prompt }],
			},
			onRejected: (message) => {
				this.serverLog += `\nmessage POST rejected: ${message}`;
			},
			wait: (request) =>
				this.waitForQuiet(sessionId, {
					...options,
					request,
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
		},
	): Promise<CommandEnd> {
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
		let suspendedMs = 0;
		const abortWait = async () => {
			const aborting = this.abortSession(sessionId);
			options.request.cancel();
			await aborting;
		};
		for (;;) {
			const before = Date.now();
			await Bun.sleep(poll);
			const delivery = options.request.state();
			if (delivery?.kind === "rejected") {
				throw new Error(`Host request was rejected: ${delivery.message}`);
			}
			const messages = (await this.messages(sessionId)) as MessageEntry[];
			const unobserved = Date.now() - before;
			if (unobserved >= suspendFloor) {
				// Capped at one full timeout, because unbounded credit turns the ceiling
				// into a suggestion: one recorded attempt ran 3h05m under a 20m cap after
				// a long suspend. A suspend may double the budget, not decuple it.
				const credit = Math.min(unobserved, timeoutMs - suspendedMs);
				suspendedMs += credit;
				deadline += credit;
				settledAt += credit;
				changedAt += credit;
			}
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
			const busy =
				delivery?.kind === "pending" ||
				pending.length > 0 ||
				messages.some(
					(entry) =>
						entry.info.role === "assistant" && !entry.info.time?.completed,
				);
			const next = `${messages.length}:${messages.reduce((total, entry) => total + entry.parts.length, 0)}`;
			const changed = next !== signature;
			signature = next;
			if (changed) changedAt = Date.now();
			if (changed || busy) settledAt = Date.now();
			else if (Date.now() - settledAt >= quietMs) return "quiet";
			// A pending question keeps `busy` true forever, so the quiet window above
			// can never close and only the deadline ends the wait. Nothing here answers
			// questions, so that state is terminal rather than slow: four recorded
			// attempts each burned their full twenty minutes producing nothing after the
			// model asked.
			if (onlyAwaitingAnswer(pending) && Date.now() - changedAt >= quietMs) {
				await abortWait();
				return "escalated";
			}
			const stalled = Date.now() - changedAt;
			const suspended =
				suspendedMs > 0
					? ` Excluded ${Math.round(suspendedMs / 1_000)}s this process did not observe, most likely machine suspend.`
					: "";
			const wedged = (elapsedMs: number) =>
				`No new message or part for ${Math.round(elapsedMs / 1_000)}s while these tool calls stayed incomplete: ${pending.join(", ") || "none"}.`;
			// A wedge is diagnosable long before the deadline, and the deadline used to
			// prove it the slow way: three of the four recorded timeouts spent seventeen
			// further minutes on the same incomplete tool call, then printed the sentence
			// below. Ending it here reaches the same finding with the same evidence and
			// hands the remaining attempts their wall clock back. Wedges are already out
			// of every pass-rate denominator, so nothing scored changes.
			if (isWedged(pending, stalled, stalledMs)) {
				await abortWait();
				throw new Error(
					`Scenario made no progress for ${stalledMs}ms: wedged. ${wedged(stalled)}${suspended}`,
				);
			}
			if (Date.now() > deadline) {
				await abortWait();
				const [count = "0", parts = "0"] = signature.split(":");
				throw new Error(
					(stalled >= quietMs
						? `Scenario exceeded ${timeoutMs}ms without going quiet: wedged. ${wedged(stalled)}`
						: `Scenario exceeded ${timeoutMs}ms without going quiet: still working. The session was producing output up to the deadline (${count} messages, ${parts} parts), so it was working or looping rather than stuck.`) +
						suspended,
				);
			}
		}
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
		await postJson(`${this.baseUrl}/session/${sessionId}/abort`, {}).catch(
			() => {},
		);
	}

	private async messages(sessionId: string): Promise<unknown> {
		return fetchJson(`${this.baseUrl}/session/${sessionId}/message`);
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
	private async descendantSessions(sessionIds: readonly string[]): Promise<{
		readonly sessions: readonly ObservedSession[];
		readonly endpointFailed: boolean;
	}> {
		const known = new Set(sessionIds);
		const found: ObservedSession[] = [];
		let endpointFailed = false;
		let frontier = [...sessionIds];
		while (frontier.length > 0) {
			const next: string[] = [];
			for (const parent of frontier) {
				let children: unknown;
				try {
					children = await fetchJson(
						`${this.baseUrl}/session/${parent}/children`,
					);
				} catch {
					endpointFailed = true;
					continue;
				}
				for (const child of Array.isArray(children) ? children : []) {
					if (!isRecord(child)) continue;
					const id = nonEmptyString(child.id);
					if (!id || known.has(id)) continue;
					const childSession: ObservedSession = {
						id,
						agent: nonEmptyString(child.agent),
						parentID: nonEmptyString(child.parentID),
					};
					known.add(id);
					found.push(childSession);
					next.push(id);
				}
			}
			frontier = next;
		}
		return { sessions: found, endpointFailed };
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
	): Promise<Outcome> {
		const descendantResult = await this.descendantSessions(sessionIds);
		const descendants = descendantResult.sessions;
		const sessionRecords: readonly ObservedSession[] = [
			...sessionIds.map((id) => ({ id, agent: null, parentID: null })),
			...descendants,
		];
		const ordered = sessionRecords.map((session) => session.id);
		const messages: { sessionIndex: number; entry: MessageEntry }[] = [];
		const sessionMessages: SessionMessages[] = [];
		for (const [sessionIndex, sessionId] of ordered.entries()) {
			let entries: MessageEntry[] | null;
			try {
				entries = (await this.messages(sessionId)) as MessageEntry[];
			} catch (error) {
				throw new EvaluationPhaseError(
					attemptFailure("host", "session-messages-read-failed", error, true),
					error,
				);
			}
			const session = sessionRecords[sessionIndex];
			if (session) sessionMessages.push({ ...session, messages: entries });
			if (entries) {
				for (const entry of entries) messages.push({ sessionIndex, entry });
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
		let assistantMessages = 0;
		let providerError: AttemptFailure<"provider"> | null = null;
		let observedProviderError: NonNullable<
			Outcome["providerErrorObservation"]
		> | null = null;
		let finalText = "";
		const guidanceLoads: ObservedGuidanceLoad[] = [];
		let guidanceSequence = 0;

		for (const { sessionIndex, entry } of messages) {
			if (entry.info.role === "assistant") {
				assistantMessages += 1;
				if (typeof entry.info.cost === "number") {
					costUsd += entry.info.cost;
					costReported = true;
				}
				const used = entry.info.tokens;
				if (used) {
					tokens.input += used.input;
					tokens.output += used.output;
					tokens.reasoning += used.reasoning;
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
			for (const part of entry.parts) {
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
				const raw = part.state?.output ?? part.state?.error ?? "";
				let parsed: unknown = raw;
				try {
					parsed = JSON.parse(raw);
				} catch {
					// Non-JSON output (flow_guidance returns markdown) stays a string.
				}
				allCalls.push({
					tool: part.tool,
					sessionIndex,
					agent: entry.info.agent ?? "",
					status:
						(part.state?.status as ObservedToolCall["status"]) ?? "pending",
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
					? [{ id: session.id, messages: messagesForSession.messages }]
					: [];
			}),
		});
		const actors: readonly ObservedActor[] = [
			extractObservedActor({
				role: "manager",
				sessions: parentSessions.map((session) => ({
					id: session.id,
					messages: session.messages,
				})),
			}),
			reviewerActor,
		];

		return {
			allCalls,
			flowCalls: allCalls.filter((call) => call.tool.startsWith("flow_")),
			actors,
			guidanceLoads,
			session: await this.readJson(join(this.project, ".flow", "session.json")),
			archives: await this.readArchives(),
			finalText,
			tokens,
			costUsd: reportedCost(costReported ? costUsd : null, tokens.output),
			assistantMessages,
			durationMs,
			providerError,
			providerErrorObservation: observedProviderError,
		};
	}

	private async readJson(
		path: string,
	): Promise<Record<string, unknown> | null> {
		try {
			return JSON.parse(await readFile(path, "utf8")) as Record<
				string,
				unknown
			>;
		} catch (error) {
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

	private async readArchives(): Promise<Record<string, unknown>[]> {
		const history = join(this.project, ".flow", "history");
		let names: string[];
		try {
			names = await readdir(history);
		} catch (error) {
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
			const document = await this.readJson(join(history, name));
			if (document) documents.push(document);
		}
		return documents;
	}

	async stop(): Promise<void> {
		if (this.server) await terminateChildProcessTree(this.server);
		// Must happen before the scratch directory is removed: a refresh the child
		// performed lives only in its copy of `auth.json`, and losing it here is
		// exactly what silently rotates the developer's own stored refresh token
		// out from under them.
		await syncProviderCredentialsBack(this.credentialPaths);
		await rm(this.scratch, { recursive: true, force: true });
	}
}
