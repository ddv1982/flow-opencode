import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildPromptBehaviorEvalSummary,
	listPromptBehaviorEvalFixtureFiles,
	readPromptBehaviorEvalCorpus,
	scorePromptBehaviorEvalCase,
	scorePromptBehaviorModelOutput,
} from "./prompt-behavior-eval-helpers";

describe("prompt behavior eval corpus", () => {
	test("behavior eval fixtures stay first-party and do not depend on Flow archives", async () => {
		const corpus = readPromptBehaviorEvalCorpus();
		expect(corpus).toHaveLength(8);
		expect(corpus.some((item) => item.origin === "captured")).toBe(true);

		const fixtureFiles = listPromptBehaviorEvalFixtureFiles();
		expect(fixtureFiles.length).toBeGreaterThan(1);

		for (const item of corpus) {
			for (const sourcePath of item.sourcePaths) {
				expect(sourcePath.startsWith(".")).toBe(false);
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
		expect(byId["review-full-depth-downgrades-spot-check"]?.score).toBe(9);
		expect(byId["review-confirmed-defect-grounded"]?.passed).toBe(true);
		expect(byId["review-confirmed-defect-grounded"]?.score).toBe(9);
		expect(byId["captured-review-csv-memory-risk-calibrated"]?.passed).toBe(
			true,
		);
		expect(byId["captured-review-csv-memory-risk-calibrated"]?.score).toBe(9);

		expect(byId["review-overclaims-full-depth"]?.passed).toBe(false);
		expect(
			byId["review-overclaims-full-depth"]?.criteria
				.filter((criterion) => !criterion.passed)
				.map((criterion) => criterion.criterion),
		).toEqual([
			"depth_calibrated",
			"coverage_accounted",
			"failure_modes_accounted",
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
			"failure_modes_accounted",
			"actionable_next_steps",
		]);

		expect(byId["review-misses-failure-mode-accounting"]?.passed).toBe(false);
		expect(
			byId["review-misses-failure-mode-accounting"]?.criteria
				.filter((criterion) => !criterion.passed)
				.map((criterion) => criterion.criterion),
		).toEqual(["failure_modes_accounted"]);

		expect(byId["review-packet-boundaries-reopened"]?.passed).toBe(false);
		expect(byId["review-packet-boundaries-reopened"]?.maxScore).toBe(10);
		expect(
			byId["review-packet-boundaries-reopened"]?.criteria
				.filter((criterion) => !criterion.passed)
				.map((criterion) => criterion.criterion),
		).toEqual(["packet_boundaries_preserved"]);

		expect(byId["review-ungrounded-output-rejected"]?.passed).toBe(false);
		expect(
			byId["review-ungrounded-output-rejected"]?.criteria.map(
				(criterion) => criterion.criterion,
			),
		).toEqual(["schema_valid"]);
	});

	test("packet-boundary rubric rejects excluded surfaces as directly reviewed", () => {
		const result = scorePromptBehaviorModelOutput({
			id: "manual-packet-boundary-check",
			title: "Manual packet boundary check",
			minPassingScore: 10,
			packetExpectations: {
				selectedContext: ["audit prompts"],
				knownExclusions: ["install lifecycle"],
				forbiddenDirectReview: ["install lifecycle"],
			},
			modelOutput: {
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary:
					"Review covered audit prompts and excluded install lifecycle boundaries.",
				overallVerdict:
					"No confirmed blocker was found; the install lifecycle exclusion should remain out of scope.",
				discoveredSurfaces: [
					{
						name: "Audit prompts",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/audit/prompts/commands.ts:1"],
					},
					{
						name: "Install lifecycle",
						category: "tooling",
						reviewStatus: "directly_reviewed",
						evidence: ["src/install-opencode.ts:1"],
					},
				],
				coverageNotes: [
					"Selected context focused on audit prompts; install lifecycle was explicitly excluded by the packet.",
					"Failure-mode review covered packet boundary preservation and test-oracle authenticity.",
				],
				validationRun: [
					{
						command: "not run",
						status: "not_run",
						summary: "Validation was not run during this read-only fixture.",
					},
				],
				findings: [
					{
						title: "Packet boundary scoring should reject reopened exclusions",
						category: "hardening_opportunity",
						confidence: "likely",
						severity: "medium",
						evidence: ["tests/prompt-behavior-eval-helpers.ts:1"],
						impact:
							"A review can mention an exclusion while still violating it by marking it directly reviewed.",
						remediation:
							"Fail packet-boundary scoring when excluded surfaces are counted as directly reviewed.",
					},
				],
				nextSteps: [
					"Keep excluded surfaces out of directly reviewed coverage.",
				],
			},
		});

		expect(result.maxScore).toBe(10);
		expect(result.actualFailures).toEqual(["packet_boundaries_preserved"]);
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

		expect(summary.totalCases).toBe(8);
		expect(summary.passingCases).toBe(3);
		expect(summary.failingCases).toBe(5);
		expect(summary.expectationSatisfiedCases).toBe(8);
		expect(summary.unexpectedCases).toBe(0);
		expect(summary.averageScore).toBeCloseTo(6.63, 2);
		expect(summary.report).toContain("Prompt behavior eval corpus: 8 cases");
		expect(summary.report).toContain(
			"review-full-depth-downgrades-spot-check: 9/9 (quality-pass); expectation=satisfied",
		);
		expect(summary.report).toContain(
			"review-ungrounded-output-rejected: 0/9 (quality-fail); expectation=satisfied; failed=schema_valid",
		);
		expect(summary.report).toContain(
			"captured-review-overconfident-validation-gap: 4/9 (quality-fail); expectation=satisfied; failed=depth_calibrated,coverage_accounted,finding_grounded,failure_modes_accounted,actionable_next_steps",
		);
		expect(summary.report).toContain(
			"review-packet-boundaries-reopened: 9/10 (quality-fail); expectation=satisfied; failed=packet_boundaries_preserved",
		);
		expect(summary.markdownReport).toContain(
			"| captured-review-csv-memory-risk-calibrated | captured | 9/9 | quality-pass | satisfied | — |",
		);
		expect(summary.markdownReport).toContain("## Failed criteria details");
	});
});
