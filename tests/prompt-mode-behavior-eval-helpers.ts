import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
	FLOW_PROMPT_MODE_CAPTURE_MODES,
	type FlowPromptCaptureMode,
	getFlowModeForbiddenTools,
	getFlowModeSourcePaths,
} from "../src/prompts/mode-contracts";
import { isFirstPartySourcePath } from "./prompt-eval-helpers";

export type PromptModeBehaviorMode = FlowPromptCaptureMode;

export type PromptModeBehaviorCriterion =
	| "text_output_valid"
	| "required_tool_sequence"
	| "forbidden_tool_absent"
	| "required_behavior_present"
	| "forbidden_behavior_absent"
	| "next_step_calibrated";

export type PromptModeBehaviorEvalCaseOrigin = "calibration" | "captured";

export type PromptModeBehaviorEvalCase = {
	id: string;
	mode: PromptModeBehaviorMode;
	title: string;
	origin?: PromptModeBehaviorEvalCaseOrigin;
	capturedFrom?: string;
	sourcePaths: string[];
	modelOutput: unknown;
	minPassingScore: number;
	expectedToolMentions?: string[];
	forbiddenToolMentions?: string[];
	expectedToolCalls?: string[];
	forbiddenToolCalls?: string[];
	requiredResponseSnippets?: string[];
	forbiddenResponseSnippets?: string[];
	nextStepSnippets?: string[];
	expectedFailures?: PromptModeBehaviorCriterion[];
};

export type PromptModeBehaviorCriterionResult = {
	criterion: PromptModeBehaviorCriterion;
	passed: boolean;
	summary: string;
};

export type PromptModeBehaviorEvalResult = {
	id: string;
	mode: PromptModeBehaviorMode;
	title: string;
	score: number;
	maxScore: number;
	passed: boolean;
	expectedFailures: PromptModeBehaviorCriterion[];
	actualFailures: PromptModeBehaviorCriterion[];
	expectationSatisfied: boolean;
	criteria: PromptModeBehaviorCriterionResult[];
};

export type PromptModeBehaviorEvalSummary = {
	totalCases: number;
	passingCases: number;
	failingCases: number;
	expectationSatisfiedCases: number;
	unexpectedCases: number;
	averageScore: number;
	results: PromptModeBehaviorEvalResult[];
	report: string;
	markdownReport: string;
};

export const PROMPT_MODE_BEHAVIOR_EVAL_FIXTURE_DIR = join(
	import.meta.dir,
	"__fixtures__",
	"prompt-mode-behavior-evals",
);

const PROMPT_MODE_BEHAVIOR_EVAL_REPO_ROOT = resolve(import.meta.dir, "..");
const KNOWN_MODES = new Set<PromptModeBehaviorMode>(
	FLOW_PROMPT_MODE_CAPTURE_MODES,
);
export const PROMPT_MODE_BEHAVIOR_CRITERIA = [
	"text_output_valid",
	"required_tool_sequence",
	"forbidden_tool_absent",
	"required_behavior_present",
	"forbidden_behavior_absent",
	"next_step_calibrated",
] as const satisfies readonly PromptModeBehaviorCriterion[];

const KNOWN_CRITERIA = new Set<PromptModeBehaviorCriterion>(
	PROMPT_MODE_BEHAVIOR_CRITERIA,
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourcePathExists(path: string): boolean {
	if (!isFirstPartySourcePath(path)) {
		return false;
	}
	const resolved = resolve(PROMPT_MODE_BEHAVIOR_EVAL_REPO_ROOT, path);
	return (
		(resolved === PROMPT_MODE_BEHAVIOR_EVAL_REPO_ROOT ||
			resolved.startsWith(PROMPT_MODE_BEHAVIOR_EVAL_REPO_ROOT + sep)) &&
		existsSync(resolved)
	);
}

function assertStringArray(
	value: unknown,
	field: string,
	caseId: string,
): asserts value is string[] | undefined {
	if (
		value !== undefined &&
		(!Array.isArray(value) || value.some((item) => typeof item !== "string"))
	) {
		throw new Error(
			`Prompt mode behavior eval case '${caseId}' ${field} must be a string array when present.`,
		);
	}
}

export function validatePromptModeBehaviorEvalCorpus(
	raw: unknown,
): PromptModeBehaviorEvalCase[] {
	if (!Array.isArray(raw)) {
		throw new Error("Prompt mode behavior eval corpus must be an array.");
	}

	const seenIds = new Set<string>();
	return raw.map((item) => {
		if (!isRecord(item)) {
			throw new Error(
				"Each prompt mode behavior eval entry must be an object.",
			);
		}
		const candidate = item as Partial<PromptModeBehaviorEvalCase>;
		if (!candidate.id || !/^[a-z0-9][a-z0-9-]*$/u.test(candidate.id)) {
			throw new Error(
				`Prompt mode behavior eval case needs a lowercase slug id: ${String(candidate.id)}`,
			);
		}
		if (seenIds.has(candidate.id)) {
			throw new Error(
				`Duplicate prompt mode behavior eval case id: ${candidate.id}`,
			);
		}
		seenIds.add(candidate.id);
		if (!candidate.mode || !KNOWN_MODES.has(candidate.mode)) {
			throw new Error(
				`Prompt mode behavior eval case '${candidate.id}' has an unknown mode.`,
			);
		}
		if (!candidate.title) {
			throw new Error(
				`Prompt mode behavior eval case '${candidate.id}' needs a title.`,
			);
		}
		if (
			candidate.origin !== undefined &&
			candidate.origin !== "calibration" &&
			candidate.origin !== "captured"
		) {
			throw new Error(
				`Prompt mode behavior eval case '${candidate.id}' has an unknown origin.`,
			);
		}
		if (candidate.origin === "captured" && !candidate.capturedFrom) {
			throw new Error(
				`Captured prompt mode behavior eval case '${candidate.id}' needs capturedFrom metadata.`,
			);
		}
		if (
			!Array.isArray(candidate.sourcePaths) ||
			candidate.sourcePaths.length === 0 ||
			candidate.sourcePaths.some((sourcePath) => !sourcePathExists(sourcePath))
		) {
			throw new Error(
				`Prompt mode behavior eval case '${candidate.id}' needs first-party source paths.`,
			);
		}
		for (const sourcePath of getFlowModeSourcePaths(candidate.mode)) {
			if (!candidate.sourcePaths.includes(sourcePath)) {
				throw new Error(
					`Prompt mode behavior eval case '${candidate.id}' is missing canonical mode source path: ${sourcePath}`,
				);
			}
		}
		if (candidate.minPassingScore === undefined) {
			throw new Error(
				`Prompt mode behavior eval case '${candidate.id}' needs minPassingScore.`,
			);
		}
		assertStringArray(
			candidate.expectedToolMentions,
			"expectedToolMentions",
			candidate.id,
		);
		assertStringArray(
			candidate.forbiddenToolMentions,
			"forbiddenToolMentions",
			candidate.id,
		);
		assertStringArray(
			candidate.expectedToolCalls,
			"expectedToolCalls",
			candidate.id,
		);
		assertStringArray(
			candidate.forbiddenToolCalls,
			"forbiddenToolCalls",
			candidate.id,
		);
		assertStringArray(
			candidate.requiredResponseSnippets,
			"requiredResponseSnippets",
			candidate.id,
		);
		assertStringArray(
			candidate.forbiddenResponseSnippets,
			"forbiddenResponseSnippets",
			candidate.id,
		);
		assertStringArray(
			candidate.nextStepSnippets,
			"nextStepSnippets",
			candidate.id,
		);
		if (
			candidate.expectedFailures !== undefined &&
			(!Array.isArray(candidate.expectedFailures) ||
				candidate.expectedFailures.some(
					(criterion) => !KNOWN_CRITERIA.has(criterion),
				))
		) {
			throw new Error(
				`Prompt mode behavior eval case '${candidate.id}' expectedFailures must be known criteria when present.`,
			);
		}
		return candidate as PromptModeBehaviorEvalCase;
	});
}

export function listPromptModeBehaviorEvalFixtureFiles(): string[] {
	function walk(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const absolutePath = join(dir, entry.name);
			if (entry.isDirectory()) {
				return walk(absolutePath);
			}
			return entry.isFile() && entry.name.endsWith(".json")
				? [absolutePath]
				: [];
		});
	}
	return walk(PROMPT_MODE_BEHAVIOR_EVAL_FIXTURE_DIR).sort();
}

export function readPromptModeBehaviorEvalCorpus(): PromptModeBehaviorEvalCase[] {
	const merged = listPromptModeBehaviorEvalFixtureFiles().flatMap(
		(fixtureFile) => JSON.parse(readFileSync(fixtureFile, "utf8")) as unknown[],
	);
	return validatePromptModeBehaviorEvalCorpus(merged);
}

function normalizeText(value: string): string {
	return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

function stringifyOutput(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (isRecord(value) || Array.isArray(value)) {
		return JSON.stringify(value);
	}
	return undefined;
}

function includesAllInOrder(output: string, snippets: string[]): boolean {
	let cursor = 0;
	for (const snippet of snippets) {
		const index = output.indexOf(normalizeText(snippet), cursor);
		if (index < 0) {
			return false;
		}
		cursor = index + normalizeText(snippet).length;
	}
	return true;
}

function includesAll(output: string, snippets: string[]): boolean {
	return snippets.every((snippet) => output.includes(normalizeText(snippet)));
}

function includesAny(output: string, snippets: string[]): boolean {
	return snippets.some((snippet) => output.includes(normalizeText(snippet)));
}

const STRUCTURED_TOOL_CALL_FIELDS = [
	"toolCalls",
	"actualToolCalls",
	"plannedToolCalls",
	"toolPlan",
	"willCallTools",
] as const;

function toolCallNameFromUnknown(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	for (const field of ["name", "tool", "toolName"] as const) {
		const candidate = value[field];
		if (typeof candidate === "string") {
			return candidate;
		}
	}
	return undefined;
}

function toolCallNamesFromUnknown(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const toolCalls = value.map(toolCallNameFromUnknown);
	return toolCalls.every((toolCall) => toolCall !== undefined)
		? (toolCalls as string[])
		: undefined;
}

function parseStructuredOutput(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return value;
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

function extractStructuredToolCalls(value: unknown): string[] | undefined {
	const parsed = parseStructuredOutput(value);
	if (!isRecord(parsed)) {
		return undefined;
	}
	for (const field of STRUCTURED_TOOL_CALL_FIELDS) {
		const toolCalls = toolCallNamesFromUnknown(parsed[field]);
		if (toolCalls !== undefined) {
			return toolCalls;
		}
	}
	return undefined;
}

function includesAllToolCallsInOrder(
	actualToolCalls: string[],
	expectedToolCalls: string[],
): boolean {
	let cursor = 0;
	const normalizedActual = actualToolCalls.map(normalizeText);
	for (const expectedToolCall of expectedToolCalls.map(normalizeText)) {
		const index = normalizedActual.indexOf(expectedToolCall, cursor);
		if (index < 0) {
			return false;
		}
		cursor = index + 1;
	}
	return true;
}

function includesAnyToolCall(
	actualToolCalls: string[],
	forbiddenToolCalls: string[],
): boolean {
	const normalizedActual = new Set(actualToolCalls.map(normalizeText));
	return forbiddenToolCalls.some((toolCall) =>
		normalizedActual.has(normalizeText(toolCall)),
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isNegatedOrBoundaryMention(
	output: string,
	mentionStart: number,
	mentionEnd: number,
): boolean {
	const before = output.slice(Math.max(0, mentionStart - 120), mentionStart);
	const after = output.slice(
		mentionEnd,
		Math.min(output.length, mentionEnd + 90),
	);
	return (
		/(?:\bdo not\b|\bdon't\b|\bnever\b|\bmust not\b|\bshould not\b|\bdo n't\b|\bcannot\b|\bcan't\b|\bavoid\b|\bforbid(?:den)?\b|\bprohibit(?:ed)?\b|\bdisallow(?:ed)?\b|\bnot allowed\b|\bwithout\b)[^.!?\n;:]{0,90}$/u.test(
			before,
		) ||
		/(?:forbidden|disallowed|prohibited|blocked|not[- ]allowed)[- _a-z]*tools?[^.!?\n;:]{0,90}$/u.test(
			before,
		) ||
		/^[^.!?\n;:]{0,70}\b(?:is|are|as)?\s*(?:forbidden|disallowed|prohibited|blocked|not allowed)\b/u.test(
			after,
		)
	);
}

function hasAffirmativeMention(output: string, snippet: string): boolean {
	const normalizedSnippet = normalizeText(snippet);
	if (!normalizedSnippet) {
		return false;
	}
	const pattern = new RegExp(
		`(^|[^a-z0-9_])${escapeRegExp(normalizedSnippet)}([^a-z0-9_]|$)`,
		"gu",
	);
	for (const match of output.matchAll(pattern)) {
		const index = match.index ?? 0;
		const prefix = match[1] ?? "";
		const mentionStart = index + prefix.length;
		const mentionEnd = mentionStart + normalizedSnippet.length;
		if (!isNegatedOrBoundaryMention(output, mentionStart, mentionEnd)) {
			return true;
		}
	}
	return false;
}

function includesAnyAffirmativeMention(
	output: string,
	snippets: string[],
): boolean {
	return snippets.some((snippet) => hasAffirmativeMention(output, snippet));
}

export function scorePromptModeBehaviorModelOutput(input: {
	id: string;
	mode: PromptModeBehaviorMode;
	title: string;
	modelOutput: unknown;
	minPassingScore: number;
	expectedToolMentions?: string[];
	forbiddenToolMentions?: string[];
	expectedToolCalls?: string[];
	forbiddenToolCalls?: string[];
	requiredResponseSnippets?: string[];
	forbiddenResponseSnippets?: string[];
	nextStepSnippets?: string[];
	expectedFailures?: PromptModeBehaviorCriterion[];
}): PromptModeBehaviorEvalResult {
	const outputText = stringifyOutput(input.modelOutput);
	const normalizedOutput = outputText ? normalizeText(outputText) : "";
	const structuredToolCalls = extractStructuredToolCalls(input.modelOutput);
	const expectedToolSequence =
		input.expectedToolCalls && input.expectedToolCalls.length > 0
			? input.expectedToolCalls
			: (input.expectedToolMentions ?? []);
	const forbiddenToolSequence = [
		...new Set([
			...(input.forbiddenToolCalls ?? []),
			...(input.forbiddenToolMentions ?? []),
			...getFlowModeForbiddenTools(input.mode),
		]),
	];
	const requiredResponseSnippets = input.requiredResponseSnippets ?? [];
	const forbiddenResponseSnippets = input.forbiddenResponseSnippets ?? [];
	const nextStepSnippets = input.nextStepSnippets ?? [];
	const criteria: PromptModeBehaviorCriterionResult[] = [
		{
			criterion: "text_output_valid",
			passed: typeof outputText === "string" && outputText.trim().length > 0,
			summary:
				"Model output is non-empty text or serializable structured text.",
		},
		{
			criterion: "required_tool_sequence",
			passed:
				structuredToolCalls !== undefined
					? includesAllToolCallsInOrder(
							structuredToolCalls,
							expectedToolSequence,
						)
					: includesAllInOrder(normalizedOutput, expectedToolSequence),
			summary:
				"Output names the required Flow tool calls in the expected order for this mode, preferring structured tool-call intent when present.",
		},
		{
			criterion: "forbidden_tool_absent",
			passed:
				structuredToolCalls !== undefined
					? !includesAnyToolCall(structuredToolCalls, forbiddenToolSequence)
					: !includesAnyAffirmativeMention(
							normalizedOutput,
							forbiddenToolSequence,
						),
			summary:
				"Output avoids affirmative Flow tool use that would violate this mode's boundary, preferring structured tool-call intent when present.",
		},
		{
			criterion: "required_behavior_present",
			passed: includesAll(normalizedOutput, requiredResponseSnippets),
			summary:
				"Output includes the required behavioral signals for this scenario.",
		},
		{
			criterion: "forbidden_behavior_absent",
			passed: !includesAny(normalizedOutput, forbiddenResponseSnippets),
			summary:
				"Output avoids overclaims, implementation leakage, or unsafe mode behavior for this scenario.",
		},
		{
			criterion: "next_step_calibrated",
			passed:
				nextStepSnippets.length === 0 ||
				includesAny(normalizedOutput, nextStepSnippets),
			summary:
				"Output ends with a calibrated stop condition or next Flow step for this scenario.",
		},
	];
	const score = criteria.filter((criterion) => criterion.passed).length;
	const actualFailures = criteria
		.filter((criterion) => !criterion.passed)
		.map((criterion) => criterion.criterion);
	const expectedFailures = input.expectedFailures ?? [];
	const sortedActualFailures = [...actualFailures].sort();
	const sortedExpectedFailures = [...expectedFailures].sort();
	return {
		id: input.id,
		mode: input.mode,
		title: input.title,
		score,
		maxScore: 6,
		passed: score >= input.minPassingScore,
		expectedFailures,
		actualFailures,
		expectationSatisfied:
			sortedActualFailures.length === sortedExpectedFailures.length &&
			sortedActualFailures.every(
				(criterion, index) => criterion === sortedExpectedFailures[index],
			),
		criteria,
	};
}

export function scorePromptModeBehaviorEvalCase(
	item: PromptModeBehaviorEvalCase,
): PromptModeBehaviorEvalResult {
	return scorePromptModeBehaviorModelOutput(item);
}

export function buildPromptModeBehaviorEvalSummary(
	corpus: PromptModeBehaviorEvalCase[],
): PromptModeBehaviorEvalSummary {
	const results = corpus.map(scorePromptModeBehaviorEvalCase);
	const passingCases = results.filter((result) => result.passed).length;
	const failingCases = results.length - passingCases;
	const expectationSatisfiedCases = results.filter(
		(result) => result.expectationSatisfied,
	).length;
	const unexpectedCases = results.length - expectationSatisfiedCases;
	const averageScore =
		results.length > 0
			? results.reduce((total, result) => result.score + total, 0) /
				results.length
			: 0;
	const byId = new Map<string, PromptModeBehaviorEvalCase>(
		corpus.map((item) => [item.id, item]),
	);
	const resultLines = results.map((result) => {
		return `- ${result.id}: ${result.score}/${result.maxScore} (${result.passed ? "quality-pass" : "quality-fail"}); mode=${result.mode}; expectation=${result.expectationSatisfied ? "satisfied" : "unexpected"}${result.actualFailures.length > 0 ? `; failed=${result.actualFailures.join(",")}` : ""}`;
	});
	const markdownRows = results.map((result) => {
		const item = byId.get(result.id);
		const failures = result.actualFailures.join(", ");
		return `| ${result.id} | ${result.mode} | ${item?.origin ?? "calibration"} | ${result.score}/${result.maxScore} | ${result.passed ? "quality-pass" : "quality-fail"} | ${result.expectationSatisfied ? "satisfied" : "unexpected"} | ${failures || "—"} |`;
	});
	const failureSections = results
		.filter((result) => result.criteria.some((criterion) => !criterion.passed))
		.map((result) => {
			const failedCriteria = result.criteria.filter(
				(criterion) => !criterion.passed,
			);
			return [
				`### ${result.id}`,
				`- Mode: ${result.mode}`,
				`- Title: ${result.title}`,
				...failedCriteria.map(
					(criterion) => `- ${criterion.criterion}: ${criterion.summary}`,
				),
			].join("\n");
		});
	const report = [
		`Prompt mode behavior eval corpus: ${results.length} cases`,
		`Quality-threshold pass: ${passingCases}`,
		`Quality-threshold fail: ${failingCases}`,
		`Expectation checks satisfied: ${expectationSatisfiedCases}`,
		`Unexpected eval outcomes: ${unexpectedCases}`,
		`Average rubric score: ${averageScore.toFixed(2)} / 6`,
		...resultLines,
	].join("\n");
	const markdownReport = [
		"# Prompt mode behavior eval summary",
		"",
		`- Total cases: ${results.length}`,
		`- Quality-threshold pass: ${passingCases}`,
		`- Quality-threshold fail: ${failingCases}`,
		`- Expectation checks satisfied: ${expectationSatisfiedCases}`,
		`- Unexpected eval outcomes: ${unexpectedCases}`,
		`- Average rubric score: ${averageScore.toFixed(2)} / 6`,
		"",
		"| Case | Mode | Origin | Score | Quality | Expectation | Failed criteria |",
		"| --- | --- | --- | ---: | --- | --- | --- |",
		...markdownRows,
		"",
		"## Failed criteria details",
		"",
		...(failureSections.length > 0
			? failureSections
			: ["All mode behavior eval criteria passed."]),
	].join("\n");

	return {
		totalCases: results.length,
		passingCases,
		failingCases,
		expectationSatisfiedCases,
		unexpectedCases,
		averageScore,
		results,
		report,
		markdownReport,
	};
}
