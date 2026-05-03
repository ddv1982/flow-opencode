import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildReviewCapturePrompt,
	checkReviewCaptureScenarios,
	readReviewCaptureScenarios,
	scoreReviewCaptureFile,
	writeReviewCapturePromptExports,
} from "../scripts/cross-area/review-prompt-capture";

describe("review prompt capture harness", () => {
	test("loads providerless capture scenarios", async () => {
		const scenarios = await readReviewCaptureScenarios();

		expect(scenarios).toHaveLength(2);
		expect(scenarios[0]?.id).toBe(
			"flow-review-codebase-architecture-structured",
		);
		expect(scenarios[0]?.outputView).toBe("structured");
	});

	test("builds an offline prompt packet with the real review command and file map", async () => {
		const [scenario] = await readReviewCaptureScenarios();
		if (!scenario) {
			throw new Error("Expected a review capture scenario.");
		}
		const prompt = buildReviewCapturePrompt(scenario);

		expect(prompt).toContain("offline/providerless prompt-quality capture");
		expect(prompt).toContain(
			"Objective: Run a read-only Flow review and present calibrated findings",
		);
		expect(prompt).toContain(
			"Return raw/structured JSON only so the structured ledger can be scored offline.",
		);
		expect(prompt).toContain("<file_map>");
		expect(prompt).toContain("report-schema.ts +");
		expect(prompt).not.toContain("OPENAI_API_KEY");
	});

	test("checks capture scenarios without writing prompt exports", async () => {
		await expect(checkReviewCaptureScenarios()).resolves.toBe(
			"Review capture scenarios valid: 2",
		);
	});

	test("writes prompt, capture template, manifest, and instructions", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "review-capture-"));
		try {
			const exports = await writeReviewCapturePromptExports({ outputDir });

			expect(exports).toHaveLength(2);
			const [captureExport] = exports;
			if (!captureExport) {
				throw new Error("Expected a review capture export.");
			}
			const prompt = await readFile(captureExport.promptPath, "utf8");
			const captureTemplate = await readFile(
				captureExport.captureTemplatePath,
				"utf8",
			);
			const manifest = await readFile(join(outputDir, "manifest.json"), "utf8");
			const readme = await readFile(join(outputDir, "README.md"), "utf8");

			expect(prompt).toContain("## Model prompt");
			expect(captureTemplate).toContain(
				"Paste the structured review ledger JSON here.",
			);
			expect(manifest).toContain(captureExport.id);
			expect(readme).toContain("providerless");
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	test("scores a captured structured review without a model API", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "review-capture-score-"));
		const capturePath = join(outputDir, "capture.json");
		try {
			await writeFile(
				capturePath,
				`${JSON.stringify(
					{
						id: "manual-capture",
						title: "Manual capture",
						minPassingScore: 9,
						modelOutput: {
							requestedDepth: "full_audit",
							achievedDepth: "deep_audit",
							repoSummary: "Flow plugin prompt and review surfaces.",
							overallVerdict:
								"No confirmed release blocker was established; readiness depends on validation.",
							discoveredSurfaces: [
								{
									name: "Audit prompt contract",
									category: "source_runtime",
									reviewStatus: "directly_reviewed",
									evidence: ["src/audit/prompts/contracts.ts:1"],
								},
								{
									name: "Runtime tests",
									category: "tests",
									reviewStatus: "spot_checked",
									reason:
										"Representative runtime tests were sampled, but every test file was not reviewed.",
								},
							],
							coverageNotes: [
								"Downgraded from full audit because not every test surface was directly reviewed.",
								"Failure-mode review covered test-oracle authenticity for captured outputs; runtime lifecycle and UI interaction classes were outside this focused prompt-contract capture.",
							],
							validationRun: [
								{
									command: "not run",
									status: "not_run",
									summary:
										"Validation was not run in this read-only review capture.",
								},
							],
							findings: [
								{
									title:
										"Review prompt contract needs captured-output regression coverage",
									category: "hardening_opportunity",
									confidence: "likely",
									severity: "medium",
									evidence: ["tests/prompt-behavior-eval-helpers.ts:1"],
									impact:
										"Prompt regressions can slip if real outputs are not captured and scored.",
									remediation:
										"Promote useful manual captures into the behavior fixture corpus.",
								},
							],
							nextSteps: [
								"Promote this capture into the regression corpus if it represents desired behavior.",
							],
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			const score = await scoreReviewCaptureFile(capturePath);

			expect(score).toContain("Score: 9/9");
			expect(score).toContain("Quality: quality-pass");
			expect(score).toContain("Failed criteria: —");
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});
});
