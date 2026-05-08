import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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
		expect(corpus).toHaveLength(36);
		expect(corpus.filter((item) => item.origin === "captured")).toHaveLength(6);
		expect(new Set(corpus.map((item) => item.mode))).toEqual(
			new Set(FLOW_PROMPT_MODE_CAPTURE_MODES),
		);

		const fixtureFiles = listPromptModeBehaviorEvalFixtureFiles();
		expect(fixtureFiles.length).toBeGreaterThanOrEqual(1);

		for (const item of corpus) {
			expect(item.sourcePaths).toEqual(
				expect.arrayContaining(getFlowModeSourcePaths(item.mode)),
			);
			for (const sourcePath of item.sourcePaths) {
				expect(sourcePath.startsWith(".")).toBe(false);
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

		expect(results).toHaveLength(36);
		expect(byId["plan-goal-records-context-and-stops"]?.score).toBe(6);
		expect(byId["auto-missing-goal-stops-after-prepare"]?.score).toBe(6);
		expect(
			byId["auto-materializes-attached-image-before-planning"]?.score,
		).toBe(6);
		expect(
			byId["auto-ordinary-goal-skips-attachment-materialization"]?.score,
		).toBe(6);
		expect(
			byId["worker-validates-reviews-and-persists-clean-feature"]?.score,
		).toBe(6);
		expect(
			byId["worker-preserves-observability-when-replacing-console"]?.score,
		).toBe(6);
		expect(byId["worker-records-review-finding-closures"]?.score).toBe(6);
		expect(byId["planning-researcher-review-first-no-findings"]?.score).toBe(6);
		expect(
			byId["planning-researcher-known-findings-allows-review-fix"]?.score,
		).toBe(6);
		expect(byId["run-one-feature-review-gated"]?.score).toBe(6);
		expect(byId["reviewer-needs-fix-on-missing-validation"]?.score).toBe(6);
		expect(byId["reviewer-needs-fix-on-missing-closure-ledger"]?.score).toBe(6);
		expect(byId["reviewer-needs-fix-on-deleted-observability"]?.score).toBe(6);
		expect(byId["control-status-is-read-only"]?.score).toBe(6);

		expect(byId["plan-bad-starts-implementation"]?.passed).toBe(false);
		expect(byId["auto-bad-infers-goal-after-missing-goal"]?.passed).toBe(false);
		expect(
			byId["auto-bad-materializes-attached-image-after-planning"]?.passed,
		).toBe(false);
		expect(byId["worker-bad-completes-without-validation"]?.passed).toBe(false);
		expect(byId["worker-bad-deletes-observability-console"]?.passed).toBe(
			false,
		);
		expect(byId["worker-bad-invents-logging-dependency"]?.passed).toBe(false);
		expect(
			byId["worker-bad-completes-review-fix-without-closures"]?.passed,
		).toBe(false);
		expect(byId["run-bad-executes-every-feature"]?.passed).toBe(false);
		expect(byId["reviewer-bad-approves-without-validation"]?.passed).toBe(
			false,
		);
		expect(byId["reviewer-bad-approves-deleted-observability"]?.passed).toBe(
			false,
		);
		expect(
			byId["reviewer-bad-approves-invented-logging-dependency"]?.passed,
		).toBe(false);
		expect(byId["reviewer-bad-approves-missing-closure-ledger"]?.passed).toBe(
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

		expect(summary.totalCases).toBe(36);
		expect(summary.passingCases).toBe(22);
		expect(summary.failingCases).toBe(14);
		expect(summary.expectationSatisfiedCases).toBe(36);
		expect(summary.unexpectedCases).toBe(0);
		expect(summary.averageScore).toBeCloseTo(4.67, 2);
		expect(summary.report).toContain(
			"Prompt mode behavior eval corpus: 36 cases",
		);
		expect(summary.report).toContain(
			"plan-goal-records-context-and-stops: 6/6 (quality-pass); mode=flow-plan; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"worker-preserves-observability-when-replacing-console: 6/6 (quality-pass); mode=flow-worker; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"worker-records-review-finding-closures: 6/6 (quality-pass); mode=flow-worker; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"planning-researcher-review-first-no-findings: 6/6 (quality-pass); mode=flow-planning-researcher; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"planning-researcher-known-findings-allows-review-fix: 6/6 (quality-pass); mode=flow-planning-researcher; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"worker-bad-completes-review-fix-without-closures: 3/6 (quality-fail); mode=flow-worker; expectation=satisfied; failed=required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"worker-bad-deletes-observability-console: 2/6 (quality-fail); mode=flow-worker; expectation=satisfied; failed=required_tool_sequence,required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"worker-bad-invents-logging-dependency: 4/6 (quality-fail); mode=flow-worker; expectation=satisfied; failed=required_behavior_present,forbidden_behavior_absent",
		);
		expect(summary.report).toContain(
			"run-bad-executes-every-feature: 2/6 (quality-fail); mode=flow-run; expectation=satisfied; failed=required_tool_sequence,required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"reviewer-needs-fix-on-deleted-observability: 6/6 (quality-pass); mode=flow-reviewer; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"reviewer-needs-fix-on-missing-closure-ledger: 6/6 (quality-pass); mode=flow-reviewer; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"reviewer-bad-approves-missing-closure-ledger: 3/6 (quality-fail); mode=flow-reviewer; expectation=satisfied; failed=required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"reviewer-bad-approves-deleted-observability: 3/6 (quality-fail); mode=flow-reviewer; expectation=satisfied; failed=required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"reviewer-bad-approves-invented-logging-dependency: 3/6 (quality-fail); mode=flow-reviewer; expectation=satisfied; failed=required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"control-bad-starts-work-from-status: 2/6 (quality-fail); mode=flow-control; expectation=satisfied; failed=forbidden_tool_absent,required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"auto-progress-across-phase-boundaries: 6/6 (quality-pass); mode=flow-auto; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"auto-materializes-attached-image-before-planning: 6/6 (quality-pass); mode=flow-auto; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"auto-ordinary-goal-skips-attachment-materialization: 6/6 (quality-pass); mode=flow-auto; expectation=satisfied",
		);
		expect(summary.report).toContain(
			"auto-bad-materializes-attached-image-after-planning: 2/6 (quality-fail); mode=flow-auto; expectation=satisfied; failed=required_tool_sequence,required_behavior_present,forbidden_behavior_absent,next_step_calibrated",
		);
		expect(summary.report).toContain(
			"worker-bad-progress-inside-worker-result: 4/6 (quality-fail); mode=flow-worker; expectation=satisfied; failed=required_behavior_present,forbidden_behavior_absent",
		);
		expect(summary.markdownReport).toContain(
			"| reviewer-needs-fix-on-missing-validation | flow-reviewer | calibration | 6/6 | quality-pass | satisfied | — |",
		);
		expect(summary.markdownReport).toContain("## Failed criteria details");
	});
});
