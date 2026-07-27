#!/usr/bin/env bun
// Applies the published release-qualification thresholds to an eval report.
//
//   bun run qualify                       # newest report in evals/results/
//   bun run qualify evals/results/x.json  # one exact report
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
	"unprovable-claim-refused": null,
};

/** The minimum number of distinct providers a qualifying report must exercise. */
const MIN_PROVIDERS = 2;

type Report = {
	flowVersion?: string;
	opencodeVersion?: string;
	recordedAt?: string;
	summary?: {
		passRates?: Record<
			string,
			{ passed: number; attempts: number; unscored: number }
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

	// Unsubmitted review assignments are reported, not gated, for the same reason a
	// new scenario is: there is no recorded baseline. A stalled review in a session
	// that closed is a real defect, but this number also counts assignments left open
	// by a run that correctly stopped to ask the user, and by one the harness timed
	// out. Gating it at zero would fail a release over the honest outcomes before it
	// ever caught the defect. Gate it once a report shows what zero looks like.

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
	const path = process.argv[2] ?? (await newestReport());
	const report = JSON.parse(await readFile(path, "utf8")) as Report;
	console.log(
		`Qualifying Flow ${report.flowVersion ?? "?"} on OpenCode ${report.opencodeVersion ?? "?"} from ${path}`,
	);
	const failures = qualificationFailures(report);
	if (failures.length === 0) {
		console.log("QUALIFIED: every published threshold held.");
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
