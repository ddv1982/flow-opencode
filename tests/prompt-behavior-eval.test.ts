import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	buildPromptBehaviorEvalSummary,
	listPromptBehaviorEvalFixtureFiles,
	readPromptBehaviorEvalCorpus,
	scorePromptBehaviorEvalCase,
} from "./prompt-behavior-eval-helpers";

describe("prompt behavior eval corpus", () => {
	test("behavior eval fixtures stay first-party and do not depend on Flow archives", async () => {
		const corpus = readPromptBehaviorEvalCorpus();
		expect(corpus).toHaveLength(6);
		expect(corpus.some((item) => item.origin === "captured")).toBe(true);

		const fixtureFiles = listPromptBehaviorEvalFixtureFiles();
		expect(fixtureFiles.length).toBeGreaterThan(1);

		for (const fixtureFile of fixtureFiles) {
			const raw = await readFile(fixtureFile, "utf8");
			expect(raw.includes(".factory")).toBe(false);
		}

		for (const item of corpus) {
			for (const sourcePath of item.sourcePaths) {
				expect(existsSync(join(import.meta.dir, "..", sourcePath))).toBe(true);
			}
		}
	});

	test("rubric accepts calibrated review outputs and rejects overconfident outputs", () => {
		const results = readPromptBehaviorEvalCorpus().map(
			scorePromptBehaviorEvalCase,
		);
		const byId = Object.fromEntries(
			results.map((result) => [result.id, result]),
		);

		expect(byId["review-full-depth-downgrades-spot-check"]?.passed).toBe(true);
		expect(byId["review-full-depth-downgrades-spot-check"]?.score).toBe(8);
		expect(byId["review-confirmed-defect-grounded"]?.passed).toBe(true);
		expect(byId["review-confirmed-defect-grounded"]?.score).toBe(8);
		expect(byId["captured-review-csv-memory-risk-calibrated"]?.passed).toBe(
			true,
		);
		expect(byId["captured-review-csv-memory-risk-calibrated"]?.score).toBe(8);

		expect(byId["review-overclaims-full-depth"]?.passed).toBe(false);
		expect(
			byId["review-overclaims-full-depth"]?.criteria
				.filter((criterion) => !criterion.passed)
				.map((criterion) => criterion.criterion),
		).toEqual([
			"depth_calibrated",
			"coverage_accounted",
			"actionable_next_steps",
		]);

		expect(byId["captured-review-overconfident-validation-gap"]?.passed).toBe(
			false,
		);
		expect(
			byId["captured-review-overconfident-validation-gap"]?.criteria
				.filter((criterion) => !criterion.passed)
				.map((criterion) => criterion.criterion),
		).toEqual([
			"depth_calibrated",
			"coverage_accounted",
			"finding_grounded",
			"actionable_next_steps",
		]);

		expect(byId["review-ungrounded-output-rejected"]?.passed).toBe(false);
		expect(
			byId["review-ungrounded-output-rejected"]?.criteria.map(
				(criterion) => criterion.criterion,
			),
		).toEqual(["schema_valid"]);
	});

	test("fixture-declared expected failures match rubric failures", () => {
		for (const item of readPromptBehaviorEvalCorpus()) {
			const result = scorePromptBehaviorEvalCase(item);
			const actualFailures = result.criteria
				.filter((criterion) => !criterion.passed)
				.map((criterion) => criterion.criterion);
			expect(actualFailures).toEqual(item.expectedFailures ?? []);
		}
	});

	test("behavior eval summary is readable and stable", () => {
		const summary = buildPromptBehaviorEvalSummary(
			readPromptBehaviorEvalCorpus(),
		);

		expect(summary.totalCases).toBe(6);
		expect(summary.passingCases).toBe(3);
		expect(summary.failingCases).toBe(3);
		expect(summary.expectationSatisfiedCases).toBe(6);
		expect(summary.unexpectedCases).toBe(0);
		expect(summary.averageScore).toBeCloseTo(5.5, 2);
		expect(summary.report).toContain("Prompt behavior eval corpus: 6 cases");
		expect(summary.report).toContain(
			"review-full-depth-downgrades-spot-check: 8/8 (quality-pass); expectation=satisfied",
		);
		expect(summary.report).toContain(
			"review-ungrounded-output-rejected: 0/8 (quality-fail); expectation=satisfied; failed=schema_valid",
		);
		expect(summary.report).toContain(
			"captured-review-overconfident-validation-gap: 4/8 (quality-fail); expectation=satisfied; failed=depth_calibrated,coverage_accounted,finding_grounded,actionable_next_steps",
		);
		expect(summary.markdownReport).toContain(
			"| captured-review-csv-memory-risk-calibrated | captured | 8/8 | quality-pass | satisfied | — |",
		);
		expect(summary.markdownReport).toContain("## Failed criteria details");
	});
});
