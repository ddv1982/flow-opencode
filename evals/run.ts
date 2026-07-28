#!/usr/bin/env bun
// Runs Flow's outcome scenarios against one or more real models.
//
// Every report records the prompt-surface size alongside the pass rate and token
// use, so trimming a prompt produces a comparable datapoint instead of a guess.
//
//   bun run eval -- --model openai/gpt-5.6-sol
//   bun run eval -- --model openai/gpt-5.6-sol --model opencode/claude-opus-5
//   bun run eval -- --scenario happy-path --repeat 3

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { normalizeEvidencePlatform } from "../src/domain/validation.js";
import {
	compileFlowPromptSurface,
	type FlowPromptSurfaceName,
} from "../src/prompt-surfaces.js";
import {
	buildCassette,
	type Cassette,
	cassetteFileName,
	type FidelityNote,
} from "./cassette.js";
import {
	askedQuestions,
	EvalHost,
	formatRate,
	type Outcome,
	packPlugin,
	passRates,
	preparePackageCache,
	refusedBroadScope,
	runQueues,
	sessionBoundaries,
} from "./harness.js";
import {
	type CompletionHonesty,
	completionHonesty,
	type MetricSession,
	type ReviewerActivity,
	reviewerActivity,
} from "./metrics.js";
import { SCENARIOS } from "./scenarios.js";

const SURFACES: FlowPromptSurfaceName[] = [
	"flow-auto",
	"flow-plan",
	"flow-run",
	"flow-review",
	"flow-status",
	"flow-reviewer",
	"flow-worker",
];

type RunResult = {
	scenario: string;
	model: string;
	attempt: number;
	passed: boolean;
	/**
	 * True when the run never reached the model: a host that would not boot, a
	 * failed dependency install, a lost network. Such a run is no evidence about
	 * the prompts either way, so it is excluded from the pass rate rather than
	 * counted as a regression.
	 */
	environment?: boolean;
	/** True when the model asked the user and stopped, scored or not. */
	escalated?: boolean;
	/**
	 * True when the run is excluded from the pass rate: it asked the user somewhere
	 * the scenario does not treat as a terminal state, leaving the workflow
	 * mid-flight and its durable state neither the intended outcome nor evidence
	 * against the prompts.
	 */
	unscored?: boolean;
	issues: readonly string[];
	tokens: Outcome["tokens"];
	costUsd: number | null;
	assistantMessages: number;
	flowCalls: string[];
	/**
	 * Indices in `flowCalls` where a new host session begins, so a multi-session
	 * run stays readable after the transcripts are joined into one spine.
	 *
	 * Empty for the single-session scenarios. `resumes-after-interruption` asserts
	 * on what the *resumed* session did, and without this the boundary that
	 * assertion turns on is invisible to whoever reads a failure.
	 */
	sessionBoundaries: number[];
	/**
	 * Every durable document the run produced, active and archived.
	 *
	 * The report used to keep tool names only, which left the question that matters
	 * after a failure — was the gate's exit code host-observed or model-claimed? —
	 * answerable only by paying for another run.
	 */
	documents: readonly Record<string, unknown>[];
	/**
	 * Whether a `completed` closure is supported by the evidence in its own
	 * document. Reported for every run and scored by none: a scenario owns its
	 * verdict, and this is the cross-scenario number the suite is judged on.
	 */
	honesty: CompletionHonesty;
	/** What the independent review actually did, across every document. */
	reviewer: ReviewerActivity;
	/** Broad-scope claims the runtime refused, which no document records. */
	refusedBroadScope: number;
	/**
	 * Final assistant text, recorded so a human can judge a stop after the fact —
	 * above all an escalation, where whether asking was right is the whole question.
	 * Never asserted on: scenarios read durable state, never wording.
	 */
	finalText: string;
	/**
	 * Anything the model asked the user. Whether asking was right is the whole
	 * question about an escalation, and it cannot be judged without the question.
	 */
	questions: readonly string[];
	durationMs: number;
	hostError: string | null;
	error?: string;
};

/**
 * The most attempts allowed in flight at once, however many models are named.
 *
 * Each attempt is a whole OpenCode server compiling and running a real project, so
 * the ceiling is the machine's, not the providers'. Past it the harness starts
 * lying about time: the suspend credit treats any 20s the poll loop did not observe
 * as machine sleep and hands it back to the deadline, and enough contention to make
 * a 20s gap is exactly what enough workers produce — which is how a run once took
 * three hours under a twenty-minute cap.
 */
const MAX_CONCURRENCY = 4;

/** One attempt to run, and the slot its result belongs in. */
type Job = {
	readonly model: string;
	readonly scenario: (typeof SCENARIOS)[number];
	readonly attempt: number;
	readonly slot: number;
};

/** What one attempt produced: always a result, a cassette only if it reached a model. */
type Recorded = {
	/**
	 * Where this belongs in the report, carried because attempts finish in whatever
	 * order the providers answer. Both the table and the pinned cassettes read
	 * better — and diff against earlier reports — in the declared
	 * model/scenario/attempt order.
	 */
	readonly slot: number;
	readonly result: RunResult;
	readonly cassette: Cassette | null;
};

function parseArgs(argv: string[]) {
	const models: string[] = [];
	const scenarios: string[] = [];
	let repeat = 1;
	let concurrency = 0;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--model" && value) {
			models.push(value);
			index += 1;
		} else if (flag === "--scenario" && value) {
			scenarios.push(value);
			index += 1;
		} else if (flag === "--repeat" && value) {
			repeat = Number.parseInt(value, 10);
			index += 1;
		} else if (flag === "--concurrency" && value) {
			concurrency = Number.parseInt(value, 10);
			index += 1;
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"usage: bun run eval -- --model <provider/model> [--model ...] [--scenario <id>] [--repeat <n>] [--concurrency <n>]",
			);
			process.exit(0);
		}
	}
	if (models.length === 0) {
		const fromEnv = process.env.FLOW_EVAL_MODEL?.trim();
		if (fromEnv)
			models.push(...fromEnv.split(",").map((entry) => entry.trim()));
	}
	if (models.length === 0) {
		console.error(
			"No model given. Pass --model provider/model (repeatable) or set FLOW_EVAL_MODEL.",
		);
		process.exit(2);
	}
	if (!Number.isSafeInteger(repeat) || repeat < 1) {
		console.error("--repeat must be a positive integer.");
		process.exit(2);
	}
	if (
		concurrency !== 0 &&
		(!Number.isSafeInteger(concurrency) || concurrency < 1)
	) {
		console.error("--concurrency must be a positive integer.");
		process.exit(2);
	}
	// One worker per model by default. Work is queued per model, so more workers than
	// models cannot help, and `--concurrency 1` restores the sequential order that
	// makes an interleaved failure easier to read.
	const workers = Math.min(
		concurrency || models.length,
		models.length,
		MAX_CONCURRENCY,
	);
	if (concurrency > workers) {
		console.error(
			`--concurrency ${concurrency} lowered to ${workers}: at most one worker per model, and at most ${MAX_CONCURRENCY} overall.`,
		);
	}
	return { models, scenarios, repeat, concurrency: workers };
}

/** Bytes of prompt text this build ships, per surface and in total. */
function promptFootprint(): {
	total: number;
	bySurface: Record<string, number>;
} {
	const encoder = new TextEncoder();
	const bySurface: Record<string, number> = {};
	let total = 0;
	for (const surface of SURFACES) {
		const bytes = encoder.encode(compileFlowPromptSurface(surface)).byteLength;
		bySurface[surface] = bytes;
		total += bytes;
	}
	return { total, bySurface };
}

/**
 * The `ok` cell. `FAIL` is reserved for a run that finished with the wrong durable
 * outcome, which is the only class that is evidence about the prompts: a timeout
 * reads `ABORT` rather than being conflated with one.
 *
 * An ask the scenario allows is scored like any other run, so the verdict leads
 * and the ask is noted: it is the difference between a model that reached the
 * outcome and one that reached the only end left to it.
 */
function verdict(result: RunResult): string {
	if (result.environment) return "ENV";
	if (result.error) return "ABORT";
	if (result.unscored) return "ASKED";
	return `${result.passed ? "PASS" : "FAIL"}${result.escalated ? "+ASK" : ""}`;
}

function formatTable(results: readonly RunResult[]): string {
	const header = [
		"scenario",
		"model",
		"ok",
		"in",
		"out",
		"msgs",
		"s",
		"issues",
	];
	const rows = results.map((result) => [
		result.scenario,
		result.model,
		verdict(result),
		String(result.tokens.input),
		String(result.tokens.output),
		String(result.assistantMessages),
		String(Math.round(result.durationMs / 1000)),
		result.error
			? `harness: ${result.error}`
			: result.issues.length === 0
				? "-"
				: result.issues.join("; "),
	]);
	const widths = header.map((cell, column) =>
		Math.max(cell.length, ...rows.map((row) => (row[column] ?? "").length)),
	);
	const line = (cells: string[]) =>
		cells
			.map((cell, column) =>
				column === header.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
			)
			.join("  ");
	return [
		line(header),
		line(widths.map((width) => "-".repeat(width))),
		...rows.map(line),
	].join("\n");
}

/**
 * Boots one throwaway host and proves every requested model both resolves and
 * answers, so a mistyped id, a missing credential, or a model the account is not
 * entitled to costs seconds and a fraction of a cent instead of a full pass.
 *
 * The two stages fail for genuinely different reasons and are reported apart. A
 * catalog miss is a spelling or configuration problem. A probe rejection means
 * the id is right and the account cannot call it, which is the normal state for a
 * preview-gated model and is invisible to the catalog.
 */
async function preflight(
	packageCache: string,
	opencodeVersion: string,
	models: readonly string[],
): Promise<void> {
	process.stdout.write("- preflight: resolving model ids ... ");
	let host: EvalHost | null = null;
	let fatal: string | null = null;
	try {
		host = await EvalHost.start({
			packageCache,
			opencodeVersion,
			files: { "package.json": '{\n  "name": "preflight"\n}\n' },
		});
		const catalog = new Set(await host.catalogModels());
		const missing = models.filter((model) => !catalog.has(model));
		if (missing.length > 0) {
			console.log("FAILED");
			fatal = `Unresolved model id(s): ${missing.join(", ")}\n\nThe host catalog lists ${catalog.size} model(s). Ids are providerID/modelID as the\nhost resolves them. Check with \`opencode models\`, and confirm the provider is\nconnected (\`opencode auth login\`) or its credentials are exported in the env.`;
		} else {
			console.log(`OK (${models.length} id(s) resolved)`);
			// Entitlement is per model, so every requested id is probed even after one
			// fails; seeing all the bad ids at once beats rediscovering them one run
			// at a time.
			const rejected: string[] = [];
			for (const model of models) {
				process.stdout.write(`- preflight: probing ${model} ... `);
				const failure = await host.probeModel(model);
				console.log(failure ? `REJECTED (${failure})` : "OK");
				if (failure) rejected.push(`${model}: ${failure}`);
			}
			if (rejected.length > 0) {
				fatal = `Model(s) resolved but would not answer:\n\n${rejected
					.map((entry) => `  ${entry}`)
					.join(
						"\n",
					)}\n\nThe id is spelled correctly and the provider is connected, so this is normally\nan entitlement gap: a newly released or preview-gated model the account cannot\nyet call. Use a model the account can reach, or request access, before spending\na full pass.`;
			}
		}
	} catch (error) {
		// Losing the probe host is not evidence about the models, so it must not
		// block a run that may well work. An actual rejection above is different,
		// and is fatal.
		console.log(
			`SKIPPED (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
		);
	} finally {
		await host?.stop();
	}
	if (fatal) {
		console.error(`\n${fatal}`);
		process.exit(2);
	}
}

async function main(): Promise<void> {
	const { models, scenarios, repeat, concurrency } = parseArgs(
		process.argv.slice(2),
	);
	const selected = scenarios.length
		? SCENARIOS.filter((scenario) => scenarios.includes(scenario.id))
		: SCENARIOS;
	if (selected.length === 0) {
		console.error(
			`No scenario matched. Available: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}`,
		);
		process.exit(2);
	}

	const repositoryRoot = join(import.meta.dir, "..");
	const opencodeVersion =
		process.env.FLOW_OPENCODE_SMOKE_VERSION?.trim() ||
		packageJson.devDependencies["@opencode-ai/plugin"];
	const footprint = promptFootprint();

	console.log(`Flow ${packageJson.version} on OpenCode ${opencodeVersion}`);
	console.log(
		`Prompt footprint: ${footprint.total} bytes across ${SURFACES.length} surfaces`,
	);
	console.log(
		`Running ${selected.length} scenario(s) x ${models.length} model(s) x ${repeat} attempt(s)` +
			(concurrency > 1
				? `, ${concurrency} models at a time — lines land as attempts finish, not in order\n`
				: "\n"),
	);

	const packDir = await mkdtemp(join(tmpdir(), "flow-eval-pack-"));
	const results: RunResult[] = [];
	// One decision-layer recording per attempt that reached the model, so the run's
	// findings can be re-derived against a changed runtime without paying again.
	const cassettes: Cassette[] = [];
	const hostPlatform = normalizeEvidencePlatform(process.platform);
	try {
		const packageCache = await preparePackageCache(
			await packPlugin(repositoryRoot, packDir),
			packDir,
		);
		await preflight(packageCache, opencodeVersion, models);
		// One queue per model, run concurrently. The attempts are already independent —
		// each boots its own OpenCode host on its own free port over its own temp
		// workspace — so the sequential loop this replaces was spending 2.5h of wall
		// clock on 2.5h of model time for no reason. Keyed by model so a queue never
		// contends with itself for a single provider's rate limit.
		const queues: Job[][] = [];
		let slot = 0;
		for (const model of models) {
			const queue: Job[] = [];
			for (const scenario of selected) {
				for (let attempt = 1; attempt <= repeat; attempt += 1) {
					queue.push({ model, scenario, attempt, slot });
					slot += 1;
				}
			}
			queues.push(queue);
		}
		/** One attempt, start to finish, printing a single line when it lands. */
		const runAttempt = async (job: Job): Promise<Recorded> => {
			const { model, scenario, attempt } = job;
			const label = `${scenario.id} @ ${model} (${attempt}/${repeat})`;
			let cassette: Cassette | null = null;
			const started = Date.now();
			let host: EvalHost | null = null;
			try {
				host = await EvalHost.start({
					packageCache,
					opencodeVersion,
					files: scenario.files,
				});
				const sessionIds = [
					await host.createSession(`flow-eval ${scenario.id}`),
				];
				// A step that times out still produced tokens, messages, and tool
				// calls, and those are the only evidence of how far the model got.
				// Throwing here would discard them and report a run of zeroes, so
				// the failure is remembered and the outcome collected regardless.
				let stepError: string | null = null;
				let escalatedStep: number | null = null;
				for (const [index, step] of scenario.steps.entries()) {
					try {
						if (step.freshSession) {
							sessionIds.push(
								await host.createSession(`flow-eval ${scenario.id} resumed`),
							);
						}
						const end = await host.runCommand(
							sessionIds[sessionIds.length - 1] ?? "",
							step.command,
							step.arguments,
							model,
						);
						if (end === "escalated") {
							escalatedStep = index;
							break;
						}
					} catch (error) {
						stepError = error instanceof Error ? error.message : String(error);
						break;
					}
				}
				const outcome = await host.outcome(sessionIds, Date.now() - started);
				// A host-level error (bad model id, missing credentials) is not a
				// prompt result, so it must not be reported as a scenario failure.
				if (outcome.hostError && outcome.flowCalls.length === 0) {
					throw new Error(`host rejected the turn: ${outcome.hostError}`);
				}
				// Asking the user is the designed end of some scenarios, but only at the
				// wall: a question during an earlier step ends the run before the step
				// that probes the invariant ever runs, so there is nothing to check.
				const askedAtTheWall =
					escalatedStep !== null &&
					scenario.mayEscalate === true &&
					escalatedStep === scenario.steps.length - 1;
				const unscored = escalatedStep !== null && !askedAtTheWall;
				// An aborted or unscored step leaves the workflow mid-flight, so `check`
				// would report expected-but-meaningless gaps. The stop is the finding;
				// the collected evidence explains it.
				const issues = stepError || unscored ? [] : scenario.check(outcome);
				const documents = [
					...(outcome.session ? [outcome.session] : []),
					...outcome.archives,
				] as MetricSession[];
				const result: RunResult = {
					scenario: scenario.id,
					model,
					attempt,
					passed: stepError === null && !unscored && issues.length === 0,
					...(escalatedStep !== null ? { escalated: true } : {}),
					...(unscored ? { unscored: true } : {}),
					issues,
					...(stepError ? { error: stepError } : {}),
					tokens: outcome.tokens,
					costUsd: outcome.costUsd,
					assistantMessages: outcome.assistantMessages,
					flowCalls: outcome.flowCalls.map((call) => call.tool),
					sessionBoundaries: sessionBoundaries(outcome.flowCalls),
					documents,
					honesty: completionHonesty(
						documents.find((document) => document.closure) ?? null,
					),
					reviewer: reviewerActivity(documents),
					refusedBroadScope: refusedBroadScope(outcome.flowCalls),
					finalText: outcome.finalText,
					questions: askedQuestions(outcome),
					durationMs: outcome.durationMs,
					hostError: outcome.hostError,
				};
				const fidelity: FidelityNote[] = [];
				if (stepError) fidelity.push("run-aborted");
				if (unscored) fidelity.push("run-unscored");
				// Only a host error this runner did not cause, which `outcome` now
				// decides: it withholds the `MessageAbortedError` left by an abort
				// the harness issued itself. Recording those as host errors made 19
				// of 63 cassettes advisory, and every refusal scenario — the runs
				// most worth gating — was among them.
				if (outcome.hostError) fidelity.push("host-error");
				cassette = buildCassette({
					flowVersion: packageJson.version,
					scenario: scenario.id,
					model,
					attempt,
					hostPlatform,
					files: scenario.files,
					projectPath: host.project,
					calls: outcome.allCalls,
					finalText: outcome.finalText,
					assistantMessages: outcome.assistantMessages,
					verdict: verdict(result),
					issues,
					falseCompletion: result.honesty.falseCompletion,
					documents,
					extraFidelity: fidelity,
				});
				const scoreLabel =
					issues.length === 0 ? "PASS" : `FAIL (${issues.length})`;
				console.log(
					`- ${label} ... ${
						stepError
							? `ABORT (${stepError.split("\n")[0]})`
							: unscored
								? "ASKED (the model asked the user; nothing answers, so the wait ended)"
								: askedAtTheWall
									? `${scoreLabel} (asked the user, which this scenario allows)`
									: scoreLabel
					}`,
				);
				return { slot: job.slot, result, cassette };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.log(`- ${label} ... ENVIRONMENT (${message.split("\n")[0]})`);
				// Reaching here means the scenario never got a model turn, with one
				// exception: a host that answered but rejected every turn is thrown
				// above and is equally not a prompt result.
				return {
					slot: job.slot,
					cassette,
					result: {
						scenario: scenario.id,
						model,
						attempt,
						passed: false,
						environment: true,
						issues: [],
						tokens: {
							input: 0,
							output: 0,
							reasoning: 0,
							cacheRead: 0,
							cacheWrite: 0,
						},
						costUsd: null,
						assistantMessages: 0,
						flowCalls: [],
						sessionBoundaries: [],
						documents: [],
						honesty: completionHonesty(null),
						reviewer: reviewerActivity([]),
						refusedBroadScope: 0,
						finalText: "",
						questions: [],
						durationMs: Date.now() - started,
						hostError: null,
						error: message,
					},
				};
			} finally {
				await host?.stop();
			}
		};

		const recorded = await runQueues(queues, concurrency, runAttempt);
		for (const entry of recorded.sort(
			(left, right) => left.slot - right.slot,
		)) {
			results.push(entry.result);
			if (entry.cassette) cassettes.push(entry.cassette);
		}
	} finally {
		await rm(packDir, { recursive: true, force: true });
	}

	console.log(`\n${formatTable(results)}\n`);
	// An abort is excluded for the same reason an allowed ask is: the run never
	// reached the outcome the scenario asks about, so counting it as a failure reports
	// a measurement that did not happen. One wedged attempt was the only reason a
	// measured report came back NOT QUALIFIED.
	const scored = results.filter(
		(result) =>
			!result.environment && !result.unscored && result.error === undefined,
	);
	const blocked = results.filter((result) => result.environment).length;
	const aborted = results.filter(
		(result) => !result.environment && result.error !== undefined,
	).length;
	const asked = results.filter((result) => result.escalated).length;
	const askedUnscored = results.filter((result) => result.unscored).length;
	const passed = scored.filter((result) => result.passed).length;
	const totalIn = results.reduce((sum, result) => sum + result.tokens.input, 0);
	const totalOut = results.reduce(
		(sum, result) => sum + result.tokens.output,
		0,
	);
	// Printed beside the input total because providers split the two differently: one
	// model in the measured matrix reported 38 input tokens against 479,640 cache
	// reads for the same turn its neighbour billed entirely as input. Each field is
	// honest on its own; an input total read across providers without this one is not.
	const totalCached = results.reduce(
		(sum, result) => sum + result.tokens.cacheRead,
		0,
	);
	// A provider that omits cost from its usage payload (OpenAI does) must not be
	// summarised as $0.0000: an unknown spend is not a free one.
	const priced = results.filter((result) => result.costUsd !== null);
	const cost = priced.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
	const spend =
		priced.length === 0
			? "cost not reported by provider"
			: `$${cost.toFixed(4)}${priced.length < results.length ? ` over ${priced.length}/${results.length} runs; the rest unreported` : ""}`;
	console.log(
		`${passed}/${scored.length} passed | ${totalIn} input (+${totalCached} cached) + ${totalOut} output tokens | ${spend}${
			blocked > 0
				? `\n${blocked} run(s) never reached the model and are excluded; re-run them before trusting this pass rate.`
				: ""
		}${
			aborted > 0
				? `\n${aborted} run(s) aborted mid-flight and are excluded; the stop is the finding, not the outcome, so re-run them before trusting this pass rate.`
				: ""
		}${
			asked > 0
				? `\n${asked} run(s) ended with the model asking the user${askedUnscored > 0 ? `, ${askedUnscored} of them excluded from the rate` : ""}. Asking is often correct, so judge each one: read its \`questions\` and \`finalText\` in the report.`
				: ""
		}`,
	);
	// The two cross-scenario numbers. A pass rate says whether the suite's intended
	// outcomes were reached; these say whether a reported success was real and
	// whether the independent review contributed anything, which no single
	// scenario's verdict shows.
	const falseCompletions = results.filter(
		(result) => result.honesty.falseCompletion,
	);
	const closedCompleted = results.filter(
		(result) => result.honesty.closedCompleted,
	).length;
	const reviewer = results.reduce(
		(total, result) => ({
			assignments: total.assignments + result.reviewer.assignments,
			unsubmitted: total.unsubmitted + result.reviewer.unsubmitted,
			passed: total.passed + result.reviewer.passed,
			failed: total.failed + result.reviewer.failed,
			blockingFindings:
				total.blockingFindings + result.reviewer.blockingFindings,
			advisoryFindings:
				total.advisoryFindings + result.reviewer.advisoryFindings,
			scopeBlockers: total.scopeBlockers + result.reviewer.scopeBlockers,
			silentPasses: total.silentPasses + result.reviewer.silentPasses,
		}),
		reviewerActivity([]),
	);
	const broadScopeRefusals = results.reduce(
		(sum, result) => sum + result.refusedBroadScope,
		0,
	);
	console.log(
		`\nfalse completions: ${falseCompletions.length}/${closedCompleted} completed closure(s)${
			falseCompletions.length === 0
				? ""
				: `\n${falseCompletions
						.map(
							(result) =>
								`  ${result.scenario} @ ${result.model} #${result.attempt}: ${result.honesty.gaps.join(", ")}`,
						)
						.join("\n")}`
		}\nreviewer: ${reviewer.assignments} assignment(s), ${reviewer.passed} passed (${reviewer.silentPasses} with no finding), ${reviewer.failed} failed, ${reviewer.unsubmitted} unsubmitted, ${reviewer.blockingFindings} blocking + ${reviewer.advisoryFindings} advisory finding(s), ${reviewer.scopeBlockers} scope blocker(s)${
			broadScopeRefusals === 0
				? ""
				: `\nbroad-scope refusals: ${broadScopeRefusals} across ${results.length} run(s); a rising number means the plan surface is not naming the declared gate clearly enough`
		}`,
	);
	// The aggregate hides the number that matters. Model behavior is stochastic, so
	// a scenario passing 1 of 6 attempts is a different finding from one passing 6
	// of 6, and reading that off the rows by eye is how it gets missed.
	const rates = passRates(results);
	if (
		rates.length > 0 &&
		rates.some(([, rate]) => rate.attempts + rate.unscored + rate.aborted > 1)
	) {
		console.log(
			`\nper scenario and model:\n${rates
				.map(([label, rate]) => `  ${label}: ${formatRate(rate)}`)
				.join("\n")}`,
		);
	}

	const reportDir = join(repositoryRoot, "evals", "results");
	await mkdir(reportDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const reportPath = join(reportDir, `${stamp}.json`);
	await writeFile(
		reportPath,
		`${JSON.stringify(
			{
				flowVersion: packageJson.version,
				opencodeVersion,
				recordedAt: new Date().toISOString(),
				promptFootprint: footprint,
				summary: {
					passed,
					scored: scored.length,
					environmentBlocked: blocked,
					aborted,
					escalated: asked,
					escalationExcluded: askedUnscored,
					total: results.length,
					totalIn,
					totalCached,
					totalOut,
					costUsd: priced.length === 0 ? null : cost,
					costReportedRuns: priced.length,
					passRates: Object.fromEntries(rates),
					closedCompleted,
					falseCompletions: falseCompletions.length,
					reviewer,
					broadScopeRefusals,
				},
				results,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	console.log(`Report: ${reportPath}`);

	// Written beside the report rather than into the committed set: a recording is
	// only worth gating on once someone has read the run it came from and decided
	// which decisions are worth pinning.
	if (cassettes.length > 0) {
		const cassetteDir = join(reportDir, `${stamp}.cassettes`);
		await mkdir(cassetteDir, { recursive: true });
		for (const cassette of cassettes) {
			await writeFile(
				join(
					cassetteDir,
					cassetteFileName(cassette.scenario, cassette.model, cassette.attempt),
				),
				// Tabs, because a pinned cassette lives under `evals/` and the repo
				// formatter checks it there. Two-space candidates meant every copy into
				// `evals/cassettes/` failed lint until it was reformatted, which is a
				// step between reading a run and keeping it.
				`${JSON.stringify(cassette, null, "\t")}\n`,
				"utf8",
			);
		}
		const gated = cassettes.filter(
			(cassette) => cassette.fidelity.length === 0,
		).length;
		console.log(
			`Cassettes: ${cassettes.length} in ${cassetteDir} (${gated} reproducible without caveats). Replay with \`bun run replay -- --from evals/results/${stamp}.cassettes\`.`,
		);
	}

	// Status follows the scored runs, matching the pass rate above. Counting the
	// excluded ones here is what made a run that printed "6/6 passed" exit 1 after
	// one attempt lost the network. A pass with nothing scored is not a pass.
	process.exit(scored.length > 0 && passed === scored.length ? 0 : 1);
}

await main();
