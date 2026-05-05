import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildPromptModeCapturePrompt,
	checkPromptModeCaptureScenarios,
	promotePromptModeCaptureFile,
	readPromptModeCaptureScenarios,
	scorePromptModeCaptureFile,
	writePromptModeCapturePromptExports,
} from "../scripts/cross-area/prompt-mode-capture";
import {
	FLOW_PROMPT_MODE_CAPTURE_MODES,
	getFlowModeSourcePaths,
} from "../src/prompts/mode-contracts";

describe("prompt mode capture harness", () => {
	test("loads providerless prompt mode capture scenarios", async () => {
		const scenarios = await readPromptModeCaptureScenarios();

		expect(scenarios).toHaveLength(7);
		expect(scenarios.map((scenario) => scenario.mode)).toEqual([
			...FLOW_PROMPT_MODE_CAPTURE_MODES,
		]);
	});

	test("builds offline prompt packets with real command and agent surfaces", async () => {
		const scenarios = await readPromptModeCaptureScenarios();
		const planScenario = scenarios.find(
			(scenario) => scenario.id === "flow-plan-eval-rollout",
		);
		const workerScenario = scenarios.find(
			(scenario) => scenario.id === "flow-worker-clean-feature",
		);
		if (!planScenario || !workerScenario) {
			throw new Error("Expected plan and worker capture scenarios.");
		}

		const planPrompt = buildPromptModeCapturePrompt(planScenario);
		const workerPrompt = buildPromptModeCapturePrompt(workerScenario);

		expect(planPrompt).toContain("offline/providerless prompt-quality capture");
		expect(planPrompt).toContain("Objective");
		expect(planPrompt).toContain("Manage the active Flow plan.");
		expect(planPrompt).toContain("flow_plan_context_record");
		expect(planPrompt).toContain("contractSourcePaths");
		expect(planPrompt).not.toContain("OPENAI_API_KEY");
		expect(workerPrompt).toContain("You are the Flow worker.");
		expect(workerPrompt).toContain("Scenario input:");
		expect(workerPrompt).toContain("flow_review_record_feature");
	});

	test("checks capture scenarios without writing prompt exports", async () => {
		await expect(checkPromptModeCaptureScenarios()).resolves.toBe(
			"Prompt mode capture scenarios valid: 7",
		);
	});

	test("writes prompt, capture template, manifest, and instructions", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "prompt-mode-capture-"));
		try {
			const exports = await writePromptModeCapturePromptExports({ outputDir });

			expect(exports).toHaveLength(7);
			const [captureExport] = exports;
			if (!captureExport) {
				throw new Error("Expected a prompt mode capture export.");
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
				"Paste the captured model output here.",
			);
			expect(captureTemplate).toContain("expectedToolMentions");
			expect(captureTemplate).toContain("expectedToolCalls");
			expect(manifest).toContain(captureExport.id);
			expect(readme).toContain("providerless");
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	test("scores a captured prompt mode output without a model API", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "prompt-mode-score-"));
		const capturePath = join(outputDir, "capture.json");
		try {
			await writeFile(
				capturePath,
				`${JSON.stringify(
					{
						id: "manual-plan-capture",
						mode: "flow-plan",
						title: "Manual plan capture",
						minPassingScore: 6,
						expectedToolMentions: [
							"flow_plan_start",
							"flow_plan_context_record",
							"flow_plan_apply",
						],
						expectedToolCalls: [
							"flow_plan_start",
							"flow_plan_context_record",
							"flow_plan_apply",
						],
						forbiddenToolMentions: ["flow_run_start"],
						forbiddenToolCalls: ["flow_run_start"],
						requiredResponseSnippets: [
							"repo evidence",
							"package manager",
							"planning context",
							"draft plan",
							"not implement",
						],
						forbiddenResponseSnippets: ["I edited"],
						nextStepSnippets: ["approve the draft plan"],
						modelOutput: {
							actualToolCalls: [
								"flow_plan_start",
								"flow_plan_context_record",
								"flow_plan_apply",
							],
							response:
								"Gather repo evidence and package manager context with planning context and draft plan. Do not implement. Next step: approve the draft plan.",
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			const score = await scorePromptModeCaptureFile(capturePath);

			expect(score).toContain("Mode: flow-plan");
			expect(score).toContain("Score: 6/6");
			expect(score).toContain("Quality: quality-pass");
			expect(score).toContain("Failed criteria: —");
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	test("rejects malformed manual capture scoring fields", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "prompt-mode-bad-score-"));
		try {
			const malformedArrayPath = join(outputDir, "malformed-array.json");
			await writeFile(
				malformedArrayPath,
				`${JSON.stringify(
					{
						id: "manual-bad-capture",
						mode: "flow-plan",
						title: "Manual bad capture",
						minPassingScore: 6,
						expectedToolMentions: ["flow_plan_start", 42],
						modelOutput: "Call flow_plan_start.",
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			await expect(
				scorePromptModeCaptureFile(malformedArrayPath),
			).rejects.toThrow("expectedToolMentions must be a string array");

			const malformedStructuredArrayPath = join(
				outputDir,
				"malformed-structured-array.json",
			);
			await writeFile(
				malformedStructuredArrayPath,
				`${JSON.stringify(
					{
						id: "manual-bad-structured-capture",
						mode: "flow-plan",
						title: "Manual bad structured capture",
						minPassingScore: 6,
						expectedToolCalls: ["flow_plan_start", 42],
						modelOutput: {
							actualToolCalls: ["flow_plan_start"],
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			await expect(
				scorePromptModeCaptureFile(malformedStructuredArrayPath),
			).rejects.toThrow("expectedToolCalls must be a string array");

			const unknownCriterionPath = join(outputDir, "unknown-criterion.json");
			await writeFile(
				unknownCriterionPath,
				`${JSON.stringify(
					{
						id: "manual-unknown-criterion",
						mode: "flow-plan",
						title: "Manual unknown criterion",
						minPassingScore: 6,
						expectedFailures: ["not_a_real_criterion"],
						modelOutput: "Call flow_plan_start.",
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			await expect(
				scorePromptModeCaptureFile(unknownCriterionPath),
			).rejects.toThrow("expectedFailures contains unknown criterion");
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	test("promotes a calibrated capture into a regression fixture", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "prompt-mode-promote-"));
		const capturePath = join(outputDir, "capture.json");
		const promotionDir = join(outputDir, "fixtures");
		try {
			await writeFile(
				capturePath,
				`${JSON.stringify(
					{
						id: "manual-run-capture",
						mode: "flow-run",
						title: "Manual run capture",
						capturedFrom: "unit test capture",
						minPassingScore: 6,
						expectedToolMentions: [
							"flow_run_start",
							"flow_review_record_feature",
						],
						expectedToolCalls: ["flow_run_start", "flow_review_record_feature"],
						forbiddenToolMentions: ["flow_plan_apply"],
						forbiddenToolCalls: ["flow_plan_apply"],
						requiredResponseSnippets: [
							"exactly one feature",
							"targeted validation",
							"review the changed files",
							"reviewer decision",
						],
						forbiddenResponseSnippets: ["execute every approved feature"],
						nextStepSnippets: ["runtime next step"],
						modelOutput:
							"Call flow_run_start, implement exactly one feature, run targeted validation, review the changed files, and call flow_review_record_feature with reviewer decision. End with the runtime next step.",
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			const promoted = await promotePromptModeCaptureFile(capturePath, {
				outputDir: promotionDir,
			});
			const fixture = await readFile(
				join(promotionDir, "manual-run-capture.json"),
				"utf8",
			);

			expect(promoted).toContain("Promoted prompt mode capture");
			expect(promoted).toContain("Mode: flow-run");
			expect(fixture).toContain('"origin": "captured"');
			for (const sourcePath of getFlowModeSourcePaths("flow-run")) {
				expect(fixture).toContain(`"${sourcePath}"`);
			}
			expect(fixture).toContain('"expectedToolCalls"');
			expect(fixture).toContain('"unit test capture"');
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});
});
