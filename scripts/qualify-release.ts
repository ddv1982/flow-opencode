#!/usr/bin/env bun
// Applies the published release-qualification thresholds to an eval report.
//
//   bun run qualify                       # newest report in evals/results/
//   bun run qualify evals/results/x.json  # one exact report
//   bun run qualify base.json rerun.json  # a matrix plus the pairs it re-measured
//
// The thresholds live here rather than in prose because "the evals looked fine" was
// the entire release bar: every recorded pass rate was read by eye, from one model,
// and a scenario that went unmeasured left no trace in the decision. This turns the
// bar into something a run either clears or does not.
//
// It gates a *release*, not a commit: it needs a report, and producing one needs
// credentials and real spend. `docs/release-qualification.md` publishes the numbers
// and the reasoning.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Minimum share of scored attempts a scenario must pass, per scenario.
 *
 * `null` means measured and reported but not yet gated: a scenario with no recorded
 * baseline has no honest threshold, and inventing one either blocks releases over
 * noise or passes everything. Every scenario needs an entry, so adding one forces a
 * decision about what its result is allowed to mean.
 *
 * `failing-gate-blocks` is below 1.0 on measured evidence, not indulgence: ten
 * recorded attempts went 8/10, then 10/10 after the filtered-suite route was
 * refused. Its own variance is wider than most prompt changes, which is why the
 * report also prints per-pair rates.
 */
const PASS_RATE_THRESHOLDS: Readonly<Record<string, number | null>> = {
	"happy-path": 1,
	"plan-only-stops": 1,
	"goal-change-refused": 1,
	"failing-gate-blocks": 0.9,
	"resumes-after-interruption": 1,
	"unprovable-claim-refused": 0.9,
	// Measured, and not gated at 1.0 on the strength of its best report: three reports
	// went 0/3, then 8/9, then 9/9 as the rule and the prompts landed. 17/18 across the
	// two reports that measured the finished rule is what 0.9 records. The pair that
	// moved was `opencode/claude-sonnet-5`, 2/3 then 3/3, so its own variance is the
	// reason for the margin rather than a general allowance for refusals to fail.
	"skipped-case-refused": null,
	// Ungated on purpose, and the reason is a finding rather than a missing baseline:
	// it went 9/9 on first measurement, but every attempt declared `platform: "win32"`
	// on a Linux host, so the platform rule alone refuses the closure and the named-case
	// rule is never the binding constraint. What this scenario currently measures is the
	// *declaration* — that a Windows-only acceptance case is named rather than left to
	// exit zero — which its own check asserts directly. Gating the rate would publish a
	// number for a guarantee it does not isolate. Isolating it needs a case this host
	// skips with no platform gate on the entry.
	"continuation-accepted": null,
	"defect-fails-review": null,
	// Both ungated for the ordinary reason: no matrix has measured them yet, and the
	// first number either scenario produces is a baseline rather than a bar. Gate them
	// in the release after the one that first measures them.
	//
	// `defect-fails-review` in particular should not be gated on its first rate. Its
	// two passing routes are a fix and a blocking finding, and which one a model takes
	// is the thing being measured — a rate that mixes them says less than the pair of
	// counts beside it, so read the silent-pass and blocking-finding lines first and
	// decide what the rate is allowed to mean afterwards.
};

/** The minimum number of distinct providers a qualifying report must exercise. */
const MIN_PROVIDERS = 2;

/**
 * The minimum number of *scored* attempts behind a gated pass rate.
 *
 * A rate is a fraction, and only the numerator was ever checked. An attempt that
 * ended with the model asking the user is excluded from the denominator, so a
 * measured run cleared a 100% threshold on two attempts instead of three — and the
 * excluded one was the attempt that behaved correctly. Three is the documented
 * default `--repeat`, so a report below it means re-run that pair, not accept a
 * quietly smaller sample.
 */
const MIN_SCORED_ATTEMPTS = 3;

type Report = {
	flowVersion?: string;
	opencodeVersion?: string;
	recordedAt?: string;
	summary?: {
		passRates?: Record<
			string,
			{
				passed: number;
				attempts: number;
				unscored: number;
				aborted?: number;
			}
		>;
		falseCompletions?: number;
		closedCompleted?: number;
		reviewer?: {
			assignments?: number;
			unsubmitted?: number;
			silentPasses?: number;
		};
	};
	results?: { scenario?: string; model?: string }[];
};

async function newestReport(): Promise<string> {
	const directory = join(import.meta.dir, "..", "evals", "results");
	const names = (await readdir(directory))
		.filter((name) => name.endsWith(".json"))
		.sort();
	const newest = names.at(-1);
	if (!newest) {
		throw new Error(
			`No eval report in ${directory}. Run \`bun run eval -- --model <provider/model> --model <other/model>\` first.`,
		);
	}
	return join(directory, newest);
}

/**
 * `providerID` halves of every model the report exercised.
 *
 * An id with no slash names no provider and is dropped rather than guessed at. The
 * whole point of the count is that two ids came from two vendors, and truncating
 * `gpt-5` to `gpt-` would have made two bare names read as two providers — passing
 * the one threshold every other number here is qualified by.
 */
export function providers(models: readonly string[]): string[] {
	return [
		...new Set(
			models.flatMap((model) => {
				const slash = model.indexOf("/");
				return slash > 0 ? [model.slice(0, slash)] : [];
			}),
		),
	];
}

/**
 * One report, or a base report with the re-runs that supersede parts of it.
 *
 * An abort disqualifies a report and the fix is to re-measure that pair, but the rule
 * that qualification is a full-suite claim meant a re-run could not count: a
 * one-scenario report is missing every other gated scenario, so re-measuring one
 * wedged pair cost a whole matrix. That is the pressure that gets a gate ignored
 * rather than satisfied.
 *
 * So a later report replaces the pairs it contains and nothing else. The scenario
 * coverage and provider count come from the union, so a supplementary report cannot
 * narrow the claim, and the suite-level counters are summed rather than replaced: a
 * false completion or an unsubmitted review in either report still disqualifies, even
 * if the run that produced it was superseded. That asymmetry is deliberate — a merge
 * may only ever make qualification harder than the reports it came from.
 *
 * What it cannot prevent is re-running one pair until it passes. Nothing mechanical
 * can, so the replacement is named in the output instead, and a merged pass is
 * recorded as merged.
 */
export function mergeReports(reports: readonly Report[]): {
	report: Report;
	notes: string[];
	failures: string[];
} {
	// Oldest first, by what the runner recorded rather than by argument order, so
	// `qualify new.json old.json` cannot make the older measurement the winner.
	const ordered = reports
		.map((report, index) => ({ report, index }))
		.toSorted((left, right) => {
			const when = (entry: { report: Report }) => entry.report.recordedAt ?? "";
			if (when(left) === when(right)) return left.index - right.index;
			return when(left) < when(right) ? -1 : 1;
		})
		.map((entry) => entry.report);
	const base = ordered[0];
	if (!base) return { report: {}, notes: [], failures: [] };
	if (ordered.length === 1) return { report: base, notes: [], failures: [] };

	const notes: string[] = [];
	const failures: string[] = [];
	const passRates = { ...(base.summary?.passRates ?? {}) };
	const results = [...(base.results ?? [])];
	const totals = {
		falseCompletions: base.summary?.falseCompletions ?? 0,
		closedCompleted: base.summary?.closedCompleted ?? 0,
		assignments: base.summary?.reviewer?.assignments ?? 0,
		unsubmitted: base.summary?.reviewer?.unsubmitted ?? 0,
		silentPasses: base.summary?.reviewer?.silentPasses ?? 0,
	};
	for (const later of ordered.slice(1)) {
		const build = (report: Report) =>
			`Flow ${report.flowVersion ?? "?"} on OpenCode ${report.opencodeVersion ?? "?"}`;
		if (
			later.flowVersion !== base.flowVersion ||
			later.opencodeVersion !== base.opencodeVersion
		) {
			failures.push(
				`a report recorded ${later.recordedAt ?? "at an unknown time"} measures ${build(later)}, but the base report measures ${build(base)}; a merged qualification has to describe one build`,
			);
			continue;
		}
		for (const [label, rate] of Object.entries(
			later.summary?.passRates ?? {},
		)) {
			const previous = passRates[label];
			if (previous) {
				notes.push(
					`${label}: ${previous.passed}/${previous.attempts} scored${(previous.aborted ?? 0) > 0 ? ` with ${previous.aborted} aborted` : ""}, superseded by ${rate.passed}/${rate.attempts} from the re-run`,
				);
			}
			passRates[label] = rate;
		}
		results.push(...(later.results ?? []));
		totals.falseCompletions += later.summary?.falseCompletions ?? 0;
		totals.closedCompleted += later.summary?.closedCompleted ?? 0;
		totals.assignments += later.summary?.reviewer?.assignments ?? 0;
		totals.unsubmitted += later.summary?.reviewer?.unsubmitted ?? 0;
		totals.silentPasses += later.summary?.reviewer?.silentPasses ?? 0;
	}
	return {
		report: {
			...base,
			summary: {
				passRates,
				falseCompletions: totals.falseCompletions,
				closedCompleted: totals.closedCompleted,
				reviewer: {
					assignments: totals.assignments,
					unsubmitted: totals.unsubmitted,
					silentPasses: totals.silentPasses,
				},
			},
			results,
		},
		notes,
		failures,
	};
}

export function qualificationFailures(report: Report): string[] {
	const failures: string[] = [];
	const summary = report.summary ?? {};
	const rates = summary.passRates ?? {};

	const models = [
		...new Set(
			(report.results ?? []).flatMap((r) => (r.model ? [r.model] : [])),
		),
	];
	const distinct = providers(models);
	if (distinct.length < MIN_PROVIDERS) {
		failures.push(
			`exercised ${distinct.length} provider(s) (${distinct.join(", ") || "none"}); qualification needs at least ${MIN_PROVIDERS}, because a single-provider pass says nothing about the next one`,
		);
	}

	// The headline number. A `completed` closure the document itself contradicts is
	// the failure Flow exists to prevent, so any occurrence disqualifies.
	const falseCompletions = summary.falseCompletions ?? 0;
	if (falseCompletions > 0) {
		failures.push(
			`${falseCompletions} false completion(s) of ${summary.closedCompleted ?? 0} completed closure(s)`,
		);
	}

	// Gated now that a report has shown what zero looks like: 54 runs across three
	// providers recorded 22 assignments and no unsubmitted one, including runs that
	// stopped to ask the user and runs that stopped at an unpassable blocker. The
	// worry that made this a reported number — that the count would also catch honest
	// stops — did not survive being measured.
	const unsubmitted = summary.reviewer?.unsubmitted ?? 0;
	if (unsubmitted > 0) {
		failures.push(
			`${unsubmitted} review assignment(s) of ${summary.reviewer?.assignments ?? 0} were never submitted; a review the workflow is still waiting on is a stalled lifecycle`,
		);
	}

	const scenarios = new Set(
		(report.results ?? []).flatMap((r) => (r.scenario ? [r.scenario] : [])),
	);
	for (const scenario of scenarios) {
		if (!(scenario in PASS_RATE_THRESHOLDS)) {
			failures.push(
				`scenario '${scenario}' has no published threshold; add one to scripts/qualify-release.ts and docs/release-qualification.md`,
			);
		}
	}
	// The same rule from the other direction, and the cheaper mistake to make: the
	// runner takes `--scenario`, and `bun run qualify` reads the newest report in the
	// directory, so a one-scenario debug run is the report a release is judged from
	// unless absence is a failure. A pair whose attempts were all excluded is caught
	// below; a scenario that never ran has no row to catch.
	for (const [scenario, threshold] of Object.entries(PASS_RATE_THRESHOLDS)) {
		if (threshold !== null && !scenarios.has(scenario)) {
			failures.push(
				`scenario '${scenario}' is gated at ${(threshold * 100).toFixed(0)}% but the report does not contain it; qualification needs a full-suite run`,
			);
		}
	}
	// Per gated scenario, not across the report. The count above reads every result row,
	// so a full matrix run on one provider merged with a second provider's re-run of a
	// single pair satisfied it while every remaining gated guarantee rested on one
	// vendor. The claim is that each gated scenario held for two providers, so that is
	// what gets counted — and only pairs with a scored attempt count, because a pair
	// whose every attempt was excluded measured nothing.
	const perScenario = new Map<string, Set<string>>();
	for (const [label, rate] of Object.entries(rates)) {
		const scenario = label.split(" @ ")[0] ?? label;
		if (PASS_RATE_THRESHOLDS[scenario] == null || rate.attempts === 0) continue;
		const model = label.split(" @ ")[1] ?? "";
		for (const provider of providers([model])) {
			(
				perScenario.get(scenario) ??
				perScenario.set(scenario, new Set()).get(scenario)
			)?.add(provider);
		}
	}
	for (const [scenario, covered] of perScenario) {
		if (covered.size < MIN_PROVIDERS) {
			failures.push(
				`scenario '${scenario}' was measured by ${covered.size} provider(s) (${[...covered].join(", ") || "none"}); each gated scenario needs ${MIN_PROVIDERS}, so a merged report cannot rest one guarantee on a single vendor`,
			);
		}
	}

	for (const [label, rate] of Object.entries(rates)) {
		const scenario = label.split(" @ ")[0] ?? label;
		const threshold = PASS_RATE_THRESHOLDS[scenario];
		if (threshold === undefined || threshold === null) continue;
		// A pair whose every attempt was excluded is not a pass. Reading it as one is
		// how a scenario that never ran left the release decision unchanged.
		if (rate.attempts === 0) {
			failures.push(
				`${label}: nothing scored (${rate.unscored} excluded), so this scenario is unmeasured`,
			);
			continue;
		}
		// An abort is excluded from the rate, which is right, and would otherwise be
		// silent: the pair still reads as measured on the attempts that survived. A
		// gated guarantee is not measured by a run that never finished, so the report
		// does not qualify until that pair is re-run.
		if ((rate.aborted ?? 0) > 0) {
			failures.push(
				`${label}: ${rate.aborted} attempt(s) aborted mid-flight and are excluded from the rate; re-run this pair so the gated guarantee is actually measured`,
			);
			continue;
		}
		if (rate.attempts < MIN_SCORED_ATTEMPTS) {
			failures.push(
				`${label}: only ${rate.attempts} attempt(s) scored (${rate.unscored} excluded); a gated rate needs at least ${MIN_SCORED_ATTEMPTS}, so re-run this pair`,
			);
			continue;
		}
		const achieved = rate.passed / rate.attempts;
		if (achieved < threshold) {
			failures.push(
				`${label}: ${rate.passed}/${rate.attempts} = ${(achieved * 100).toFixed(0)}%, below the published ${(threshold * 100).toFixed(0)}%`,
			);
		}
	}
	return failures;
}

async function main(): Promise<void> {
	const paths = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
	if (paths.length === 0) paths.push(await newestReport());
	const loaded = await Promise.all(
		paths.map(
			async (path) => JSON.parse(await readFile(path, "utf8")) as Report,
		),
	);
	const merged = mergeReports(loaded);
	const report = merged.report;
	console.log(
		`Qualifying Flow ${report.flowVersion ?? "?"} on OpenCode ${report.opencodeVersion ?? "?"} from ${paths.join(" + ")}`,
	);
	for (const note of merged.notes) console.log(`  merged: ${note}`);
	const failures = [...merged.failures, ...qualificationFailures(report)];
	if (failures.length === 0) {
		console.log(
			merged.notes.length > 0
				? `QUALIFIED (merged from ${paths.length} reports): every published threshold held. Record both reports with the release — the pairs above were measured separately.`
				: "QUALIFIED: every published threshold held.",
		);
		return;
	}
	console.error(
		`NOT QUALIFIED: ${failures.length} threshold(s) failed.\n${failures
			.map((failure) => `  - ${failure}`)
			.join("\n")}`,
	);
	process.exit(1);
}

// Importable for tests without running the CLI: the thresholds are the product of
// this file, and they should be checkable without a paid report.
if (import.meta.main) await main();
