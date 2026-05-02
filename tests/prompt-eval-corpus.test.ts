import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	buildPromptEvalCoverageSummary,
	isFirstPartySourcePath,
	PROMPT_EVAL_FIXTURE_DIR,
	readPromptEvalCorpus,
	renderPromptEvalCase,
} from "./prompt-eval-helpers";

describe("prompt eval corpus", () => {
	test("corpus source artifacts exist and stay first-party only", async () => {
		const corpus = readPromptEvalCorpus();
		expect(corpus.length).toBeGreaterThan(0);

		const fixtureFiles = readdirSync(PROMPT_EVAL_FIXTURE_DIR)
			.filter((entry) => entry.endsWith(".json"))
			.sort();
		expect(fixtureFiles.length).toBeGreaterThan(0);

		for (const item of corpus) {
			for (const sourcePath of item.sourcePaths) {
				expect(isFirstPartySourcePath(sourcePath)).toBe(true);
				expect(sourcePath.startsWith(".")).toBe(false);
				expect(existsSync(join(import.meta.dir, "..", sourcePath))).toBe(true);
			}
		}
	});

	test("corpus validates expected and forbidden snippets for each scenario", () => {
		const corpus = readPromptEvalCorpus();

		for (const item of corpus) {
			const rendered = renderPromptEvalCase(item);
			for (const snippet of item.expectedSnippets) {
				expect(rendered).toContain(snippet);
			}
			for (const forbiddenSnippet of item.forbiddenSnippets ?? []) {
				expect(rendered).not.toContain(forbiddenSnippet);
			}
		}
	});

	test("corpus keeps intentional coverage across categories, surfaces, and risk tiers", () => {
		const corpus = readPromptEvalCorpus();
		const categories = new Set(corpus.map((item) => item.category));
		const surfaces = new Set(corpus.map((item) => item.surface));
		const risks = new Set(corpus.map((item) => item.risk));

		expect(categories).toEqual(
			new Set([
				"command-entry",
				"planning-evidence",
				"decision-gating",
				"completion-gating",
				"recovery",
				"review-gating",
				"claim-calibration",
				"finding-taxonomy",
				"audit-coverage",
			]),
		);
		expect(surfaces).toEqual(
			new Set([
				"adaptive_system_context",
				"auto_command_template",
				"planner_agent_prompt",
				"worker_agent_prompt",
				"worker_contract",
				"reviewer_contract",
				"reviewer_agent_prompt",
				"plan_command_template",
				"run_command_template",
				"status_command_template",
				"doctor_command_template",
				"history_command_template",
				"session_command_template",
				"reset_command_template",
				"plan_contract",
				"auditor_agent_prompt",
				"audit_command_template",
				"audit_contract",
			]),
		);
		expect(risks).toEqual(new Set(["medium", "high"]));
	});

	test("corpus emits a readable coverage summary", () => {
		const summary = buildPromptEvalCoverageSummary(readPromptEvalCorpus());
		expect(summary.totalCases).toBe(30);
		expect(summary.byCategory).toEqual({
			"audit-coverage": 1,
			"claim-calibration": 2,
			"command-entry": 7,
			"completion-gating": 3,
			"decision-gating": 2,
			"finding-taxonomy": 1,
			"planning-evidence": 3,
			recovery: 6,
			"review-gating": 5,
		});
		expect(summary.byRisk).toEqual({ high: 20, medium: 10 });
		expect(summary.report).toContain("Prompt eval corpus coverage: 30 cases");
		expect(summary.report).toContain("audit_contract=1");
		expect(summary.report).toContain("run_command_template=1");
		expect(summary.report).toContain("reset_command_template=1");
		expect(summary.report).toContain("plan_contract=1");
		expect(summary.report).toContain("review-gating=5");
	});
});
