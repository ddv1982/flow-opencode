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
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const STARTUP_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 120_000;

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
	readonly input: Record<string, unknown>;
	/** Tool output, parsed as JSON when the tool returned a Flow envelope. */
	readonly output: unknown;
	readonly rawOutput: string;
};

/**
 * How a step's wait ended.
 *
 * `escalated` means the model asked the user and stopped. That is often the right
 * move — it is what a model should do when a gate cannot pass — but nothing here
 * answers, so the session can never progress and its durable state is mid-flight
 * by definition. It is reported apart from a pass or a failure rather than waited
 * out and scored as one.
 */
export type CommandEnd = "quiet" | "escalated";

/** Everything a scenario is allowed to assert against. */
export type Outcome = {
	/** Ordered `flow_*` calls only — the workflow's observable spine. */
	readonly flowCalls: readonly ObservedToolCall[];
	/** Every tool call, including host tools like bash/edit/task. */
	readonly allCalls: readonly ObservedToolCall[];
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
	/** True when the host reported an error on any assistant message. */
	readonly hostError: string | null;
};

export type Scenario = {
	readonly id: string;
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
	 * missing result. It counts only when the *last* step asked, because a question
	 * during an earlier step ends the run before the step that probes the invariant
	 * ever runs.
	 */
	readonly mayEscalate?: boolean;
	/** Returns a list of failures. Empty means the scenario passed. */
	readonly check: (outcome: Outcome) => readonly string[];
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
 */
async function carryProviderCredentials(childData: string): Promise<void> {
	if (process.env.FLOW_EVAL_NO_AUTH_COPY === "1") return;
	const parentData =
		process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
	const source = join(parentData, "opencode", "auth.json");
	const target = join(childData, "opencode", "auth.json");
	await mkdir(join(childData, "opencode"), { recursive: true, mode: 0o700 });
	try {
		await copyFile(source, target);
	} catch {
		// No stored credentials; the provider may still authenticate from the env.
	}
}

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not reserve a local port.");
	}
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

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

async function postJson(
	url: string,
	body: unknown,
	timeout = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeout),
	});
	if (!response.ok) {
		throw new Error(
			`POST ${url} failed with ${response.status}: ${await response.text()}`,
		);
	}
	return response.json();
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
 * Everything the model asked the user, as recorded tool input.
 *
 * A model at a wall it may not climb puts the blocker in its question rather than
 * in a closing summary, so this is where the reasoning for an escalation lives —
 * both for a human judging whether asking was right and for a check that reads
 * whether the blocker was named at all.
 */
export function askedQuestions(outcome: Outcome): string[] {
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
 * Passes per attempt for each scenario and model pair, in run order. Attempts that
 * were not scored -- an allowed ask, a lost host -- are counted apart rather than
 * dropped, so a scenario whose every attempt went unscored still gets a row saying
 * so instead of leaving the table without a trace.
 */
export function passRates(
	results: readonly {
		readonly scenario: string;
		readonly model: string;
		readonly passed: boolean;
		readonly environment?: boolean;
		readonly unscored?: boolean;
	}[],
): [string, PassRate][] {
	const rates = new Map<string, PassRate>();
	for (const result of results) {
		const label = `${result.scenario} @ ${result.model}`;
		const rate = rates.get(label) ?? { passed: 0, attempts: 0, unscored: 0 };
		if (result.environment || result.unscored) rate.unscored += 1;
		else {
			rate.attempts += 1;
			if (result.passed) rate.passed += 1;
		}
		rates.set(label, rate);
	}
	return [...rates];
}

export type PassRate = { passed: number; attempts: number; unscored: number };

/** One pass-rate row. Nothing scored says so, rather than reading as `0/0`. */
export function formatRate(rate: PassRate): string {
	const excluded = rate.unscored > 0 ? `  ${rate.unscored} excluded` : "";
	if (rate.attempts === 0) return `nothing scored${excluded}`;
	const flaky = rate.passed > 0 && rate.passed < rate.attempts ? "  FLAKY" : "";
	return `${rate.passed}/${rate.attempts}${flaky}${excluded}`;
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

/** Packs the working tree once and reuses the tarball across every run. */
export async function packPlugin(
	repositoryRoot: string,
	into: string,
): Promise<string> {
	const build = spawnSync("bun", ["run", "build"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
	if (build.status !== 0)
		throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);
	const pack = spawnSync("bun", ["pm", "pack", "--destination", into], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
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
): Promise<string> {
	const cache = join(into, `opencode-plugin-flow@${packageJson.version}`);
	await mkdir(cache, { recursive: true });
	await writeFile(
		join(cache, "package.json"),
		`${JSON.stringify({ dependencies: { "opencode-plugin-flow": `file:${tarball}` } }, null, 2)}\n`,
		"utf8",
	);
	const install = spawnSync("bun", ["install"], {
		cwd: cache,
		encoding: "utf8",
	});
	if (install.status !== 0)
		throw new Error(`cache install failed:\n${install.stderr}`);
	return cache;
}

type MessageEntry = {
	info: {
		role: string;
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
		};
	}[];
};

export class EvalHost {
	private server: ChildProcess | null = null;
	private serverLog = "";
	private baseUrl = "";

	readonly project: string;
	private readonly scratch: string;

	private constructor(project: string, scratch: string) {
		this.project = project;
		this.scratch = scratch;
	}

	/** Boots a throwaway OpenCode host with the packed plugin over a git fixture. */
	static async start(options: {
		/** Prepared by `preparePackageCache`, copied in rather than reinstalled. */
		packageCache: string;
		opencodeVersion: string;
		files: Readonly<Record<string, string>>;
	}): Promise<EvalHost> {
		const scratch = await mkdtemp(join(tmpdir(), "flow-eval-"));
		await chmod(scratch, 0o700);
		const childHome = join(scratch, "home");
		const childCache = join(scratch, "cache");
		const childData = join(childHome, ".local", "share");
		const project = join(scratch, "project");
		await mkdir(childHome, { recursive: true });
		await mkdir(join(project, ".opencode"), { recursive: true });
		await carryProviderCredentials(childData);

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

		// Populate OpenCode's exact-version cache from the prepared install so the
		// eval exercises the bytes a user would install, without touching the network.
		const packages = join(childCache, "opencode", "packages");
		await mkdir(packages, { recursive: true });
		await cp(
			options.packageCache,
			join(packages, `opencode-plugin-flow@${packageJson.version}`),
			{ recursive: true },
		);
		await writeFile(
			join(project, "opencode.json"),
			`${JSON.stringify({ plugin: [`opencode-plugin-flow@${packageJson.version}`] }, null, 2)}\n`,
			"utf8",
		);

		const host = new EvalHost(project, scratch);
		const port = await availablePort();
		host.baseUrl = `http://127.0.0.1:${port}`;
		host.server = spawn(
			"bunx",
			[
				`opencode-ai@${options.opencodeVersion}`,
				"serve",
				"--port",
				String(port),
				"--hostname",
				"127.0.0.1",
			],
			{
				cwd: project,
				env: {
					...process.env,
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
				throw new Error(`OpenCode did not become healthy.\n${host.serverLog}`);
			}
			await Bun.sleep(500);
		}
		return host;
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
		options: { quietMs?: number; timeoutMs?: number } = {},
	): Promise<CommandEnd> {
		const quietMs = options.quietMs ?? 25_000;
		const timeoutMs = options.timeoutMs ?? 20 * 60_000;
		void postJson(`${this.baseUrl}/session/${sessionId}/command`, {
			command,
			arguments: args,
			model,
		}).catch((error) => {
			this.serverLog += `\ncommand POST rejected: ${String(error)}`;
		});

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
		for (;;) {
			const before = Date.now();
			await Bun.sleep(poll);
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
					.map((part) => `${part.tool ?? "tool"}:${part.state?.status}`),
			);
			const busy =
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
				await postJson(`${this.baseUrl}/session/${sessionId}/abort`, {}).catch(
					() => {},
				);
				return "escalated";
			}
			if (Date.now() > deadline) {
				await postJson(`${this.baseUrl}/session/${sessionId}/abort`, {}).catch(
					() => {},
				);
				const stalledSeconds = Math.round((Date.now() - changedAt) / 1_000);
				const [count = "0", parts = "0"] = signature.split(":");
				const suspended =
					suspendedMs > 0
						? ` Excluded ${Math.round(suspendedMs / 1_000)}s this process did not observe, most likely machine suspend.`
						: "";
				throw new Error(
					(stalledSeconds * 1_000 >= quietMs
						? `Scenario exceeded ${timeoutMs}ms without going quiet: wedged. No new message or part for ${stalledSeconds}s while these tool calls stayed incomplete: ${pending.join(", ") || "none"}.`
						: `Scenario exceeded ${timeoutMs}ms without going quiet: still working. The session was producing output up to the deadline (${count} messages, ${parts} parts), so it was working or looping rather than stuck.`) +
						suspended,
				);
			}
		}
	}

	private async messages(sessionId: string): Promise<unknown> {
		return fetchJson(`${this.baseUrl}/session/${sessionId}/message`);
	}

	/**
	 * Collects the durable and observed outcome a scenario asserts against.
	 *
	 * Sessions are read in the order they were used and their transcripts joined,
	 * so a scenario that resumes in a fresh session still sees one continuous
	 * tool-call spine.
	 */
	async outcome(
		sessionIds: readonly string[],
		durationMs: number,
	): Promise<Outcome> {
		const messages: { sessionIndex: number; entry: MessageEntry }[] = [];
		for (const [sessionIndex, sessionId] of sessionIds.entries()) {
			for (const entry of (await this.messages(sessionId)) as MessageEntry[]) {
				messages.push({ sessionIndex, entry });
			}
		}
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
		let hostError: string | null = null;
		let finalText = "";

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
				if (entry.info.error && !hostError)
					hostError = JSON.stringify(entry.info.error);
			}
			for (const part of entry.parts) {
				if (
					part.type === "text" &&
					!part.synthetic &&
					entry.info.role === "assistant"
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
					status:
						(part.state?.status as ObservedToolCall["status"]) ?? "pending",
					input: part.state?.input ?? {},
					output: parsed,
					rawOutput: raw,
				});
			}
		}

		return {
			allCalls,
			flowCalls: allCalls.filter((call) => call.tool.startsWith("flow_")),
			session: await this.readJson(join(this.project, ".flow", "session.json")),
			archives: await this.readArchives(),
			finalText,
			tokens,
			costUsd: reportedCost(costReported ? costUsd : null, tokens.output),
			assistantMessages,
			durationMs,
			hostError,
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
		} catch {
			return null;
		}
	}

	private async readArchives(): Promise<Record<string, unknown>[]> {
		const history = join(this.project, ".flow", "history");
		let names: string[];
		try {
			names = await readdir(history);
		} catch {
			return [];
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
		if (this.server && this.server.exitCode === null) {
			this.server.kill("SIGTERM");
			await Promise.race([
				new Promise<void>((resolve) =>
					this.server?.once("exit", () => resolve()),
				),
				Bun.sleep(3_000).then(() => {
					if (this.server?.exitCode === null) this.server.kill("SIGKILL");
				}),
			]);
		}
		await rm(this.scratch, { recursive: true, force: true });
	}
}
