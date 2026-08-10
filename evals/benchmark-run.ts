#!/usr/bin/env bun
// Runs the same hidden-graded tasks with Flow and with ordinary OpenCode.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import {
	type BenchmarkMode,
	type BenchmarkResult,
	seededShuffle,
	summarizeBenchmark,
} from "./benchmark.js";
import { BENCHMARK_CASES } from "./benchmarks.js";
import { EvalHost, packPlugin, preparePackageCache } from "./harness.js";

type Job = {
	readonly model: string;
	readonly benchmark: (typeof BENCHMARK_CASES)[number];
	readonly attempt: number;
	readonly mode: BenchmarkMode;
};

function parseArgs(argv: string[]) {
	const models: string[] = [];
	const cases: string[] = [];
	let repeat = 1;
	let seed = new Date().toISOString().slice(0, 10);
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--model" && value) {
			models.push(value);
			index += 1;
		} else if (flag === "--case" && value) {
			cases.push(value);
			index += 1;
		} else if (flag === "--repeat" && value) {
			repeat = Number.parseInt(value, 10);
			index += 1;
		} else if (flag === "--seed" && value) {
			seed = value;
			index += 1;
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"usage: bun run benchmark -- --model <provider/model> [--case <id>] [--repeat <n>] [--seed <text>]",
			);
			process.exit(0);
		}
	}
	if (models.length === 0) {
		const configured = process.env.FLOW_EVAL_MODEL?.trim();
		if (configured)
			models.push(...configured.split(",").map((model) => model.trim()));
	}
	if (models.length === 0) {
		console.error("Pass --model provider/model or set FLOW_EVAL_MODEL.");
		process.exit(2);
	}
	if (!Number.isSafeInteger(repeat) || repeat < 1) {
		console.error("--repeat must be a positive integer.");
		process.exit(2);
	}
	return { models, cases, repeat, seed };
}

function completedClosure(outcome: {
	readonly session: Record<string, unknown> | null;
	readonly archives: readonly Record<string, unknown>[];
}): boolean {
	return [outcome.session, ...outcome.archives].some((document) => {
		const closure = document?.closure;
		return (
			closure !== null &&
			typeof closure === "object" &&
			(closure as { kind?: unknown }).kind === "completed"
		);
	});
}

function ordinaryCompletionClaim(finalText: string): boolean {
	return /BENCHMARK_STATUS:\s*COMPLETE\b/i.test(finalText);
}

function percent(value: number | null): string {
	return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function delta(value: number | null, unit = ""): string {
	return value === null
		? "n/a"
		: `${value >= 0 ? "+" : ""}${value.toFixed(2)}${unit}`;
}

function cost(value: number | null, priced: number, scored: number): string {
	if (value === null) return "unpriced";
	return `$${value.toFixed(4)} (${priced}/${scored} priced)`;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const selected = options.cases.length
		? BENCHMARK_CASES.filter((entry) => options.cases.includes(entry.id))
		: BENCHMARK_CASES;
	if (selected.length === 0) {
		console.error(
			`No case matched. Available: ${BENCHMARK_CASES.map((entry) => entry.id).join(", ")}`,
		);
		process.exit(2);
	}

	const jobs: Job[] = [];
	for (const model of options.models) {
		for (const benchmark of selected) {
			for (let attempt = 1; attempt <= options.repeat; attempt += 1) {
				jobs.push({ model, benchmark, attempt, mode: "flow" });
				jobs.push({ model, benchmark, attempt, mode: "ordinary" });
			}
		}
	}
	const ordered = seededShuffle(jobs, options.seed);
	const opencodeVersion =
		process.env.FLOW_OPENCODE_SMOKE_VERSION?.trim() ||
		packageJson.devDependencies["@opencode-ai/plugin"];
	const packDir = await mkdtemp(join(tmpdir(), "flow-benchmark-pack-"));
	const results: BenchmarkResult[] = [];
	console.log(
		`Paired benchmark: ${selected.length} case(s), ${options.models.length} model(s), ${options.repeat} repeat(s), seed ${options.seed}`,
	);
	try {
		const packageCache = await preparePackageCache(
			await packPlugin(join(import.meta.dir, ".."), packDir),
			packDir,
		);
		let preflight: EvalHost | null = null;
		try {
			preflight = await EvalHost.start({
				packageCache,
				opencodeVersion,
				files: { "package.json": '{\n  "name": "benchmark-preflight"\n}\n' },
				withFlow: false,
			});
			const catalog = new Set(await preflight.catalogModels());
			const missing = options.models.filter((model) => !catalog.has(model));
			if (missing.length > 0) {
				throw new Error(`Unresolved model id(s): ${missing.join(", ")}`);
			}
			for (const model of options.models) {
				const failure = await preflight.probeModel(model);
				if (failure) throw new Error(`${model} would not answer: ${failure}`);
			}
		} finally {
			await preflight?.stop();
		}
		for (const job of ordered) {
			const label = `${job.benchmark.id} @ ${job.model} (${job.mode}, ${job.attempt}/${options.repeat})`;
			const started = Date.now();
			let host: EvalHost | null = null;
			try {
				host = await EvalHost.start({
					packageCache,
					opencodeVersion,
					files: job.benchmark.files,
					withFlow: job.mode === "flow",
				});
				const session = await host.createSession(
					`flow-benchmark ${job.benchmark.id}`,
				);
				const prompt = `${job.benchmark.prompt}\n\nMeasurement protocol: end your final response with exactly BENCHMARK_STATUS: COMPLETE if you believe every acceptance criterion is satisfied, otherwise BENCHMARK_STATUS: BLOCKED.`;
				let stepError: string | null = null;
				try {
					if (job.mode === "flow") {
						await host.runCommand(session, "flow-auto", prompt, job.model);
					} else {
						await host.runPrompt(session, prompt, job.model);
					}
				} catch (error) {
					stepError = error instanceof Error ? error.message : String(error);
				}
				const outcome = await host.outcome([session], Date.now() - started);
				if (outcome.hostError && stepError === null) {
					stepError = `host reported an error: ${outcome.hostError}`;
				}
				const grade = await job.benchmark.grade(host.project);
				const claimedComplete =
					job.mode === "flow"
						? completedClosure(outcome)
						: ordinaryCompletionClaim(outcome.finalText);
				const result: BenchmarkResult = {
					case: job.benchmark.id,
					model: job.model,
					attempt: job.attempt,
					mode: job.mode,
					passed: stepError === null && grade.passed,
					claimedComplete,
					falseCompletion: claimedComplete && !grade.passed,
					issues: grade.issues,
					tokens: outcome.tokens,
					costUsd: outcome.costUsd,
					assistantMessages: outcome.assistantMessages,
					durationMs: outcome.durationMs,
					finalText: outcome.finalText,
					hostError: outcome.hostError,
					...(stepError ? { error: stepError } : {}),
				};
				results.push(result);
				console.log(
					`- ${label}: ${stepError ? "ABORT" : grade.passed ? "PASS" : "FAIL"}${result.falseCompletion ? " (FALSE COMPLETION)" : ""}`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					case: job.benchmark.id,
					model: job.model,
					attempt: job.attempt,
					mode: job.mode,
					passed: false,
					claimedComplete: false,
					falseCompletion: false,
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
					durationMs: Date.now() - started,
					finalText: "",
					hostError: null,
					environment: true,
					error: message,
				});
				console.log(`- ${label}: ENVIRONMENT (${message.split("\n")[0]})`);
			} finally {
				await host?.stop();
			}
		}
	} finally {
		await rm(packDir, { recursive: true, force: true });
	}

	const summary = summarizeBenchmark(results);
	const byModel = Object.fromEntries(
		options.models.map((model) => [
			model,
			summarizeBenchmark(results.filter((result) => result.model === model)),
		]),
	);
	for (const mode of ["flow", "ordinary"] as const) {
		const arm = summary.byMode[mode];
		console.log(
			`${mode}: correctness ${percent(arm.correctnessRate)}, false completion ${percent(arm.falseCompletionRate)}, ${arm.assistantMessages} messages, ${(arm.durationMs / 1_000).toFixed(1)}s, ${cost(arm.costUsd, arm.pricedAttempts, arm.scored)}`,
		);
	}
	console.log(
		`Flow - ordinary: correctness ${delta(summary.delta.correctnessRate === null ? null : summary.delta.correctnessRate * 100, "pp")}, false completion ${delta(summary.delta.falseCompletionRate === null ? null : summary.delta.falseCompletionRate * 100, "pp")}, messages/attempt ${delta(summary.delta.assistantMessagesPerAttempt)}, seconds/attempt ${delta(summary.delta.durationMsPerAttempt === null ? null : summary.delta.durationMsPerAttempt / 1_000)}, dollars/attempt ${delta(summary.delta.costUsdPerAttempt)}`,
	);

	const resultsDir = join(import.meta.dir, "results");
	await mkdir(resultsDir, { recursive: true });
	const stamp = new Date()
		.toISOString()
		.replaceAll(":", "-")
		.replaceAll(".", "-");
	const report = join(resultsDir, `benchmark-${stamp}.json`);
	await writeFile(
		report,
		`${JSON.stringify(
			{
				flowVersion: packageJson.version,
				opencodeVersion,
				seed: options.seed,
				models: options.models,
				cases: selected.map((entry) => entry.id),
				repeat: options.repeat,
				results,
				summary,
				byModel,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	console.log(`Report: ${report}`);
}

await main();
