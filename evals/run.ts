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
import {
	compileFlowPromptSurface,
	type FlowPromptSurfaceName,
} from "../src/prompt-surfaces.js";
import { EvalHost, type Outcome, packPlugin } from "./harness.js";
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
	issues: readonly string[];
	tokens: Outcome["tokens"];
	costUsd: number | null;
	assistantMessages: number;
	flowCalls: string[];
	durationMs: number;
	hostError: string | null;
	error?: string;
};

function parseArgs(argv: string[]) {
	const models: string[] = [];
	const scenarios: string[] = [];
	let repeat = 1;
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
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"usage: bun run eval -- --model <provider/model> [--model ...] [--scenario <id>] [--repeat <n>]",
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
	return { models, scenarios, repeat };
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
		result.environment ? "ENV" : result.passed ? "PASS" : "FAIL",
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
	tarball: string,
	opencodeVersion: string,
	models: readonly string[],
): Promise<void> {
	process.stdout.write("- preflight: resolving model ids ... ");
	let host: EvalHost | null = null;
	let fatal: string | null = null;
	try {
		host = await EvalHost.start({
			tarball,
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
	const { models, scenarios, repeat } = parseArgs(process.argv.slice(2));
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
		`Running ${selected.length} scenario(s) x ${models.length} model(s) x ${repeat} attempt(s)\n`,
	);

	const packDir = await mkdtemp(join(tmpdir(), "flow-eval-pack-"));
	const results: RunResult[] = [];
	try {
		const tarball = await packPlugin(repositoryRoot, packDir);
		await preflight(tarball, opencodeVersion, models);
		for (const model of models) {
			for (const scenario of selected) {
				for (let attempt = 1; attempt <= repeat; attempt += 1) {
					const label = `${scenario.id} @ ${model} (${attempt}/${repeat})`;
					process.stdout.write(`- ${label} ... `);
					const started = Date.now();
					let host: EvalHost | null = null;
					try {
						host = await EvalHost.start({
							tarball,
							opencodeVersion,
							files: scenario.files,
						});
						const sessionId = await host.createSession(
							`flow-eval ${scenario.id}`,
						);
						// A step that times out still produced tokens, messages, and tool
						// calls, and those are the only evidence of how far the model got.
						// Throwing here would discard them and report a run of zeroes, so
						// the failure is remembered and the outcome collected regardless.
						let stepError: string | null = null;
						for (const step of scenario.steps) {
							try {
								await host.runCommand(
									sessionId,
									step.command,
									step.arguments,
									model,
								);
							} catch (error) {
								stepError =
									error instanceof Error ? error.message : String(error);
								break;
							}
						}
						const outcome = await host.outcome(sessionId, Date.now() - started);
						// A host-level error (bad model id, missing credentials) is not a
						// prompt result, so it must not be reported as a scenario failure.
						if (outcome.hostError && outcome.flowCalls.length === 0) {
							throw new Error(`host rejected the turn: ${outcome.hostError}`);
						}
						// An aborted step leaves the workflow mid-flight, so `check` would
						// report expected-but-meaningless gaps. The step failure is the
						// finding; the collected evidence explains it.
						const issues = stepError ? [] : scenario.check(outcome);
						results.push({
							scenario: scenario.id,
							model,
							attempt,
							passed: stepError === null && issues.length === 0,
							issues,
							...(stepError ? { error: stepError } : {}),
							tokens: outcome.tokens,
							costUsd: outcome.costUsd,
							assistantMessages: outcome.assistantMessages,
							flowCalls: outcome.flowCalls.map((call) => call.tool),
							durationMs: outcome.durationMs,
							hostError: outcome.hostError,
						});
						console.log(
							stepError
								? `ABORTED (${stepError.split("\n")[0]})`
								: issues.length === 0
									? "PASS"
									: `FAIL (${issues.length})`,
						);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						// Reaching here means the scenario never got a model turn, with one
						// exception: a host that answered but rejected every turn is thrown
						// above and is equally not a prompt result.
						results.push({
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
							durationMs: Date.now() - started,
							hostError: null,
							error: message,
						});
						console.log(`ENVIRONMENT (${message.split("\n")[0]})`);
					} finally {
						await host?.stop();
					}
				}
			}
		}
	} finally {
		await rm(packDir, { recursive: true, force: true });
	}

	console.log(`\n${formatTable(results)}\n`);
	const scored = results.filter((result) => !result.environment);
	const blocked = results.length - scored.length;
	const passed = scored.filter((result) => result.passed).length;
	const totalIn = results.reduce((sum, result) => sum + result.tokens.input, 0);
	const totalOut = results.reduce(
		(sum, result) => sum + result.tokens.output,
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
		`${passed}/${scored.length} passed | ${totalIn} input + ${totalOut} output tokens | ${spend}${
			blocked > 0
				? `\n${blocked} run(s) never reached the model and are excluded; re-run them before trusting this pass rate.`
				: ""
		}`,
	);

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
					total: results.length,
					totalIn,
					totalOut,
					costUsd: priced.length === 0 ? null : cost,
					costReportedRuns: priced.length,
				},
				results,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	console.log(`Report: ${reportPath}`);

	process.exit(passed === results.length ? 0 : 1);
}

await main();
