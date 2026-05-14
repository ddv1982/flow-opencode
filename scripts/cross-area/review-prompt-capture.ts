import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { FLOW_REVIEW_COMMAND_TEMPLATE } from "../../src/audit/prompts/commands";
import {
	type EvidencePacket,
	EvidencePacketArraySchema,
} from "../../src/runtime/schema";
import {
	type PromptBehaviorPacketExpectations,
	scorePromptBehaviorModelOutput,
	validatePromptBehaviorPacketExpectations,
} from "../../tests/prompt-behavior-eval-helpers";

export type ReviewCaptureOutputView = "human" | "structured" | "both";

export type ReviewCaptureTextBlock = string | string[];

export type ReviewCaptureSelectedContext = {
	included?: string[];
	excluded?: string[];
};

export type ReviewCaptureReviewPacket = {
	goal?: ReviewCaptureTextBlock;
	architecture?: ReviewCaptureTextBlock;
	selectedContext?: ReviewCaptureSelectedContext;
	relationships?: string[];
	ambiguities?: string[];
	knownExclusions?: string[];
	alreadyCoveredFindings?: string[];
	evidenceRequirements?: string[];
	evidencePackets?: EvidencePacket[];
	doneWhen?: ReviewCaptureTextBlock;
};

export type ReviewCaptureScenario = {
	id: string;
	title: string;
	arguments: string;
	outputView: ReviewCaptureOutputView;
	fileMap: string;
	reviewPacket?: ReviewCaptureReviewPacket;
	scoringExpectations?: PromptBehaviorPacketExpectations;
	notes?: string[];
};

export type ReviewCaptureExport = {
	id: string;
	title: string;
	promptPath: string;
	captureTemplatePath: string;
};

export const DEFAULT_REVIEW_CAPTURE_SCENARIO_FILE = resolve(
	import.meta.dir,
	"..",
	"..",
	"tests",
	"__fixtures__",
	"review-capture-scenarios",
	"review-scenarios.json",
);

export const DEFAULT_REVIEW_CAPTURE_OUTPUT_DIR = resolve(
	import.meta.dir,
	"..",
	"..",
	"prompt-exports",
	"review-capture-prompts",
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeSlug(value: string, fieldName: string): void {
	if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
		throw new Error(
			`Review capture ${fieldName} must be a lowercase slug: ${value}`,
		);
	}
}

function assertOptionalStringArray(
	value: unknown,
	scenarioId: string,
	fieldName: string,
): void {
	if (
		value !== undefined &&
		(!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
	) {
		throw new Error(
			`Review capture scenario '${scenarioId}' ${fieldName} must be an array of strings.`,
		);
	}
}

function assertOptionalTextBlock(
	value: unknown,
	scenarioId: string,
	fieldName: string,
): void {
	if (
		value !== undefined &&
		typeof value !== "string" &&
		(!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
	) {
		throw new Error(
			`Review capture scenario '${scenarioId}' ${fieldName} must be a string or array of strings.`,
		);
	}
}

function validateReviewPacket(reviewPacket: unknown, scenarioId: string): void {
	if (reviewPacket === undefined) {
		return;
	}
	if (!isRecord(reviewPacket)) {
		throw new Error(
			`Review capture scenario '${scenarioId}' reviewPacket must be an object.`,
		);
	}
	assertOptionalTextBlock(reviewPacket.goal, scenarioId, "reviewPacket.goal");
	assertOptionalTextBlock(
		reviewPacket.architecture,
		scenarioId,
		"reviewPacket.architecture",
	);
	assertOptionalTextBlock(
		reviewPacket.doneWhen,
		scenarioId,
		"reviewPacket.doneWhen",
	);
	if (
		reviewPacket.selectedContext !== undefined &&
		!isRecord(reviewPacket.selectedContext)
	) {
		throw new Error(
			`Review capture scenario '${scenarioId}' reviewPacket.selectedContext must be an object.`,
		);
	}
	if (isRecord(reviewPacket.selectedContext)) {
		assertOptionalStringArray(
			reviewPacket.selectedContext.included,
			scenarioId,
			"reviewPacket.selectedContext.included",
		);
		assertOptionalStringArray(
			reviewPacket.selectedContext.excluded,
			scenarioId,
			"reviewPacket.selectedContext.excluded",
		);
	}
	for (const fieldName of [
		"relationships",
		"ambiguities",
		"knownExclusions",
		"alreadyCoveredFindings",
		"evidenceRequirements",
	] as const) {
		assertOptionalStringArray(
			reviewPacket[fieldName],
			scenarioId,
			`reviewPacket.${fieldName}`,
		);
	}
	if (reviewPacket.evidencePackets !== undefined) {
		const packetResult = EvidencePacketArraySchema.safeParse(
			reviewPacket.evidencePackets,
		);
		if (!packetResult.success) {
			throw new Error(
				`Review capture scenario '${scenarioId}' reviewPacket.evidencePackets must match the shared evidence packet schema.`,
			);
		}
	}
}

export function validateReviewCaptureScenarios(
	raw: unknown,
): ReviewCaptureScenario[] {
	if (!Array.isArray(raw)) {
		throw new Error("Review capture scenarios must be an array.");
	}
	const seenIds = new Set<string>();
	return raw.map((entry) => {
		if (!isRecord(entry)) {
			throw new Error("Each review capture scenario must be an object.");
		}
		const scenario = entry as Partial<ReviewCaptureScenario>;
		if (!scenario.id) {
			throw new Error("Review capture scenario needs an id.");
		}
		assertSafeSlug(scenario.id, "id");
		if (seenIds.has(scenario.id)) {
			throw new Error(`Duplicate review capture scenario id: ${scenario.id}`);
		}
		seenIds.add(scenario.id);
		if (!scenario.title) {
			throw new Error(
				`Review capture scenario '${scenario.id}' needs a title.`,
			);
		}
		if (!scenario.arguments) {
			throw new Error(
				`Review capture scenario '${scenario.id}' needs arguments.`,
			);
		}
		if (
			scenario.outputView !== "human" &&
			scenario.outputView !== "structured" &&
			scenario.outputView !== "both"
		) {
			throw new Error(
				`Review capture scenario '${scenario.id}' needs outputView human, structured, or both.`,
			);
		}
		if (!scenario.fileMap?.trim().startsWith("flow-opencode")) {
			throw new Error(
				`Review capture scenario '${scenario.id}' needs a flow-opencode fileMap.`,
			);
		}
		validateReviewPacket(scenario.reviewPacket, scenario.id);
		if (scenario.scoringExpectations !== undefined) {
			validatePromptBehaviorPacketExpectations(
				scenario.scoringExpectations,
				`Review capture scenario '${scenario.id}' scoringExpectations`,
			);
		}
		assertOptionalStringArray(scenario.notes, scenario.id, "notes");
		return scenario as ReviewCaptureScenario;
	});
}

export async function readReviewCaptureScenarios(
	scenarioFile = DEFAULT_REVIEW_CAPTURE_SCENARIO_FILE,
): Promise<ReviewCaptureScenario[]> {
	const raw = JSON.parse(await readFile(scenarioFile, "utf8")) as unknown;
	return validateReviewCaptureScenarios(raw);
}

function viewInstruction(outputView: ReviewCaptureOutputView): string {
	if (outputView === "human") {
		return "Return the default human-readable markdown report.";
	}
	if (outputView === "both") {
		return "Return both readable and structured details so the structured ledger can be scored offline.";
	}
	return "Return raw/structured JSON only so the structured ledger can be scored offline.";
}

function textBlockLines(value: ReviewCaptureTextBlock | undefined): string[] {
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

function renderTextBlock(
	tag: string,
	value: ReviewCaptureTextBlock | undefined,
): string[] {
	const lines = textBlockLines(value)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		return [];
	}
	return [`<${tag}>`, ...lines.map((line) => `- ${line}`), `</${tag}>`];
}

function renderStringList(tag: string, values: string[] | undefined): string[] {
	const lines = values?.map((line) => line.trim()).filter(Boolean) ?? [];
	if (lines.length === 0) {
		return [];
	}
	return [`<${tag}>`, ...lines.map((line) => `- ${line}`), `</${tag}>`];
}

function renderSelectedContext(
	selectedContext: ReviewCaptureSelectedContext | undefined,
): string[] {
	const included = renderStringList("included", selectedContext?.included);
	const excluded = renderStringList("excluded", selectedContext?.excluded);
	if (included.length === 0 && excluded.length === 0) {
		return [];
	}
	return [
		"<selected-context>",
		...included,
		...excluded,
		"</selected-context>",
	];
}

function renderEvidencePackets(
	evidencePackets: readonly EvidencePacket[] | undefined,
): string[] {
	if (!evidencePackets || evidencePackets.length === 0) {
		return [];
	}
	return [
		"<evidence-packets>",
		...evidencePackets.map((packet) => JSON.stringify(packet)),
		"</evidence-packets>",
	];
}

function renderReviewPacket(
	reviewPacket: ReviewCaptureReviewPacket | undefined,
): string[] {
	if (!reviewPacket) {
		return [];
	}
	const packetLines = [
		...renderTextBlock("goal", reviewPacket.goal),
		...renderTextBlock("architecture", reviewPacket.architecture),
		...renderSelectedContext(reviewPacket.selectedContext),
		...renderStringList("relationships", reviewPacket.relationships),
		...renderStringList("ambiguities", reviewPacket.ambiguities),
		...renderStringList("known-exclusions", reviewPacket.knownExclusions),
		...renderStringList(
			"already-covered-findings",
			reviewPacket.alreadyCoveredFindings,
		),
		...renderStringList(
			"evidence-requirements",
			reviewPacket.evidenceRequirements,
		),
		...renderEvidencePackets(reviewPacket.evidencePackets),
		...renderTextBlock("done-when", reviewPacket.doneWhen),
	];
	if (packetLines.length === 0) {
		return [];
	}
	return ["<review-packet>", ...packetLines, "</review-packet>", ""];
}

function nonEmpty(values: string[] | undefined): string[] | undefined {
	const trimmed = values?.map((value) => value.trim()).filter(Boolean) ?? [];
	return trimmed.length > 0 ? trimmed : undefined;
}

function mergeStringArrays(
	left: string[] | undefined,
	right: string[] | undefined,
): string[] | undefined {
	const merged = [...(left ?? []), ...(right ?? [])];
	return merged.length > 0 ? [...new Set(merged)] : undefined;
}

function mergePacketExpectations(
	base: PromptBehaviorPacketExpectations | undefined,
	explicit: PromptBehaviorPacketExpectations | undefined,
): PromptBehaviorPacketExpectations | undefined {
	if (!base) {
		return explicit;
	}
	if (!explicit) {
		return base;
	}
	const merged: PromptBehaviorPacketExpectations = {};
	for (const fieldName of [
		"selectedContext",
		"relationships",
		"ambiguities",
		"knownExclusions",
		"alreadyCoveredFindings",
		"forbiddenDirectReview",
		"requiredDirectReview",
	] as const) {
		const values = mergeStringArrays(base[fieldName], explicit[fieldName]);
		if (values) {
			merged[fieldName] = values;
		}
	}
	const forbiddenBehaviorChecks = mergeStringArrays(
		base.forbiddenBehaviorChecks,
		explicit.forbiddenBehaviorChecks,
	) as NonNullable<
		PromptBehaviorPacketExpectations["forbiddenBehaviorChecks"]
	> | undefined;
	if (forbiddenBehaviorChecks) {
		merged.forbiddenBehaviorChecks = forbiddenBehaviorChecks;
	}
	const requiredBehaviorChecks = [
		...(base.requiredBehaviorChecks ?? []),
		...(explicit.requiredBehaviorChecks ?? []),
	];
	if (requiredBehaviorChecks.length > 0) {
		merged.requiredBehaviorChecks = requiredBehaviorChecks;
	}
	return Object.values(merged).some((value) => value !== undefined)
		? merged
		: undefined;
}

function reviewPacketExpectations(
	reviewPacket: ReviewCaptureReviewPacket | undefined,
): PromptBehaviorPacketExpectations | undefined {
	if (!reviewPacket) {
		return undefined;
	}
	const selectedContext = nonEmpty([
		...(reviewPacket.selectedContext?.included ?? []),
		...(reviewPacket.selectedContext?.excluded ?? []),
	]);
	const knownExclusions = nonEmpty(reviewPacket.knownExclusions);
	const relationships = nonEmpty(reviewPacket.relationships);
	const ambiguities = nonEmpty(reviewPacket.ambiguities);
	const alreadyCoveredFindings = nonEmpty(reviewPacket.alreadyCoveredFindings);
	const forbiddenDirectReview = nonEmpty([
		...(reviewPacket.selectedContext?.excluded ?? []),
		...(knownExclusions ?? []),
	]);
	const expectations: PromptBehaviorPacketExpectations = {
		...(selectedContext ? { selectedContext } : {}),
		...(relationships ? { relationships } : {}),
		...(ambiguities ? { ambiguities } : {}),
		...(knownExclusions ? { knownExclusions } : {}),
		...(alreadyCoveredFindings ? { alreadyCoveredFindings } : {}),
		...(forbiddenDirectReview ? { forbiddenDirectReview } : {}),
	};
	return Object.values(expectations).some((value) => value !== undefined)
		? expectations
		: undefined;
}

export function buildReviewCapturePrompt(
	scenario: ReviewCaptureScenario,
): string {
	const userArguments = [
		...renderReviewPacket(scenario.reviewPacket),
		scenario.arguments.trim(),
		viewInstruction(scenario.outputView),
		"",
		"<file_map>",
		scenario.fileMap.trim(),
		"</file_map>",
	].join("\n");
	const modelPrompt = FLOW_REVIEW_COMMAND_TEMPLATE.replace(
		"$ARGUMENTS",
		userArguments,
	);
	return [
		`# Review capture prompt: ${scenario.title}`,
		"",
		"## Operator instructions",
		"",
		"- This is an offline/providerless prompt-quality capture packet; it does not call any model API.",
		"- Paste the `Model prompt` section into the plugin/model surface you want to evaluate.",
		"- Save the returned structured ledger JSON into the sibling capture template's `modelOutput` field.",
		"- Score the capture with `bun run eval:review-capture -- --score <capture-file.json>`.",
		...(scenario.notes ?? []).map((note) => `- ${note}`),
		"",
		"## Model prompt",
		"",
		"```text",
		modelPrompt,
		"```",
		"",
	].join("\n");
}

export function buildReviewCaptureTemplate(
	scenario: ReviewCaptureScenario,
): string {
	const packetExpectations = mergePacketExpectations(
		reviewPacketExpectations(scenario.reviewPacket),
		scenario.scoringExpectations,
	);
	return `${JSON.stringify(
		{
			id: scenario.id,
			title: scenario.title,
			capturedFrom:
				"Paste the model/plugin surface, model name, date, and prompt packet path here.",
			minPassingScore: packetExpectations ? 10 : 9,
			...(packetExpectations ? { packetExpectations } : {}),
			modelOutput: {
				replace: "Paste the structured review ledger JSON here.",
			},
		},
		null,
		2,
	)}\n`;
}

export async function writeReviewCapturePromptExports(
	options: { scenarios?: ReviewCaptureScenario[]; outputDir?: string } = {},
): Promise<ReviewCaptureExport[]> {
	const scenarios = options.scenarios ?? (await readReviewCaptureScenarios());
	const outputDir = options.outputDir ?? DEFAULT_REVIEW_CAPTURE_OUTPUT_DIR;
	await mkdir(outputDir, { recursive: true });
	const exports: ReviewCaptureExport[] = [];
	for (const scenario of scenarios) {
		const promptPath = join(outputDir, `${scenario.id}.prompt.md`);
		const captureTemplatePath = join(outputDir, `${scenario.id}.capture.json`);
		await writeFile(promptPath, buildReviewCapturePrompt(scenario), "utf8");
		await writeFile(
			captureTemplatePath,
			buildReviewCaptureTemplate(scenario),
			"utf8",
		);
		exports.push({
			id: scenario.id,
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
			"# Review capture prompts",
			"",
			"These prompt packets are providerless. They export the exact Flow review command prompt plus scenario file maps for manual/plugin-surface evaluation.",
			"",
			"1. Paste a `.prompt.md` packet's `Model prompt` into the model/plugin surface under evaluation.",
			"2. Paste the returned structured ledger JSON into the matching `.capture.json` file's `modelOutput` field.",
			"3. Run `bun run eval:review-capture -- --score <capture-file.json>` to score it with the offline behavior rubric.",
			"4. Promote useful real outputs into `tests/__fixtures__/prompt-behavior-evals/captured-review-outputs/` when they should become regressions.",
			"",
		].join("\n"),
		"utf8",
	);
	return exports;
}

function parsePacketExpectations(
	value: unknown,
): PromptBehaviorPacketExpectations | undefined {
	if (value === undefined) {
		return undefined;
	}
	validatePromptBehaviorPacketExpectations(
		value,
		"Review capture packetExpectations",
	);
	return Object.values(value).some((field) => field !== undefined)
		? value
		: undefined;
}

export async function scoreReviewCaptureFile(
	captureFile: string,
): Promise<string> {
	const raw = JSON.parse(await readFile(captureFile, "utf8")) as unknown;
	if (!isRecord(raw)) {
		throw new Error("Review capture file must be a JSON object.");
	}
	const id = typeof raw.id === "string" ? raw.id : basename(captureFile);
	const title = typeof raw.title === "string" ? raw.title : id;
	const packetExpectations = parsePacketExpectations(raw.packetExpectations);
	const minPassingScore =
		typeof raw.minPassingScore === "number"
			? raw.minPassingScore
			: packetExpectations
				? 10
				: 9;
	const modelOutput =
		isRecord(raw) && "modelOutput" in raw ? raw.modelOutput : raw;
	const result = scorePromptBehaviorModelOutput({
		id,
		title,
		modelOutput,
		minPassingScore,
		...(packetExpectations ? { packetExpectations } : {}),
	});
	return [
		`Review capture score: ${result.id}`,
		`Score: ${result.score}/${result.maxScore}`,
		`Quality: ${result.passed ? "quality-pass" : "quality-fail"}`,
		`Failed criteria: ${result.actualFailures.join(", ") || "—"}`,
		...result.criteria.map(
			(criterion) =>
				`- ${criterion.criterion}: ${criterion.passed ? "pass" : "fail"} — ${criterion.summary}`,
		),
	].join("\n");
}

export async function checkReviewCaptureScenarios(
	scenarioFile = DEFAULT_REVIEW_CAPTURE_SCENARIO_FILE,
): Promise<string> {
	const scenarios = await readReviewCaptureScenarios(scenarioFile);
	for (const scenario of scenarios) {
		buildReviewCapturePrompt(scenario);
		buildReviewCaptureTemplate(scenario);
	}
	return `Review capture scenarios valid: ${scenarios.length}`;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--check")) {
		console.log(await checkReviewCaptureScenarios());
		return;
	}
	const scoreIndex = args.indexOf("--score");
	if (scoreIndex >= 0) {
		const captureFile = args[scoreIndex + 1];
		if (captureFile === undefined) {
			throw new Error("Missing capture file after --score.");
		}
		console.log(await scoreReviewCaptureFile(resolve(captureFile)));
		return;
	}
	const outputDirIndex = args.indexOf("--output-dir");
	const outputDirCandidate =
		outputDirIndex >= 0 ? args[outputDirIndex + 1] : undefined;
	const outputDir = outputDirCandidate
		? resolve(outputDirCandidate)
		: DEFAULT_REVIEW_CAPTURE_OUTPUT_DIR;
	const exports = await writeReviewCapturePromptExports({ outputDir });
	console.log(
		`Wrote ${exports.length} review capture prompt(s) to ${outputDir}`,
	);
	for (const item of exports) {
		console.log(`- ${item.id}: ${item.promptPath}`);
	}
}

if (import.meta.main) {
	await main();
}
