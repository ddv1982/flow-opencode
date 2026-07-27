import { describe, expect, test } from "bun:test";
import { SCENARIOS } from "../evals/scenarios.js";
import {
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
];

function report(overrides: {
	models?: string[];
	scenarios?: string[];
	rates?: Record<
		string,
		{ passed: number; attempts: number; unscored: number }
	>;
	falseCompletions?: number;
	unsubmitted?: number;
}) {
	const models = overrides.models ?? [
		"anthropic/claude-opus-5",
		"openai/gpt-5.6",
	];
	const scenarios = overrides.scenarios ?? GATED;
	return {
		flowVersion: "7.0.2",
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
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("at least 2");
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
		// with four gated scenarios never run. Absence had no row to fail on.
		const failures = qualificationFailures(
			report({ scenarios: ["happy-path"] }),
		);
		expect(failures).toHaveLength(4);
		for (const failure of failures) {
			expect(failure).toContain("does not contain it");
		}
	});

	test("refuses any false completion", () => {
		expect(
			qualificationFailures(report({ falseCompletions: 1 })).join(),
		).toContain("1 false completion");
	});

	test("reports an unsubmitted review assignment without failing on it", () => {
		// A stalled review in a closed session is a defect, but this count also
		// includes assignments left open by a run that correctly stopped to ask, and by
		// one the harness timed out. With no recorded baseline, gating at zero fails a
		// release over the honest outcomes before it catches the defect.
		expect(qualificationFailures(report({ unsubmitted: 2 }))).toEqual([]);
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
