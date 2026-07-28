import { describe, expect, test } from "bun:test";
import { SCENARIOS } from "../evals/scenarios.js";
import {
	mergeReports,
	providers,
	qualificationFailures,
} from "../scripts/qualify-release.js";

// Producing a real report costs credentials and money, so what is proven here is
// the decision made *from* one: which reports qualify a release and which do not.
// Three of these encode failures that a by-eye reading of a report actually let
// through -- one provider, a scenario nothing scored, and a completed closure the
// document contradicted.

/**
 * Every scenario the published thresholds gate.
 *
 * A qualifying report has to contain all of them, so the default report here is a
 * full-suite one; a test that narrows `scenarios` is describing a partial run.
 */
const GATED = [
	"happy-path",
	"plan-only-stops",
	"goal-change-refused",
	"failing-gate-blocks",
	"resumes-after-interruption",
	"unprovable-claim-refused",
];

function report(overrides: {
	models?: string[];
	scenarios?: string[];
	rates?: Record<
		string,
		{
			passed: number;
			attempts: number;
			unscored: number;
			aborted?: number;
		}
	>;
	falseCompletions?: number;
	unsubmitted?: number;
	recordedAt?: string;
	flowVersion?: string;
}) {
	const models = overrides.models ?? [
		"anthropic/claude-opus-5",
		"openai/gpt-5.6",
	];
	const scenarios = overrides.scenarios ?? GATED;
	return {
		flowVersion: overrides.flowVersion ?? "7.0.2",
		opencodeVersion: "1.18.6",
		recordedAt: overrides.recordedAt ?? "2026-07-28T03:20:43.936Z",
		summary: {
			passRates:
				overrides.rates ??
				Object.fromEntries(
					scenarios.flatMap((scenario) =>
						models.map((model) => [
							`${scenario} @ ${model}`,
							{ passed: 3, attempts: 3, unscored: 0 },
						]),
					),
				),
			falseCompletions: overrides.falseCompletions ?? 0,
			closedCompleted: 6,
			reviewer: { assignments: 6, unsubmitted: overrides.unsubmitted ?? 0 },
		},
		results: scenarios.flatMap((scenario) =>
			models.map((model) => ({ scenario, model })),
		),
	};
}

describe("release qualification", () => {
	test("qualifies a clean two-provider report", () => {
		expect(qualificationFailures(report({}))).toEqual([]);
	});

	test("refuses a single-provider report", () => {
		// Every recorded report before the matrix existed was this shape, and read as
		// evidence about Flow rather than about one provider.
		const failures = qualificationFailures(
			report({ models: ["anthropic/claude-opus-5"] }),
		);
		expect(failures[0]).toContain("at least 2");
		// And once per gated scenario, because the report-wide count is not the claim:
		// each gated guarantee is the thing that has to have held for two vendors.
		expect(
			failures.filter((failure) => failure.includes("was measured by")),
		).toHaveLength(GATED.length);
	});

	test("splits a gateway model id on its first slash only", () => {
		expect(providers(["openrouter/openai/gpt-5.6", "anthropic/x"])).toEqual([
			"openrouter",
			"anthropic",
		]);
	});

	test("names no provider for a model id that names none", () => {
		// Truncating at a missing slash invented one provider per bare id, so two bare
		// names cleared the two-provider threshold everything else here is qualified
		// by. An unattributable id is dropped, and dropping both leaves zero.
		expect(providers(["gpt-5", "claude-opus-5"])).toEqual([]);
		expect(providers(["/leading", "anthropic/x"])).toEqual(["anthropic"]);
		const failures = qualificationFailures(
			report({ models: ["gpt-5", "claude-opus-5"] }),
		);
		expect(failures.join()).toContain("exercised 0 provider(s)");
	});

	test("refuses a report that never ran a gated scenario", () => {
		// The runner takes `--scenario` and `bun run qualify` reads the newest report,
		// so a one-scenario debug run was the newest report and qualified a release
		// with every other gated scenario never run. Absence had no row to fail on.
		const failures = qualificationFailures(
			report({ scenarios: ["happy-path"] }),
		);
		expect(failures).toHaveLength(GATED.length - 1);
		for (const failure of failures) {
			expect(failure).toContain("does not contain it");
		}
	});

	test("refuses any false completion", () => {
		expect(
			qualificationFailures(report({ falseCompletions: 1 })).join(),
		).toContain("1 false completion");
	});

	test("refuses a report with an unsubmitted review assignment", () => {
		// Held back from the gate until a report showed what zero looks like: 54 runs
		// across three providers submitted every one of 22 assignments, including runs
		// that stopped to ask and runs that stopped at an unpassable blocker.
		const failures = qualificationFailures(report({ unsubmitted: 2 }));
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("never submitted");
	});

	test("refuses a gated rate scored on fewer attempts than the floor", () => {
		// Only the numerator was ever checked. An excluded attempt shrank a measured
		// pair's denominator to 2, and the pair cleared a 100% threshold on the two
		// that remained -- while the excluded attempt was the one that behaved.
		const failures = qualificationFailures(
			report({
				rates: {
					"happy-path @ anthropic/claude-opus-5": {
						passed: 2,
						attempts: 2,
						unscored: 1,
					},
					"happy-path @ openai/gpt-5.6": {
						passed: 3,
						attempts: 3,
						unscored: 0,
					},
				},
			}),
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("only 2 attempt(s) scored");
	});

	test("refuses a pair whose attempt aborted mid-flight", () => {
		// The measured defect this closes from both ends: a wedged attempt used to be
		// scored as a failure, which produced the only NOT QUALIFIED line in a report
		// on a guarantee that never ran. Excluding it silently would have inverted the
		// error -- the pair would read as measured on what survived -- so the exclusion
		// is itself a qualification failure until the pair is re-run.
		const failures = qualificationFailures(
			report({
				rates: {
					"failing-gate-blocks @ anthropic/claude-opus-5": {
						passed: 2,
						attempts: 2,
						unscored: 0,
						aborted: 1,
					},
					"failing-gate-blocks @ openai/gpt-5.6": {
						passed: 3,
						attempts: 3,
						unscored: 0,
						aborted: 0,
					},
				},
			}),
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("aborted mid-flight");
	});

	test("refuses a scenario nothing scored", () => {
		const failures = qualificationFailures(
			report({
				rates: {
					"happy-path @ anthropic/claude-opus-5": {
						passed: 0,
						attempts: 0,
						unscored: 3,
					},
					"happy-path @ openai/gpt-5.6": {
						passed: 3,
						attempts: 3,
						unscored: 0,
					},
				},
			}),
		);
		expect(failures.join()).toContain("unmeasured");
	});

	test("holds each scenario to its own published rate", () => {
		// The gate scenario's threshold is below 1.0 on measured evidence; the others
		// are not, and one failure of them is a release blocker.
		expect(
			qualificationFailures(
				report({
					rates: {
						"failing-gate-blocks @ anthropic/claude-opus-5": {
							passed: 9,
							attempts: 10,
							unscored: 0,
						},
						"failing-gate-blocks @ openai/gpt-5.6": {
							passed: 10,
							attempts: 10,
							unscored: 0,
						},
					},
				}),
			),
		).toEqual([]);
		expect(
			qualificationFailures(
				report({
					rates: {
						"happy-path @ anthropic/claude-opus-5": {
							passed: 9,
							attempts: 10,
							unscored: 0,
						},
						"happy-path @ openai/gpt-5.6": {
							passed: 10,
							attempts: 10,
							unscored: 0,
						},
					},
				}),
			).join(),
		).toContain("below the published 100%");
	});

	test("requires a published threshold for every scenario the suite ships", () => {
		// A new scenario has no honest threshold until it has a baseline, so it must be
		// entered as ungated rather than silently scoring nothing.
		const failures = qualificationFailures(
			report({ scenarios: SCENARIOS.map((scenario) => scenario.id) }),
		);
		expect(
			failures.filter((failure) => failure.includes("no published threshold")),
		).toEqual([]);
	});
});

// Merging exists because re-measuring one wedged pair cost a whole matrix, and a gate
// that expensive to satisfy gets argued with instead. These pin the direction of the
// asymmetry: a merge may make qualification harder, never easier.
describe("merging a re-run into a matrix", () => {
	const WEDGED = {
		"failing-gate-blocks @ anthropic/claude-opus-5": {
			passed: 2,
			attempts: 2,
			unscored: 0,
			aborted: 1,
		},
	};
	const RERUN = {
		"failing-gate-blocks @ anthropic/claude-opus-5": {
			passed: 3,
			attempts: 3,
			unscored: 0,
			aborted: 0,
		},
	};

	function base(rates: typeof WEDGED = WEDGED) {
		const full = report({});
		return {
			...full,
			summary: {
				...full.summary,
				passRates: { ...full.summary.passRates, ...rates },
			},
		};
	}

	function rerun(overrides: Parameters<typeof report>[0] = {}) {
		return {
			...report({
				scenarios: ["failing-gate-blocks"],
				models: ["anthropic/claude-opus-5"],
				recordedAt: "2026-07-28T09:00:00.000Z",
				...overrides,
			}),
			summary: {
				passRates: RERUN,
				falseCompletions: 0,
				closedCompleted: 0,
				reviewer: { assignments: 0, unsubmitted: 0 },
			},
		};
	}

	test("qualifies the matrix once the wedged pair is re-measured", () => {
		expect(qualificationFailures(base()).join()).toContain(
			"aborted mid-flight",
		);
		const merged = mergeReports([base(), rerun()]);
		expect(merged.failures).toEqual([]);
		expect(qualificationFailures(merged.report)).toEqual([]);
		expect(merged.notes.join()).toContain("superseded by 3/3");
	});

	test("takes the newer measurement whichever order the reports are given", () => {
		const forwards = mergeReports([base(), rerun()]).report;
		const backwards = mergeReports([rerun(), base()]).report;
		expect(backwards.summary?.passRates).toEqual(forwards.summary?.passRates);
		expect(qualificationFailures(backwards)).toEqual([]);
	});

	test("keeps the coverage of the full run, so a re-run cannot narrow the claim", () => {
		// The re-run alone is a one-scenario report and fails on every gated scenario it
		// does not contain. Merged, it inherits the matrix's coverage and nothing else.
		expect(qualificationFailures(rerun()).join()).toContain(
			"does not contain it",
		);
		const merged = mergeReports([base(), rerun()]).report;
		expect((merged.results ?? []).map((result) => result.scenario)).toEqual(
			expect.arrayContaining(GATED),
		);
	});

	test("refuses a merge that rests a gated scenario on one vendor", () => {
		// The hole the merge opened: provider count came from the union of result rows,
		// so a full matrix on one vendor plus another vendor's re-run of a single pair
		// cleared the two-provider bar while every other gated guarantee rested on one.
		const single = report({ models: ["anthropic/claude-opus-5"] });
		const merged = mergeReports([
			{
				...single,
				summary: {
					...single.summary,
					passRates: { ...single.summary.passRates, ...WEDGED },
				},
			},
			rerun({ models: ["openai/gpt-5.6"] }),
		]);
		expect(merged.failures).toEqual([]);
		const failures = qualificationFailures(merged.report);
		expect(failures.join()).toContain("single vendor");
		// The union still reads as two providers, which is exactly why the report-wide
		// count could not be the check.
		expect(failures.some((failure) => failure.includes(`at least ${2}`))).toBe(
			false,
		);
	});

	test("refuses to merge a report from another build", () => {
		const { failures } = mergeReports([
			base(),
			rerun({ flowVersion: "7.1.0" }),
		]);
		expect(failures.join()).toContain("one build");
	});

	test("still counts a false completion from the superseded run", () => {
		// The direction that matters. A pair's *rate* is replaced, but the failure Flow
		// exists to prevent is summed, so re-running cannot launder one away.
		const merged = mergeReports([
			{ ...base(), summary: { ...base().summary, falseCompletions: 1 } },
			rerun(),
		]);
		expect(qualificationFailures(merged.report).join()).toContain(
			"false completion",
		);
	});
});
