import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	FLOW_PROMPT_MODE_CAPTURE_MODES,
	getFlowModeSourcePaths,
} from "../src/prompts/mode-contracts";
import {
	buildPromptModeBehaviorEvalSummary,
	listPromptModeBehaviorEvalFixtureFiles,
	readPromptModeBehaviorEvalCorpus,
	scorePromptModeBehaviorEvalCase,
	scorePromptModeBehaviorModelOutput,
} from "./prompt-mode-behavior-eval-helpers";

describe("prompt mode behavior eval corpus", () => {
	test("mode behavior fixtures are first-party and cover non-review modes", async () => {
		const corpus = readPromptModeBehaviorEvalCorpus();
		expect(corpus).toHaveLength(18);
		expect(corpus.filter((item) => item.origin === "captured")).toHaveLength(6);
		expect(new Set(corpus.map((item) => item.mode))).toEqual(
			new Set(FLOW_PROMPT_MODE_CAPTURE_MODES),
		);

		const fixtureFiles = listPromptModeBehaviorEvalFixtureFiles();
		expect(fixtureFiles.length).toBeGreaterThanOrEqual(1);

		for (const fixtureFile of fixtureFiles) {
			const raw = await readFile(fixtureFile, "utf8");
			expect(raw.includes(".factory")).toBe(false);
		}

		for (const item of corpus) {
			expect(item.sourcePaths).toEqual(
				expect.arrayContaining(getFlowModeSourcePaths(item.mode)),
			);
			for (const sourcePath of item.sourcePaths) {
				expect(existsSync(join(import.meta.dir, "..", sourcePath))).toBe(true);
			}
		}
	});

	test("rubric accepts calibrated mode outputs and rejects boundary regressions", () => {
		const results = readPromptModeBehaviorEvalCorpus().map(
			scorePromptModeBehaviorEvalCase,
		);
		const byId = Object.fromEntries(
			results.map((result) => [result.id, result]),
		);

		expect(byId["plan-goal-records-context-and-stops"]?.score).toBe(6);
		expect(byId["auto-missing-goal-stops-after-prepare"]?.score).toBe(6);
		expect(
			byId["worker-validates-reviews-and-persists-clean-feature"]?.score,
		).toBe(6);
		expect(byId["run-one-feature-review-gated"]?.score).toBe(6);
		expect(byId["reviewer-needs-fix-on-missing-validation"]?.score).toBe(6);
		expect(byId["control-status-is-read-only"]?.score).toBe(6);

		expect(byId["plan-bad-starts-implementation"]?.passed).toBe(false);
		expect(byId["auto-bad-infers-goal-after-missing-goal"]?.passed).toBe(false);
		expect(byId["worker-bad-completes-without-validation"]?.passed).toBe(false);
		expect(byId["run-bad-executes-every-feature"]?.passed).toBe(false);
		expect(byId["reviewer-bad-approves-without-validation"]?.passed).toBe(
			false,
		);
		expect(byId["control-bad-starts-work-from-status"]?.passed).toBe(false);
	});

	test("fixture-declared expected failures match mode rubric failures", () => {
		for (const item of readPromptModeBehaviorEvalCorpus()) {
			const result = scorePromptModeBehaviorEvalCase(item);
			const actualFailures = result.criteria
				.filter((criterion) => !criterion.passed)
				.map((criterion) => criterion.criterion);
			expect(actualFailures).toEqual(item.expectedFailures ?? []);
		}
	});

	test("forbidden tool scoring ignores negated boundary guidance", () => {
		const result = scorePromptModeBehaviorModelOutput({
			id: "negated-forbidden-tool-guidance",
			mode: "flow-reviewer",
			title: "Negated tool references are not tool-use claims",
			modelOutput:
				"Stay read-only. Do not call flow_run_start, avoid flow_plan_apply, and keep flow_session_close in the forbidden tools list. Return needs_fix if validation is missing.",
			minPassingScore: 1,
		});

		expect(
			result.criteria.find(
				(criterion) => criterion.criterion === "forbidden_tool_absent",
			)?.passed,
		).toBe(true);
	});

	test("forbidden tool scoring rejects affirmative forbidden tool use", () => {
		const result = scorePromptModeBehaviorModelOutput({
			id: "affirmative-forbidden-tool-use",
			mode: "flow-reviewer",
			title: "Affirmative tool references remain boundary violations",
			modelOutput:
				"I will start by calling flow_run_start, then return needs_fix if validation is missing.",
			minPassingScore: 1,
		});

		expect(
			result.criteria.find(
				(criterion) => criterion.criterion === "forbidden_tool_absent",
			)?.passed,
		).toBe(false);
	});

	test("structured tool calls drive required and forbidden tool scoring", () => {
		const result = scorePromptModeBehaviorModelOutput({
			id: "structured-tool-intent",
			mode: "flow-plan",
			title: "Structured tool calls are exact scoring evidence",
			modelOutput: {
				toolCalls: [
					{ name: "flow_plan_start" },
					{ name: "flow_plan_context_record" },
					{ name: "flow_plan_apply" },
				],
				response:
					"Planning complete. Do not call flow_run_start until the plan is approved.",
			},
			minPassingScore: 1,
			expectedToolCalls: [
				"flow_plan_start",
				"flow_plan_context_record",
				"flow_plan_apply",
			],
		});

		expect(
			result.criteria.find(
				(criterion) => criterion.criterion === "required_tool_sequence",
			)?.passed,
		).toBe(true);
		expect(
			result.criteria.find(
				(criterion) => criterion.criterion === "forbidden_tool_absent",
			)?.passed,
		).toBe(true);
	});

	test("structured tool calls reject forbidden runtime mutations", () => {
		const result = scorePromptModeBehaviorModelOutput({
			id: "structured-forbidden-tool-intent",
			mode: "flow-reviewer",
			title: "Structured forbidden calls are boundary violations",
			modelOutput: JSON.stringify({
				plannedToolCalls: ["flow_review_record_feature", "flow_run_start"],
			}),
			minPassingScore: 1,
		});

		expect(
			result.criteria.find(
				(criterion) => criterion.criterion === "forbidden_tool_absent",
			)?.passed,
		).toBe(false);
	});

	test("mode behavior eval summary is readable and stable", () => {
		const summary = buildPromptModeBehaviorEvalSummary(
			readPromptModeBehaviorEvalCorpus(),
		);

		expect(summary.totalCases).toBe(18);
		expect(summary.passingCases).toBe(12);
		expect(summary.failingCases).toBe(6);
		expect(summary.expectationSatisfiedCases).toBe(18);
		expect(summary.unexpectedCases).toBe(0);
		expect(summary.averageScore).toBeCloseTo(4.67, 2);
		expect(summary.report).toContain(
			"Prompt mode behavior eval corpus: 18 cases",
		);
		expect(summary.report).toContain(
			"plan-goal-records-context-and-stops: 6/6 (quality-pass); mode=flow-plan; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"run-bad-executes-every-feature: 2/6 (quality-fail); mode=flow-run; expectation=satisfied; failed=required_tool_sequence,required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"control-bad-starts-work-from-status: 2/6 (quality-fail); mode=flow-control; expectation=satisfied; failed=forbidden_tool_absent,required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.markdownReport).toContain(
			"| reviewer-needs-fix-on-missing-validation | flow-reviewer | calibration | 6/6 | quality-pass | satisfied | — |",
		);
		expect(summary.markdownReport).toContain("## Failed criteria details");
	});
});
