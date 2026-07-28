#!/usr/bin/env bun
// Ranks an eval report's runs by how much reading each one is worth.
//
//   bun run triage                          # newest report in evals/results/
//   bun run triage -- --run happy-path      # every attempt of one scenario, in full
//   bun run triage -- evals/results/x.json
//
// `bun run qualify` answers whether a report clears the bar. This answers the
// question that has to come first and had no tooling at all: which of these runs
// should a human actually read? A pass rate cannot say. A `PASS` whose reviewer
// found nothing on every assignment, an `ASKED` whose question was the correct move,
// and a `FAIL` whose issue is one stale assertion all read identically in a table.
//
// Ranking rather than filtering, because every heuristic here is a guess about
// *interest*, and a run this is wrong about should be further down a list rather
// than absent from one.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletionHonesty, ReviewerActivity } from "../evals/metrics.js";

type Run = {
	scenario?: string;
	model?: string;
	attempt?: number;
	passed?: boolean;
	environment?: boolean;
	escalated?: boolean;
	unscored?: boolean;
	issues?: readonly string[];
	questions?: readonly string[];
	finalText?: string;
	flowCalls?: readonly string[];
	sessionBoundaries?: readonly number[];
	honesty?: CompletionHonesty;
	reviewer?: ReviewerActivity;
	refusedBroadScope?: number;
	documents?: readonly Record<string, unknown>[];
	durationMs?: number;
	costUsd?: number | null;
	error?: string;
};

type Report = {
	flowVersion?: string;
	opencodeVersion?: string;
	recordedAt?: string;
	results?: readonly Run[];
};

type PairContext = Readonly<{ attempts: number; escalations: number }>;

/**
 * Why this run is worth reading, most important first.
 *
 * Each entry is a reason and a weight. The reasons are printed, because a rank with no
 * stated reason is just an opinion the reader has to reverse-engineer. Two things that
 * look like reasons are deliberately not here: a scored escalation in a scenario where
 * every attempt asked, and a lone silent review pass. Both are the expected shape, and
 * flagging them buried everything else — 32 of 54 runs on the first report this ran
 * against, almost all of them the suite working.
 */
function reasons(
	run: Run,
	pair: PairContext,
): { weight: number; why: string }[] {
	const found: { weight: number; why: string }[] = [];
	if (run.honesty?.falseCompletion) {
		found.push({
			weight: 100,
			why: `claimed completion the document contradicts (${run.honesty.gaps.join(", ")})`,
		});
	}
	if ((run.reviewer?.unsubmitted ?? 0) > 0) {
		found.push({
			weight: 60,
			why: `${run.reviewer?.unsubmitted} review assignment(s) never submitted`,
		});
	}
	if (run.error) {
		found.push({
			weight: 50,
			why: `aborted mid-flight: ${run.error.split("\n")[0]}`,
		});
	}
	if (run.passed === false && !run.environment && !run.unscored && !run.error) {
		found.push({
			weight: 40,
			why: `wrong durable outcome: ${(run.issues ?? []).join("; ") || "no issue recorded"}`,
		});
	}
	if (run.unscored) {
		found.push({
			weight: 30,
			why: "asked the user somewhere the scenario does not allow, so nothing was scored",
		});
	}
	// A scored escalation only reads as interesting when it is an *outlier* for its
	// pair. Two scenarios are designed to end by asking, so every attempt of those
	// asking is the contract working, and flagging each one buries the rest of the
	// list under the suite's most expected behavior. One attempt of three asking is
	// the finding.
	if (run.escalated && !run.unscored && pair.escalations < pair.attempts) {
		found.push({
			weight: 20,
			why: `asked the user where ${pair.attempts - pair.escalations} of ${pair.attempts} attempt(s) of this pair did not`,
		});
	}
	// More than one review in the same run, all of them finding nothing, is where a
	// reviewer that reads nothing starts to be distinguishable from clean work. One
	// silent pass is what a clean change should produce and is a suite-level trend
	// instead.
	const reviewer = run.reviewer;
	if (
		reviewer &&
		reviewer.assignments > 1 &&
		reviewer.assignments === reviewer.silentPasses
	) {
		found.push({
			weight: 15,
			why: `all ${reviewer.assignments} review(s) in this run passed with no finding`,
		});
	}
	if ((run.refusedBroadScope ?? 0) > 0) {
		found.push({
			weight: 10,
			why: `${run.refusedBroadScope} broad-scope claim(s) refused; no document records these`,
		});
	}
	if ((run.honesty?.gaps ?? []).length > 0 && !run.honesty?.falseCompletion) {
		found.push({
			weight: 5,
			why: `evidence gaps without a completed closure (${run.honesty?.gaps.join(", ")})`,
		});
	}
	return found.toSorted((left, right) => right.weight - left.weight);
}

function label(run: Run): string {
	return `${run.scenario ?? "?"} @ ${run.model ?? "?"} #${run.attempt ?? 0}`;
}

function verdict(run: Run): string {
	if (run.environment) return "ENV";
	if (run.error) return "ABORT";
	if (run.unscored) return "ASKED";
	return `${run.passed ? "PASS" : "FAIL"}${run.escalated ? "+ASK" : ""}`;
}

function indent(text: string, prefix = "    "): string {
	const trimmed = text.trim();
	if (trimmed === "") return `${prefix}(none)`;
	return trimmed
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}

/** Everything about one run a reader needs without opening the JSON. */
function detail(run: Run): string {
	const spine = (run.flowCalls ?? []).map((call, index) =>
		(run.sessionBoundaries ?? []).includes(index) ? `| ${call}` : call,
	);
	const lines = [
		`${label(run)}  ${verdict(run)}  ${Math.round((run.durationMs ?? 0) / 1000)}s  ${
			run.costUsd === null || run.costUsd === undefined
				? "cost unreported"
				: `$${run.costUsd.toFixed(4)}`
		}`,
		"",
		`  spine (| marks a new host session):`,
		indent(spine.join(" -> ") || "(no Flow calls)"),
		"",
		`  issues:`,
		indent((run.issues ?? []).join("\n")),
		"",
		`  questions asked:`,
		indent((run.questions ?? []).join("\n")),
		"",
		`  final report:`,
		indent(run.finalText ?? ""),
	];
	const reviewer = run.reviewer;
	if (reviewer && reviewer.assignments > 0) {
		lines.push(
			"",
			`  reviewer: ${reviewer.assignments} assignment(s), ${reviewer.passed} passed (${reviewer.silentPasses} silent), ${reviewer.failed} failed, ${reviewer.unsubmitted} unsubmitted, ${reviewer.blockingFindings} blocking + ${reviewer.advisoryFindings} advisory`,
		);
	}
	return lines.join("\n");
}

async function newestReport(): Promise<string> {
	const directory = join(import.meta.dir, "..", "evals", "results");
	const names = (await readdir(directory))
		.filter((name) => name.endsWith(".json"))
		.sort();
	const newest = names.at(-1);
	if (!newest) {
		throw new Error(
			`No eval report in ${directory}. Run \`bun run eval\` first.`,
		);
	}
	return join(directory, newest);
}

export function triage(report: Report): {
	ranked: { run: Run; weight: number; why: string[] }[];
	quiet: Run[];
} {
	const ranked: { run: Run; weight: number; why: string[] }[] = [];
	const quiet: Run[] = [];
	const pairs = new Map<string, { attempts: number; escalations: number }>();
	for (const run of report.results ?? []) {
		const key = `${run.scenario}@${run.model}`;
		const pair = pairs.get(key) ?? { attempts: 0, escalations: 0 };
		pair.attempts += 1;
		if (run.escalated) pair.escalations += 1;
		pairs.set(key, pair);
	}
	for (const run of report.results ?? []) {
		const found = reasons(
			run,
			pairs.get(`${run.scenario}@${run.model}`) ?? {
				attempts: 1,
				escalations: 0,
			},
		);
		if (found.length === 0) {
			quiet.push(run);
			continue;
		}
		ranked.push({
			run,
			weight: found[0]?.weight ?? 0,
			why: found.map((entry) => entry.why),
		});
	}
	return {
		ranked: ranked.toSorted((left, right) => right.weight - left.weight),
		quiet,
	};
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let path: string | null = null;
	let only: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--run" && value) {
			only = value;
			index += 1;
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"usage: bun run triage -- [report.json] [--run <scenario>]\n\nRanks a report's runs by how much reading each is worth. --run prints every\nattempt of one scenario in full.",
			);
			process.exit(0);
		} else if (flag && !flag.startsWith("-")) {
			path = flag;
		}
	}
	const reportPath = path ?? (await newestReport());
	const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
	console.log(
		`${reportPath}\nFlow ${report.flowVersion ?? "?"} on OpenCode ${report.opencodeVersion ?? "?"}, recorded ${report.recordedAt ?? "?"}\n`,
	);

	if (only !== null) {
		const matched = (report.results ?? []).filter(
			(run) => run.scenario === only || label(run).includes(only),
		);
		if (matched.length === 0) {
			console.error(`No run in this report matched ${JSON.stringify(only)}.`);
			process.exit(2);
		}
		console.log(matched.map(detail).join("\n\n---\n\n"));
		return;
	}

	const { ranked, quiet } = triage(report);
	if (ranked.length === 0) {
		console.log(
			`Nothing flagged across ${quiet.length} run(s). That is a finding worth one spot check: read one at random with \`--run <scenario>\`, because a suite that never flags anything and a suite that measures nothing look the same from here.`,
		);
		return;
	}
	console.log(
		`Read these first (${ranked.length} of ${(report.results ?? []).length}):\n`,
	);
	for (const [index, entry] of ranked.entries()) {
		console.log(
			`${index + 1}. ${label(entry.run)}  ${verdict(entry.run)}\n${entry.why
				.map((why) => `   - ${why}`)
				.join("\n")}`,
		);
	}
	if (quiet.length > 0) {
		// Counted, not listed: the list was 49 names on the first report this ran
		// against, which is the noise the ranking exists to remove.
		console.log(`\n${quiet.length} run(s) flagged nothing.`);
	}
	// The suite-level number the per-run rank deliberately leaves out, with one run
	// named: a reviewer whose every verdict is a silent pass is indistinguishable from
	// one that reads nothing, and that is only visible in aggregate.
	const reviews = (report.results ?? []).reduce(
		(total, run) => ({
			assignments: total.assignments + (run.reviewer?.assignments ?? 0),
			silent: total.silent + (run.reviewer?.silentPasses ?? 0),
		}),
		{ assignments: 0, silent: 0 },
	);
	if (reviews.assignments > 0) {
		console.log(
			`\nreviewer: ${reviews.silent}/${reviews.assignments} assignment(s) passed with no finding at all. A clean change should, so this is a trend and not a defect — read one to confirm the reviewer is reading.`,
		);
	}
	console.log(
		`\nRead one in full with \`bun run triage -- ${reportPath} --run <scenario>\`.`,
	);
}

if (import.meta.main) await main();
