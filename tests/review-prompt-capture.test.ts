import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildReviewCapturePrompt,
	buildReviewCaptureTemplate,
	checkReviewCaptureScenarios,
	readReviewCaptureScenarios,
	scoreReviewCaptureFile,
	writeReviewCapturePromptExports,
} from "../scripts/cross-area/review-prompt-capture";
import { scorePromptBehaviorModelOutput } from "./prompt-behavior-eval-helpers";

describe("review prompt capture harness", () => {
	test("loads providerless capture scenarios", async () => {
		const scenarios = await readReviewCaptureScenarios();

		expect(scenarios).toHaveLength(3);
		expect(scenarios[0]?.id).toBe(
			"flow-review-codebase-architecture-structured",
		);
		expect(scenarios[0]?.outputView).toBe("structured");
		expect(scenarios[0]?.reviewPacket?.selectedContext?.included).toContain(
			"src/audit/prompts/*",
		);
		expect(scenarios[0]?.reviewPacket?.knownExclusions).toContain(
			"Do not audit package-manager detection or install lifecycle unless new evidence links it to review prompting.",
		);
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
		expect(prompt).toContain("<review-packet>");
		expect(prompt).toContain("<selected-context>");
		expect(prompt).toContain("<already-covered-findings>");
		expect(prompt).toContain("Prompt input packet sections must survive");
		expect(prompt).toContain("<file_map>");
		expect(prompt).toContain("report-schema.ts +");
		expect(prompt).not.toContain("OPENAI_API_KEY");
	});

	test("checks capture scenarios without writing prompt exports", async () => {
		await expect(checkReviewCaptureScenarios()).resolves.toBe(
			"Review capture scenarios valid: 3",
		);
	});

	test("writes prompt, capture template, manifest, and instructions", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "review-capture-"));
		try {
			const exports = await writeReviewCapturePromptExports({ outputDir });

			expect(exports).toHaveLength(3);
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
			expect(captureTemplate).toContain('"minPassingScore": 10');
			expect(captureTemplate).toContain('"packetExpectations"');
			expect(captureTemplate).toContain('"forbiddenDirectReview"');
			expect(manifest).toContain(captureExport.id);
			expect(readme).toContain("providerless");
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	test("rejects changed-files-only review and accepts connected-context coverage gap accounting", async () => {
		const scenarios = await readReviewCaptureScenarios();
		const scenario = scenarios.find(
			(item) =>
				item.id === "flow-review-connected-context-coverage-gap-structured",
		);
		if (!scenario) {
			throw new Error("Expected connected-context review capture scenario.");
		}
		const template = JSON.parse(buildReviewCaptureTemplate(scenario)) as {
			minPassingScore: number;
			packetExpectations?: {
				selectedContext?: string[];
				relationships?: string[];
				ambiguities?: string[];
				knownExclusions?: string[];
				alreadyCoveredFindings?: string[];
				forbiddenDirectReview?: string[];
			};
		};

		const requiredDirectReview = [
			"Caller/click-handler context: src/runtime/application/session-read-actions.ts",
			"Lifecycle/state owner context: src/runtime/domain/final-review-coverage.ts",
			"Related tests: tests/runtime/final-review-contracts.test.ts",
		];
		const packetExpectations = template.packetExpectations
			? {
					...template.packetExpectations,
					requiredDirectReview,
				}
			: undefined;

		const changedFilesOnly = scorePromptBehaviorModelOutput({
			id: scenario.id,
			title: `${scenario.title} (changed files only)`,
			minPassingScore: template.minPassingScore,
			...(packetExpectations ? { packetExpectations } : {}),
			modelOutput: {
				requestedDepth: "full_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Reviewed only changed files.",
				overallVerdict: "No issue found after reviewing changed files only.",
				discoveredSurfaces: [
					{
						name: "Changed async action file",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/runtime/application/session-actions.ts:120-180"],
					},
				],
				coverageNotes: [
					"Changed files only were reviewed.",
					"Changed async/action file: src/runtime/application/session-actions.ts",
					"Caller/click-handler context: src/runtime/application/session-read-actions.ts",
					"Lifecycle/state owner context: src/runtime/domain/final-review-coverage.ts",
					"Related tests: tests/runtime/final-review-contracts.test.ts",
					"Trace click-handler -> async action -> lifecycle/state owner before concluding review coverage.",
					"If product-path behavior was not validated end-to-end, report it as an explicit coverage gap.",
					"Excluded: Do not treat changed-files-only review as sufficient evidence.",
					"Do not claim full codebase coverage beyond the selected async/action path.",
				],
				validationRun: [
					{
						command: "not run",
						status: "not_run",
						summary: "Validation not run in this read-only review.",
					},
				],
				findings: [
					{
						title: "No findings from changed-files-only review",
						category: "hardening_opportunity",
						confidence: "likely",
						severity: "low",
						evidence: ["src/runtime/application/session-actions.ts:120-180"],
						impact: "Connected behavior could be missed.",
						remediation: "Review linked callers and tests.",
					},
				],
				nextSteps: ["Narrow review is complete."],
			},
		});

		expect(changedFilesOnly.passed).toBeFalse();
		expect(changedFilesOnly.actualFailures).toContain(
			"packet_boundaries_preserved",
		);

		const connectedContext = scorePromptBehaviorModelOutput({
			id: scenario.id,
			title: `${scenario.title} (connected context accounted)`,
			minPassingScore: template.minPassingScore,
			...(packetExpectations ? { packetExpectations } : {}),
			modelOutput: {
				requestedDepth: "full_audit",
				achievedDepth: "deep_audit",
				repoSummary:
					"Reviewed async action behavior with caller path, state owner, and related tests.",
				overallVerdict:
					"No confirmed blocker, but product-path coverage remains incomplete.",
				discoveredSurfaces: [
					{
						name: "Changed async/action file",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/runtime/application/session-actions.ts:120-180"],
					},
					{
						name: "Caller/click-handler context: src/runtime/application/session-read-actions.ts",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: [
							"src/runtime/application/session-read-actions.ts:40-110",
						],
					},
					{
						name: "Lifecycle/state owner context: src/runtime/domain/final-review-coverage.ts",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/runtime/domain/final-review-coverage.ts:1-80"],
					},
					{
						name: "Related tests: tests/runtime/final-review-contracts.test.ts",
						category: "tests",
						reviewStatus: "directly_reviewed",
						evidence: ["tests/runtime/final-review-contracts.test.ts:1-120"],
					},
				],
				coverageNotes: [
					"Changed async/action file: src/runtime/application/session-actions.ts",
					"Caller/click-handler context: src/runtime/application/session-read-actions.ts",
					"Lifecycle/state owner context: src/runtime/domain/final-review-coverage.ts",
					"Related tests: tests/runtime/final-review-contracts.test.ts",
					"Trace click-handler -> async action -> lifecycle/state owner before concluding review coverage.",
					"If product-path behavior was not validated end-to-end, report it as an explicit coverage gap.",
					"Excluded: Do not treat changed-files-only review as sufficient evidence.",
					"Do not claim full codebase coverage beyond the selected async/action path.",
					"Product-path gap: tests cover contracts but not end-to-end click flow through async action timing.",
				],
				validationRun: [
					{
						command: "bun test tests/runtime/final-review-contracts.test.ts",
						status: "passed",
						summary:
							"Related tests pass, but they do not prove full normal product path coverage.",
					},
				],
				findings: [
					{
						title: "Normal product path coverage gap for async click flow",
						category: "hardening_opportunity",
						confidence: "likely",
						severity: "medium",
						evidence: [
							"src/runtime/application/session-read-actions.ts:40-110",
							"tests/runtime/final-review-contracts.test.ts:1-120",
						],
						impact:
							"Regression in caller->action timing can escape contract-focused tests.",
						remediation:
							"Add an end-to-end product-path test that exercises click-handler to async action lifecycle ownership.",
					},
				],
				nextSteps: [
					"Add product-path test coverage for click-handler to async action lifecycle behavior.",
				],
			},
		});

		expect(connectedContext.passed).toBeTrue();
		expect(connectedContext.actualFailures).toHaveLength(0);
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
