import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
	FLOW_CONTROL_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_WORKER_AGENT_PROMPT,
} from "../../src/prompts/agents";
import {
	FLOW_AUTO_COMMAND_TEMPLATE,
	FLOW_PLAN_COMMAND_TEMPLATE,
	FLOW_RUN_COMMAND_TEMPLATE,
} from "../../src/prompts/commands";
import { getFlowModeSourcePaths } from "../../src/prompts/mode-contracts";
import {
	PROMPT_MODE_BEHAVIOR_CRITERIA,
	type PromptModeBehaviorCriterion,
	type PromptModeBehaviorMode,
	scorePromptModeBehaviorModelOutput,
} from "../../tests/prompt-mode-behavior-eval-helpers";

export type PromptModeCaptureScenario = {
	id: string;
	mode: PromptModeBehaviorMode;
	title: string;
	arguments: string;
	expectedToolMentions?: string[];
	forbiddenToolMentions?: string[];
	expectedToolCalls?: string[];
	forbiddenToolCalls?: string[];
	requiredResponseSnippets?: string[];
	forbiddenResponseSnippets?: string[];
	nextStepSnippets?: string[];
	expectedFailures?: PromptModeBehaviorCriterion[];
	notes?: string[];
};

export type PromptModeCaptureExport = {
	id: string;
	mode: PromptModeBehaviorMode;
	title: string;
	promptPath: string;
	captureTemplatePath: string;
};

type PromptModeCaptureFile = {
	id: string;
	mode: PromptModeBehaviorMode;
	title: string;
	capturedFrom?: string;
	minPassingScore: number;
	expectedToolMentions: string[];
	forbiddenToolMentions: string[];
	expectedToolCalls: string[];
	forbiddenToolCalls: string[];
	requiredResponseSnippets: string[];
	forbiddenResponseSnippets: string[];
	nextStepSnippets: string[];
	expectedFailures: PromptModeBehaviorCriterion[];
	modelOutput: unknown;
};

export const DEFAULT_PROMPT_MODE_CAPTURE_SCENARIO_FILE = resolve(
	import.meta.dir,
	"..",
	"..",
	"tests",
	"__fixtures__",
	"prompt-mode-capture-scenarios",
	"mode-scenarios.json",
);

export const DEFAULT_PROMPT_MODE_CAPTURE_OUTPUT_DIR = resolve(
	import.meta.dir,
	"..",
	"..",
	"prompt-exports",
	"mode-capture-prompts",
);

export const DEFAULT_PROMPT_MODE_CAPTURE_PROMOTION_DIR = resolve(
	import.meta.dir,
	"..",
	"..",
	"tests",
	"__fixtures__",
	"prompt-mode-behavior-evals",
	"captured-mode-outputs",
);

const PROMPT_MODE_SURFACES: Record<PromptModeBehaviorMode, string> = {
	"flow-plan": FLOW_PLAN_COMMAND_TEMPLATE,
	"flow-auto": FLOW_AUTO_COMMAND_TEMPLATE,
	"flow-run": FLOW_RUN_COMMAND_TEMPLATE,
	"flow-worker": FLOW_WORKER_AGENT_PROMPT,
	"flow-reviewer": FLOW_REVIEWER_AGENT_PROMPT,
	"flow-control": FLOW_CONTROL_AGENT_PROMPT,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeSlug(value: string, fieldName: string): void {
	if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
		throw new Error(
			`Prompt mode capture ${fieldName} must be a lowercase slug: ${value}`,
		);
	}
}

function assertStringArray(
	value: unknown,
	field: string,
	scenarioId: string,
): asserts value is string[] | undefined {
	if (
		value !== undefined &&
		(!Array.isArray(value) || value.some((item) => typeof item !== "string"))
	) {
		throw new Error(
			`Prompt mode capture scenario '${scenarioId}' ${field} must be a string array when present.`,
		);
	}
}

function optionalStringArrayFromRaw(
	value: unknown,
	field: string,
	captureId: string,
): string[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(
			`Prompt mode capture file '${captureId}' ${field} must be a string array when present.`,
		);
	}
	return value;
}

function expectedFailuresFromRaw(
	value: unknown,
	captureId: string,
): PromptModeBehaviorCriterion[] {
	const expectedFailures = optionalStringArrayFromRaw(
		value,
		"expectedFailures",
		captureId,
	);
	const knownCriteria = new Set<string>(PROMPT_MODE_BEHAVIOR_CRITERIA);
	for (const criterion of expectedFailures) {
		if (!knownCriteria.has(criterion)) {
			throw new Error(
				`Prompt mode capture file '${captureId}' expectedFailures contains unknown criterion: ${criterion}`,
			);
		}
	}
	return expectedFailures as PromptModeBehaviorCriterion[];
}

async function readPromptModeCaptureFile(
	captureFile: string,
): Promise<PromptModeCaptureFile> {
	const raw = JSON.parse(await readFile(captureFile, "utf8")) as unknown;
	if (!isRecord(raw)) {
		throw new Error("Prompt mode capture file must be a JSON object.");
	}
	const id = typeof raw.id === "string" ? raw.id : basename(captureFile);
	assertSafeSlug(id, "capture id");
	const mode = raw.mode;
	if (typeof mode !== "string" || !(mode in PROMPT_MODE_SURFACES)) {
		throw new Error("Prompt mode capture file needs a supported mode.");
	}
	const title = typeof raw.title === "string" ? raw.title : id;
	const minPassingScore =
		typeof raw.minPassingScore === "number" ? raw.minPassingScore : 6;
	return {
		id,
		mode: mode as PromptModeBehaviorMode,
		title,
		minPassingScore,
		expectedToolMentions: optionalStringArrayFromRaw(
			raw.expectedToolMentions,
			"expectedToolMentions",
			id,
		),
		forbiddenToolMentions: optionalStringArrayFromRaw(
			raw.forbiddenToolMentions,
			"forbiddenToolMentions",
			id,
		),
		expectedToolCalls: optionalStringArrayFromRaw(
			raw.expectedToolCalls,
			"expectedToolCalls",
			id,
		),
		forbiddenToolCalls: optionalStringArrayFromRaw(
			raw.forbiddenToolCalls,
			"forbiddenToolCalls",
			id,
		),
		requiredResponseSnippets: optionalStringArrayFromRaw(
			raw.requiredResponseSnippets,
			"requiredResponseSnippets",
			id,
		),
		forbiddenResponseSnippets: optionalStringArrayFromRaw(
			raw.forbiddenResponseSnippets,
			"forbiddenResponseSnippets",
			id,
		),
		nextStepSnippets: optionalStringArrayFromRaw(
			raw.nextStepSnippets,
			"nextStepSnippets",
			id,
		),
		expectedFailures: expectedFailuresFromRaw(raw.expectedFailures, id),
		modelOutput: "modelOutput" in raw ? raw.modelOutput : raw,
		...(typeof raw.capturedFrom === "string"
			? { capturedFrom: raw.capturedFrom }
			: {}),
	};
}

export function validatePromptModeCaptureScenarios(
	raw: unknown,
): PromptModeCaptureScenario[] {
	if (!Array.isArray(raw)) {
		throw new Error("Prompt mode capture scenarios must be an array.");
	}
	const seenIds = new Set<string>();
	return raw.map((entry) => {
		if (!isRecord(entry)) {
			throw new Error("Each prompt mode capture scenario must be an object.");
		}
		const scenario = entry as Partial<PromptModeCaptureScenario>;
		if (!scenario.id) {
			throw new Error("Prompt mode capture scenario needs an id.");
		}
		assertSafeSlug(scenario.id, "id");
		if (seenIds.has(scenario.id)) {
			throw new Error(
				`Duplicate prompt mode capture scenario id: ${scenario.id}`,
			);
		}
		seenIds.add(scenario.id);
		if (!scenario.mode || !(scenario.mode in PROMPT_MODE_SURFACES)) {
			throw new Error(
				`Prompt mode capture scenario '${scenario.id}' needs a supported mode.`,
			);
		}
		if (!scenario.title) {
			throw new Error(
				`Prompt mode capture scenario '${scenario.id}' needs a title.`,
			);
		}
		if (!scenario.arguments) {
			throw new Error(
				`Prompt mode capture scenario '${scenario.id}' needs arguments.`,
			);
		}
		assertStringArray(
			scenario.expectedToolMentions,
			"expectedToolMentions",
			scenario.id,
		);
		assertStringArray(
			scenario.forbiddenToolMentions,
			"forbiddenToolMentions",
			scenario.id,
		);
		assertStringArray(
			scenario.expectedToolCalls,
			"expectedToolCalls",
			scenario.id,
		);
		assertStringArray(
			scenario.forbiddenToolCalls,
			"forbiddenToolCalls",
			scenario.id,
		);
		assertStringArray(
			scenario.requiredResponseSnippets,
			"requiredResponseSnippets",
			scenario.id,
		);
		assertStringArray(
			scenario.forbiddenResponseSnippets,
			"forbiddenResponseSnippets",
			scenario.id,
		);
		assertStringArray(
			scenario.nextStepSnippets,
			"nextStepSnippets",
			scenario.id,
		);
		return scenario as PromptModeCaptureScenario;
	});
}

export async function readPromptModeCaptureScenarios(
	scenarioFile = DEFAULT_PROMPT_MODE_CAPTURE_SCENARIO_FILE,
): Promise<PromptModeCaptureScenario[]> {
	const raw = JSON.parse(await readFile(scenarioFile, "utf8")) as unknown;
	return validatePromptModeCaptureScenarios(raw);
}

function renderPromptSurface(scenario: PromptModeCaptureScenario): string {
	const surface = PROMPT_MODE_SURFACES[scenario.mode];
	if (surface.includes("$ARGUMENTS")) {
		return surface.replace("$ARGUMENTS", scenario.arguments.trim());
	}
	return [
		surface,
		"",
		"Scenario input:",
		"```text",
		scenario.arguments.trim(),
		"```",
	].join("\n");
}

export function buildPromptModeCapturePrompt(
	scenario: PromptModeCaptureScenario,
): string {
	return [
		`# Prompt mode capture packet: ${scenario.title}`,
		"",
		"## Operator instructions",
		"",
		"- This is an offline/providerless prompt-quality capture packet; it does not call any model API.",
		"- Paste the `Model prompt` section into the plugin/model surface you want to evaluate.",
		"- Save the returned model output into the sibling capture template's `modelOutput` field.",
		"- Score the capture with `bun run eval:prompt-capture -- --score <capture-file.json>`.",
		"- Promote calibrated outputs with `bun run eval:prompt-capture -- --promote <capture-file.json>` when they should become regressions.",
		...(scenario.notes ?? []).map((note) => `- ${note}`),
		"",
		"## Scoring profile",
		"",
		"```json",
		JSON.stringify(
			{
				mode: scenario.mode,
				contractSourcePaths: getFlowModeSourcePaths(scenario.mode),
				expectedToolMentions: scenario.expectedToolMentions ?? [],
				forbiddenToolMentions: scenario.forbiddenToolMentions ?? [],
				expectedToolCalls: scenario.expectedToolCalls ?? [],
				forbiddenToolCalls: scenario.forbiddenToolCalls ?? [],
				requiredResponseSnippets: scenario.requiredResponseSnippets ?? [],
				forbiddenResponseSnippets: scenario.forbiddenResponseSnippets ?? [],
				nextStepSnippets: scenario.nextStepSnippets ?? [],
			},
			null,
			2,
		),
		"```",
		"",
		"## Model prompt",
		"",
		"```text",
		renderPromptSurface(scenario),
		"```",
		"",
	].join("\n");
}

export function buildPromptModeCaptureTemplate(
	scenario: PromptModeCaptureScenario,
): string {
	return `${JSON.stringify(
		{
			id: scenario.id,
			mode: scenario.mode,
			title: scenario.title,
			capturedFrom:
				"Paste the model/plugin surface, model name, date, and prompt packet path here.",
			minPassingScore: 6,
			expectedToolMentions: scenario.expectedToolMentions ?? [],
			forbiddenToolMentions: scenario.forbiddenToolMentions ?? [],
			expectedToolCalls: scenario.expectedToolCalls ?? [],
			forbiddenToolCalls: scenario.forbiddenToolCalls ?? [],
			requiredResponseSnippets: scenario.requiredResponseSnippets ?? [],
			forbiddenResponseSnippets: scenario.forbiddenResponseSnippets ?? [],
			nextStepSnippets: scenario.nextStepSnippets ?? [],
			expectedFailures: scenario.expectedFailures ?? [],
			modelOutput: "Paste the captured model output here.",
		},
		null,
		2,
	)}\n`;
}

export async function writePromptModeCapturePromptExports(
	options: { scenarios?: PromptModeCaptureScenario[]; outputDir?: string } = {},
): Promise<PromptModeCaptureExport[]> {
	const scenarios =
		options.scenarios ?? (await readPromptModeCaptureScenarios());
	const outputDir = options.outputDir ?? DEFAULT_PROMPT_MODE_CAPTURE_OUTPUT_DIR;
	await mkdir(outputDir, { recursive: true });
	const exports: PromptModeCaptureExport[] = [];
	for (const scenario of scenarios) {
		const promptPath = join(outputDir, `${scenario.id}.prompt.md`);
		const captureTemplatePath = join(outputDir, `${scenario.id}.capture.json`);
		await writeFile(promptPath, buildPromptModeCapturePrompt(scenario), "utf8");
		await writeFile(
			captureTemplatePath,
			buildPromptModeCaptureTemplate(scenario),
			"utf8",
		);
		exports.push({
			id: scenario.id,
			mode: scenario.mode,
			title: scenario.title,
			promptPath,
			captureTemplatePath,
		});
	}
	await writeFile(
		join(outputDir, "manifest.json"),
		`${JSON.stringify({ generatedAt: new Date().toISOString(), exports }, null, 2)}\n`,
		"utf8",
	);
	await writeFile(
		join(outputDir, "README.md"),
		[
			"# Prompt mode capture prompts",
			"",
			"These prompt packets are providerless. They export exact Flow command/agent prompt surfaces plus scenario inputs for manual/plugin-surface evaluation.",
			"",
			"1. Paste a `.prompt.md` packet's `Model prompt` into the model/plugin surface under evaluation.",
			"2. Paste the returned output into the matching `.capture.json` file's `modelOutput` field.",
			"3. Run `bun run eval:prompt-capture -- --score <capture-file.json>` to score it with the offline mode behavior rubric.",
			"4. Run `bun run eval:prompt-capture -- --promote <capture-file.json>` to convert a calibrated capture into a regression fixture.",
			"",
		].join("\n"),
		"utf8",
	);
	return exports;
}

export async function scorePromptModeCaptureFile(
	captureFile: string,
): Promise<string> {
	const capture = await readPromptModeCaptureFile(captureFile);
	const result = scorePromptModeBehaviorModelOutput({
		id: capture.id,
		mode: capture.mode,
		title: capture.title,
		modelOutput: capture.modelOutput,
		minPassingScore: capture.minPassingScore,
		expectedToolMentions: capture.expectedToolMentions,
		forbiddenToolMentions: capture.forbiddenToolMentions,
		expectedToolCalls: capture.expectedToolCalls,
		forbiddenToolCalls: capture.forbiddenToolCalls,
		requiredResponseSnippets: capture.requiredResponseSnippets,
		forbiddenResponseSnippets: capture.forbiddenResponseSnippets,
		nextStepSnippets: capture.nextStepSnippets,
		expectedFailures: capture.expectedFailures,
	});
	return [
		`Prompt mode capture score: ${result.id}`,
		`Mode: ${result.mode}`,
		`Score: ${result.score}/${result.maxScore}`,
		`Quality: ${result.passed ? "quality-pass" : "quality-fail"}`,
		`Failed criteria: ${result.actualFailures.join(", ") || "—"}`,
		...result.criteria.map(
			(criterion) =>
				`- ${criterion.criterion}: ${criterion.passed ? "pass" : "fail"} — ${criterion.summary}`,
		),
	].join("\n");
}

export async function promotePromptModeCaptureFile(
	captureFile: string,
	options: { outputDir?: string } = {},
): Promise<string> {
	const capture = await readPromptModeCaptureFile(captureFile);
	const result = scorePromptModeBehaviorModelOutput({
		id: capture.id,
		mode: capture.mode,
		title: capture.title,
		modelOutput: capture.modelOutput,
		minPassingScore: capture.minPassingScore,
		expectedToolMentions: capture.expectedToolMentions,
		forbiddenToolMentions: capture.forbiddenToolMentions,
		expectedToolCalls: capture.expectedToolCalls,
		forbiddenToolCalls: capture.forbiddenToolCalls,
		requiredResponseSnippets: capture.requiredResponseSnippets,
		forbiddenResponseSnippets: capture.forbiddenResponseSnippets,
		nextStepSnippets: capture.nextStepSnippets,
		expectedFailures: capture.expectedFailures,
	});
	if (!result.expectationSatisfied) {
		throw new Error(
			`Capture '${capture.id}' cannot be promoted because expectedFailures does not match actual failures: ${result.actualFailures.join(", ") || "none"}.`,
		);
	}
	const outputDir =
		options.outputDir ?? DEFAULT_PROMPT_MODE_CAPTURE_PROMOTION_DIR;
	await mkdir(outputDir, { recursive: true });
	const outputPath = join(outputDir, `${capture.id}.json`);
	const fixture = [
		{
			id: capture.id,
			mode: capture.mode,
			title: capture.title,
			origin: "captured",
			capturedFrom:
				capture.capturedFrom ??
				"Manual prompt mode capture; fill in model/plugin surface and date.",
			sourcePaths: getFlowModeSourcePaths(capture.mode),
			modelOutput: capture.modelOutput,
			minPassingScore: capture.minPassingScore,
			expectedToolMentions: capture.expectedToolMentions,
			forbiddenToolMentions: capture.forbiddenToolMentions,
			expectedToolCalls: capture.expectedToolCalls,
			forbiddenToolCalls: capture.forbiddenToolCalls,
			requiredResponseSnippets: capture.requiredResponseSnippets,
			forbiddenResponseSnippets: capture.forbiddenResponseSnippets,
			nextStepSnippets: capture.nextStepSnippets,
			...(capture.expectedFailures.length > 0
				? { expectedFailures: capture.expectedFailures }
				: {}),
		},
	];
	await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
	return [
		`Promoted prompt mode capture: ${capture.id}`,
		`Mode: ${capture.mode}`,
		`Score: ${result.score}/${result.maxScore}`,
		`Quality: ${result.passed ? "quality-pass" : "quality-fail"}`,
		`Fixture: ${outputPath}`,
	].join("\n");
}

export async function checkPromptModeCaptureScenarios(
	scenarioFile = DEFAULT_PROMPT_MODE_CAPTURE_SCENARIO_FILE,
): Promise<string> {
	const scenarios = await readPromptModeCaptureScenarios(scenarioFile);
	for (const scenario of scenarios) {
		buildPromptModeCapturePrompt(scenario);
		buildPromptModeCaptureTemplate(scenario);
	}
	return `Prompt mode capture scenarios valid: ${scenarios.length}`;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--check")) {
		console.log(await checkPromptModeCaptureScenarios());
		return;
	}
	const scoreIndex = args.indexOf("--score");
	if (scoreIndex >= 0) {
		const captureFile = args[scoreIndex + 1];
		if (captureFile === undefined) {
			throw new Error("Missing capture file after --score.");
		}
		console.log(await scorePromptModeCaptureFile(resolve(captureFile)));
		return;
	}
	const promoteIndex = args.indexOf("--promote");
	if (promoteIndex >= 0) {
		const captureFile = args[promoteIndex + 1];
		if (captureFile === undefined) {
			throw new Error("Missing capture file after --promote.");
		}
		const promotionDirIndex = args.indexOf("--promotion-dir");
		const promotionDirCandidate =
			promotionDirIndex >= 0 ? args[promotionDirIndex + 1] : undefined;
		const outputDir = promotionDirCandidate
			? resolve(promotionDirCandidate)
			: DEFAULT_PROMPT_MODE_CAPTURE_PROMOTION_DIR;
		console.log(
			await promotePromptModeCaptureFile(resolve(captureFile), { outputDir }),
		);
		return;
	}
	const outputDirIndex = args.indexOf("--output-dir");
	const outputDirCandidate =
		outputDirIndex >= 0 ? args[outputDirIndex + 1] : undefined;
	const outputDir = outputDirCandidate
		? resolve(outputDirCandidate)
		: DEFAULT_PROMPT_MODE_CAPTURE_OUTPUT_DIR;
	const exports = await writePromptModeCapturePromptExports({ outputDir });
	console.log(
		`Wrote ${exports.length} prompt mode capture prompt(s) to ${outputDir}`,
	);
	for (const item of exports) {
		console.log(`- ${item.id} (${item.mode}): ${item.promptPath}`);
	}
}

if (import.meta.main) {
	await main();
}
