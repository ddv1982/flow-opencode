// The triage ranking, which is a set of guesses about what is worth reading.
//
// Guesses need tests more than rules do: the first version of this flagged 32 of 54
// runs in a real report, almost all of them the suite behaving correctly, and a list
// that long is the same as no list. These pin the two exclusions that fixed it.

import { describe, expect, test } from "bun:test";
import { completionHonesty, reviewerActivity } from "../evals/metrics.js";
import { triage } from "../scripts/triage-report.js";

type Run = Parameters<typeof triage>[0]["results"] extends
	| readonly (infer T)[]
	| undefined
	? T
	: never;

function run(overrides: Partial<Run> = {}): Run {
	return {
		scenario: "happy-path",
		model: "vendor/model",
		attempt: 1,
		passed: true,
		issues: [],
		questions: [],
		finalText: "done",
		flowCalls: ["flow_plan_save"],
		honesty: completionHonesty(null),
		reviewer: reviewerActivity([]),
		refusedBroadScope: 0,
		durationMs: 1_000,
		costUsd: 0.1,
		...overrides,
	} as Run;
}

function flagged(runs: readonly Run[]): string[][] {
	return triage({ results: runs }).ranked.map((entry) => entry.why);
}

describe("eval report triage", () => {
	test("flags nothing about an ordinary passing run", () => {
		const { ranked, quiet } = triage({ results: [run()] });
		expect(ranked).toEqual([]);
		expect(quiet).toHaveLength(1);
	});

	test("ranks a false completion above everything else", () => {
		const { ranked } = triage({
			results: [
				run({ scenario: "wedged", error: "Scenario exceeded 1200000ms" }),
				run({ scenario: "failed", passed: false, issues: ["wrong closure"] }),
				run({
					scenario: "dishonest",
					honesty: {
						closedCompleted: true,
						gaps: ["no-final-review"],
						falseCompletion: true,
					},
				}),
			],
		});
		expect(ranked.map((entry) => entry.run.scenario)).toEqual([
			"dishonest",
			"wedged",
			"failed",
		]);
	});

	test("ignores an escalation every attempt of the pair made", () => {
		// Two scenarios are designed to end by asking. Three of three asking is the
		// contract working, and flagging each one is what buried the real findings.
		const asked = [1, 2, 3].map((attempt) =>
			run({ scenario: "failing-gate-blocks", attempt, escalated: true }),
		);
		expect(flagged(asked)).toEqual([]);
	});

	test("flags an escalation only one attempt of the pair made", () => {
		const mixed = [
			run({ scenario: "goal-change-refused", attempt: 1, escalated: true }),
			run({ scenario: "goal-change-refused", attempt: 2 }),
			run({ scenario: "goal-change-refused", attempt: 3 }),
		];
		const why = flagged(mixed);
		expect(why).toHaveLength(1);
		expect(why[0]?.[0]).toContain("2 of 3");
	});

	test("ignores one silent review pass and flags several in the same run", () => {
		const one = reviewerActivity([
			{
				runs: [{ reviews: [{ result: { verdict: "passed", findings: [] } }] }],
			},
		]);
		expect(flagged([run({ reviewer: one })])).toEqual([]);
		const several = reviewerActivity([
			{
				runs: [
					{
						reviews: [
							{ result: { verdict: "passed", findings: [] } },
							{ result: { verdict: "passed", findings: [] } },
						],
					},
				],
			},
		]);
		expect(flagged([run({ reviewer: several })])[0]?.[0]).toContain(
			"all 2 review(s)",
		);
	});

	test("flags an unsubmitted review, which no pass rate shows", () => {
		const unsubmitted = reviewerActivity([
			{ runs: [{ reviews: [{ kind: "final", result: null }] }] },
		]);
		expect(flagged([run({ reviewer: unsubmitted })])[0]?.[0]).toContain(
			"never submitted",
		);
	});

	test("flags refused broad-scope claims, which no document records", () => {
		expect(flagged([run({ refusedBroadScope: 2 })])[0]?.[0]).toContain(
			"broad-scope claim(s) refused",
		);
	});
});
