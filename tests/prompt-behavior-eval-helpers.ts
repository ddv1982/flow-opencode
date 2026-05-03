import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { normalizeReviewReport } from "../src/audit/report-normalizer";
import { renderReviewReport } from "../src/audit/report-presenter";
import {
	type ReviewReport,
	ReviewReportSchema,
} from "../src/audit/report-schema";
import { isFirstPartySourcePath } from "./prompt-eval-helpers";

export type PromptBehaviorCriterion =
	| "schema_valid"
	| "human_readable_sections"
	| "depth_calibrated"
	| "coverage_accounted"
	| "validation_accounted"
	| "finding_grounded"
	| "failure_modes_accounted"
	| "taxonomy_calibrated"
	| "actionable_next_steps"
	| "packet_boundaries_preserved";

export type PromptBehaviorEvalCaseId =
	| "review-full-depth-downgrades-spot-check"
	| "review-overclaims-full-depth"
	| "review-confirmed-defect-grounded"
	| "review-ungrounded-output-rejected"
	| "review-misses-failure-mode-accounting"
	| "review-packet-boundaries-reopened"
	| "captured-review-csv-memory-risk-calibrated"
	| "captured-review-overconfident-validation-gap";

export type PromptBehaviorEvalCaseOrigin = "calibration" | "captured";

export type PromptBehaviorPacketExpectations = {
	selectedContext?: string[];
	relationships?: string[];
	ambiguities?: string[];
	knownExclusions?: string[];
	alreadyCoveredFindings?: string[];
	forbiddenDirectReview?: string[];
};

export type PromptBehaviorEvalCase = {
	id: PromptBehaviorEvalCaseId;
	title: string;
	origin?: PromptBehaviorEvalCaseOrigin;
	capturedFrom?: string;
	sourcePaths: string[];
	modelOutput: unknown;
	minPassingScore: number;
	packetExpectations?: PromptBehaviorPacketExpectations;
	expectedFailures?: PromptBehaviorCriterion[];
};

export type PromptBehaviorCriterionResult = {
	criterion: PromptBehaviorCriterion;
	passed: boolean;
	summary: string;
};

export type PromptBehaviorEvalResult = {
	id: string;
	title: string;
	score: number;
	maxScore: number;
	passed: boolean;
	expectedFailures: PromptBehaviorCriterion[];
	actualFailures: PromptBehaviorCriterion[];
	expectationSatisfied: boolean;
	criteria: PromptBehaviorCriterionResult[];
};

export type PromptBehaviorEvalSummary = {
	totalCases: number;
	passingCases: number;
	failingCases: number;
	expectationSatisfiedCases: number;
	unexpectedCases: number;
	averageScore: number;
	results: PromptBehaviorEvalResult[];
	report: string;
	markdownReport: string;
};

export const PROMPT_BEHAVIOR_EVAL_FIXTURE_DIR = join(
	import.meta.dir,
	"__fixtures__",
	"prompt-behavior-evals",
);

const PROMPT_BEHAVIOR_EVAL_REPO_ROOT = resolve(import.meta.dir, "..");
const KNOWN_BEHAVIOR_CASE_IDS = new Set<PromptBehaviorEvalCaseId>([
	"review-full-depth-downgrades-spot-check",
	"review-overclaims-full-depth",
	"review-confirmed-defect-grounded",
	"review-ungrounded-output-rejected",
	"review-misses-failure-mode-accounting",
	"review-packet-boundaries-reopened",
	"captured-review-csv-memory-risk-calibrated",
	"captured-review-overconfident-validation-gap",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourcePathExists(path: string): boolean {
	if (!isFirstPartySourcePath(path)) {
		return false;
	}
	const resolved = resolve(PROMPT_BEHAVIOR_EVAL_REPO_ROOT, path);
	return (
		(resolved === PROMPT_BEHAVIOR_EVAL_REPO_ROOT ||
			resolved.startsWith(PROMPT_BEHAVIOR_EVAL_REPO_ROOT + sep)) &&
		existsSync(resolved)
	);
}

export function validatePromptBehaviorEvalCorpus(
	raw: unknown,
): PromptBehaviorEvalCase[] {
	if (!Array.isArray(raw)) {
		throw new Error("Prompt behavior eval corpus must be an array.");
	}

	const seenIds = new Set<string>();
	return raw.map((item) => {
		if (!isRecord(item)) {
			throw new Error("Each prompt behavior eval entry must be an object.");
		}
		const candidate = item as Partial<PromptBehaviorEvalCase>;
		if (!candidate.id || !KNOWN_BEHAVIOR_CASE_IDS.has(candidate.id)) {
			throw new Error(
				`Unknown prompt behavior eval case id: ${String(candidate.id)}`,
			);
		}
		if (seenIds.has(candidate.id)) {
			throw new Error(
				`Duplicate prompt behavior eval case id: ${candidate.id}`,
			);
		}
		seenIds.add(candidate.id);
		if (!candidate.title) {
			throw new Error(
				`Prompt behavior eval case '${candidate.id}' needs a title.`,
			);
		}
		if (
			candidate.origin !== undefined &&
			candidate.origin !== "calibration" &&
			candidate.origin !== "captured"
		) {
			throw new Error(
				`Prompt behavior eval case '${candidate.id}' has an unknown origin.`,
			);
		}
		if (candidate.origin === "captured" && !candidate.capturedFrom) {
			throw new Error(
				`Captured prompt behavior eval case '${candidate.id}' needs capturedFrom metadata.`,
			);
		}
		if (
			!Array.isArray(candidate.sourcePaths) ||
			candidate.sourcePaths.length === 0 ||
			candidate.sourcePaths.some((sourcePath) => !sourcePathExists(sourcePath))
		) {
			throw new Error(
				`Prompt behavior eval case '${candidate.id}' needs first-party source paths.`,
			);
		}
		if (candidate.minPassingScore === undefined) {
			throw new Error(
				`Prompt behavior eval case '${candidate.id}' needs minPassingScore.`,
			);
		}
		if (candidate.packetExpectations !== undefined) {
			if (!isRecord(candidate.packetExpectations)) {
				throw new Error(
					`Prompt behavior eval case '${candidate.id}' packetExpectations must be an object.`,
				);
			}
			for (const fieldName of [
				"selectedContext",
				"relationships",
				"ambiguities",
				"knownExclusions",
				"alreadyCoveredFindings",
				"forbiddenDirectReview",
			] as const) {
				const field = candidate.packetExpectations[fieldName];
				if (
					field !== undefined &&
					(!Array.isArray(field) ||
						field.some((entry) => typeof entry !== "string"))
				) {
					throw new Error(
						`Prompt behavior eval case '${candidate.id}' packetExpectations.${fieldName} must be an array of strings.`,
					);
				}
			}
		}
		if (
			candidate.expectedFailures &&
			!Array.isArray(candidate.expectedFailures)
		) {
			throw new Error(
				`Prompt behavior eval case '${candidate.id}' expectedFailures must be an array when present.`,
			);
		}
		return candidate as PromptBehaviorEvalCase;
	});
}

export function listPromptBehaviorEvalFixtureFiles(): string[] {
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
	return walk(PROMPT_BEHAVIOR_EVAL_FIXTURE_DIR).sort();
}

export function readPromptBehaviorEvalCorpus(): PromptBehaviorEvalCase[] {
	const merged = listPromptBehaviorEvalFixtureFiles().flatMap(
		(fixtureFile) => JSON.parse(readFileSync(fixtureFile, "utf8")) as unknown[],
	);
	return validatePromptBehaviorEvalCorpus(merged);
}

const EVIDENCE_REFERENCE_PATTERN =
	/[\w./-]+\.(?:json|md|markdown|ya?ml|ts|tsx|js|mjs|cjs|rs|toml|lock|sh|css|scss|html|vue|svelte)(?::\d+(?:-\d+)?)?/gu;

function isSafeRelativeEvidenceReference(reference: string): boolean {
	const pathWithoutLine = reference.replace(/:\d+(?:-\d+)?$/u, "");
	return (
		!pathWithoutLine.startsWith("/") &&
		!pathWithoutLine.split("/").includes("..")
	);
}

function hasSpecificEvidenceReference(reference: string): boolean {
	const matches = reference.match(EVIDENCE_REFERENCE_PATTERN) ?? [];
	return matches.some(isSafeRelativeEvidenceReference);
}

function includesCaseInsensitive(
	value: string,
	patterns: readonly string[],
): boolean {
	const normalized = value.toLowerCase();
	return patterns.some((pattern) => normalized.includes(pattern));
}

function requiredSectionsInOrder(rendered: string): boolean {
	const sections = [
		"## Conclusion",
		"## Top findings",
		"## Recommended next actions",
		"## Coverage notes",
	];
	let previousIndex = -1;
	for (const section of sections) {
		const index = rendered.indexOf(section);
		if (index <= previousIndex) {
			return false;
		}
		previousIndex = index;
	}
	return true;
}

const FAILURE_MODE_REVIEW_PATTERNS = [
	"failure-mode",
	"failure mode",
	"adversarial",
	"idempot",
	"reentr",
	"double",
	"race",
	"event order",
	"async",
	"persistence",
	"recovery",
	"recover",
	"backpressure",
	"hit-test",
	"z-index",
	"pointer",
	"accessib",
	"aria",
	"test oracle",
	"normal product path",
	"shortcut",
] as const;

function reportReviewText(report: ReviewReport): string {
	return [
		report.repoSummary,
		report.overallVerdict,
		...(report.coverageNotes ?? []),
		...report.discoveredSurfaces.flatMap((surface) => [
			surface.name,
			surface.reason ?? "",
		]),
		...report.validationRun.map((entry) => entry.summary),
		...report.findings.flatMap((finding) => [
			finding.title,
			finding.impact,
			finding.remediation ?? "",
		]),
		...(report.nextSteps ?? []),
	].join("\n");
}

function hasFailureModeAccounting(report: ReviewReport): boolean {
	const behaviorSurfacePresent = report.discoveredSurfaces.some(
		(surface) =>
			surface.category === "source_runtime" || surface.category === "tests",
	);
	if (!behaviorSurfacePresent) {
		return true;
	}
	return includesCaseInsensitive(
		reportReviewText(report),
		FAILURE_MODE_REVIEW_PATTERNS,
	);
}

function packetExpectationsPreserved(
	report: ReviewReport,
	expectations: PromptBehaviorPacketExpectations | undefined,
): boolean {
	if (!expectations) {
		return true;
	}
	const reviewText = reportReviewText(report).toLowerCase();
	const directlyReviewedText = report.discoveredSurfaces
		.filter((surface) => surface.reviewStatus === "directly_reviewed")
		.flatMap((surface) => [
			surface.name,
			surface.reason ?? "",
			...(surface.evidence ?? []),
		])
		.join("\n")
		.toLowerCase();
	if (
		(expectations.forbiddenDirectReview ?? []).some((value) =>
			directlyReviewedText.includes(value.toLowerCase()),
		)
	) {
		return false;
	}
	const expectedGroups: [
		keyof PromptBehaviorPacketExpectations,
		readonly string[],
	][] = [
		["selectedContext", expectations.selectedContext ?? []],
		["relationships", expectations.relationships ?? []],
		["ambiguities", expectations.ambiguities ?? []],
		["knownExclusions", expectations.knownExclusions ?? []],
		["alreadyCoveredFindings", expectations.alreadyCoveredFindings ?? []],
	];
	return expectedGroups.every(([groupName, values]) => {
		if (values.length === 0) {
			return true;
		}
		const groupCuePresent =
			groupName === "selectedContext"
				? includesCaseInsensitive(reviewText, ["selected", "scope", "context"])
				: groupName === "relationships"
					? includesCaseInsensitive(reviewText, [
							"relationship",
							"trace",
							"path",
						])
					: groupName === "ambiguities"
						? includesCaseInsensitive(reviewText, [
								"ambigu",
								"uncertain",
								"gap",
							])
						: groupName === "knownExclusions"
							? includesCaseInsensitive(reviewText, [
									"excluded",
									"out of scope",
								])
							: includesCaseInsensitive(reviewText, [
									"already-covered",
									"already covered",
									"previously covered",
								]);
		return (
			groupCuePresent &&
			values.every((value) => reviewText.includes(value.toLowerCase()))
		);
	});
}

function isFullAuditEvidenceBacked(report: ReviewReport): boolean {
	return (
		report.discoveredSurfaces.length > 0 &&
		report.discoveredSurfaces.every(
			(surface) =>
				surface.reviewStatus === "directly_reviewed" &&
				(surface.evidence?.length ?? 0) > 0,
		)
	);
}

function scoreParsedReport(
	report: ReviewReport,
	packetExpectations?: PromptBehaviorPacketExpectations,
): PromptBehaviorCriterionResult[] {
	const normalizedReport = normalizeReviewReport(report);
	const rendered = renderReviewReport(normalizedReport, "human");
	const depthCalibrated =
		report.requestedDepth !== "full_audit" ||
		isFullAuditEvidenceBacked(report) ||
		(report.achievedDepth !== "full_audit" &&
			(report.coverageNotes ?? []).some((note) =>
				includesCaseInsensitive(note, ["downgrad", "spot", "not every"]),
			));
	const coverageAccounted =
		normalizedReport.discoveredSurfaces.length > 0 &&
		normalizedReport.discoveredSurfaces.every((surface) => {
			if (surface.reviewStatus === "directly_reviewed") {
				return (surface.evidence ?? []).some(hasSpecificEvidenceReference);
			}
			return Boolean(surface.reason);
		});
	const validationAccounted =
		normalizedReport.validationRun.length > 0 &&
		normalizedReport.validationRun.every((entry) => {
			if (entry.status !== "not_run") {
				return entry.summary.length > 0;
			}
			return includesCaseInsensitive(entry.summary, [
				"not run",
				"not executed",
				"read-only",
				"ci",
				"validation",
			]);
		});
	const findingGrounded = normalizedReport.findings.every(
		(finding) =>
			finding.evidence.length > 0 &&
			finding.evidence.every(hasSpecificEvidenceReference),
	);
	const taxonomyCalibrated = normalizedReport.findings.every((finding) => {
		if (
			finding.category === "confirmed_defect" &&
			finding.confidence !== "confirmed"
		) {
			return false;
		}
		if (
			finding.category !== "confirmed_defect" &&
			finding.severity === "high" &&
			finding.confidence === "speculative"
		) {
			return false;
		}
		if (
			finding.category === "hardening_opportunity" &&
			finding.severity === "high"
		) {
			return false;
		}
		return true;
	});
	const failureModesAccounted = hasFailureModeAccounting(normalizedReport);
	const packetBoundariesPreserved = packetExpectationsPreserved(
		normalizedReport,
		packetExpectations,
	);
	const actionableNextSteps =
		(normalizedReport.nextSteps?.length ?? 0) > 0 &&
		normalizedReport.findings.every((finding) => Boolean(finding.remediation));

	return [
		{
			criterion: "human_readable_sections",
			passed: requiredSectionsInOrder(rendered),
			summary: "Rendered review contains the required human sections in order.",
		},
		{
			criterion: "depth_calibrated",
			passed: depthCalibrated,
			summary:
				"Full-audit claims are reserved for evidence-backed direct review of every discovered surface.",
		},
		{
			criterion: "coverage_accounted",
			passed: coverageAccounted,
			summary:
				"Each discovered surface is represented with evidence or an explicit skipped/spot-checked reason.",
		},
		{
			criterion: "validation_accounted",
			passed: validationAccounted,
			summary:
				"Validation status is explicitly recorded, including not_run explanations.",
		},
		{
			criterion: "finding_grounded",
			passed: findingGrounded,
			summary: "Findings carry concrete first-party evidence references.",
		},
		{
			criterion: "failure_modes_accounted",
			passed: failureModesAccounted,
			summary:
				"Behavior-surface reviews account for applicable adversarial failure-mode classes or explain why they are out of scope.",
		},
		{
			criterion: "taxonomy_calibrated",
			passed: taxonomyCalibrated,
			summary:
				"Finding categories, confidence, and severity stay calibrated to the evidence strength.",
		},
		{
			criterion: "actionable_next_steps",
			passed: actionableNextSteps,
			summary:
				"Findings include remediation and the review has concrete next steps.",
		},
		...(packetExpectations
			? [
					{
						criterion: "packet_boundaries_preserved" as const,
						passed: packetBoundariesPreserved,
						summary:
							"Review output preserves selected context, relationships, ambiguities, exclusions, and already-covered findings from the input packet.",
					},
				]
			: []),
	];
}

export function scorePromptBehaviorModelOutput(input: {
	id: string;
	title: string;
	modelOutput: unknown;
	minPassingScore: number;
	packetExpectations?: PromptBehaviorPacketExpectations;
	expectedFailures?: PromptBehaviorCriterion[];
}): PromptBehaviorEvalResult {
	const parsed = ReviewReportSchema.safeParse(input.modelOutput);
	const criteria: PromptBehaviorCriterionResult[] = [
		{
			criterion: "schema_valid",
			passed: parsed.success,
			summary: parsed.success
				? "Model output satisfies the structured review ledger schema."
				: parsed.error.issues.map((issue) => issue.message).join("; "),
		},
	];

	if (parsed.success) {
		criteria.push(...scoreParsedReport(parsed.data, input.packetExpectations));
	}

	const score = criteria.filter((criterion) => criterion.passed).length;
	const maxScore = parsed.success
		? criteria.length
		: input.packetExpectations
			? 10
			: 9;
	const actualFailures = criteria
		.filter((criterion) => !criterion.passed)
		.map((criterion) => criterion.criterion);
	const expectedFailures = input.expectedFailures ?? [];
	const sortedActualFailures = [...actualFailures].sort();
	const sortedExpectedFailures = [...expectedFailures].sort();
	return {
		id: input.id,
		title: input.title,
		score,
		maxScore,
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

export function scorePromptBehaviorEvalCase(
	item: PromptBehaviorEvalCase,
): PromptBehaviorEvalResult {
	return scorePromptBehaviorModelOutput(item);
}

export function buildPromptBehaviorEvalSummary(
	corpus: PromptBehaviorEvalCase[],
): PromptBehaviorEvalSummary {
	const results = corpus.map(scorePromptBehaviorEvalCase);
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
	const averageMaxScore =
		results.length > 0
			? results.reduce((total, result) => result.maxScore + total, 0) /
				results.length
			: 0;
	const byId = new Map<string, PromptBehaviorEvalCase>(
		corpus.map((item) => [item.id, item]),
	);
	const resultLines = results.map((result) => {
		return `- ${result.id}: ${result.score}/${result.maxScore} (${result.passed ? "quality-pass" : "quality-fail"}); expectation=${result.expectationSatisfied ? "satisfied" : "unexpected"}${result.actualFailures.length > 0 ? `; failed=${result.actualFailures.join(",")}` : ""}`;
	});
	const markdownRows = results.map((result) => {
		const item = byId.get(result.id);
		const failures = result.actualFailures.join(", ");
		return `| ${result.id} | ${item?.origin ?? "calibration"} | ${result.score}/${result.maxScore} | ${result.passed ? "quality-pass" : "quality-fail"} | ${result.expectationSatisfied ? "satisfied" : "unexpected"} | ${failures || "—"} |`;
	});
	const failureSections = results
		.filter((result) => result.criteria.some((criterion) => !criterion.passed))
		.map((result) => {
			const failedCriteria = result.criteria.filter(
				(criterion) => !criterion.passed,
			);
			return [
				`### ${result.id}`,
				`- Title: ${result.title}`,
				...failedCriteria.map(
					(criterion) => `- ${criterion.criterion}: ${criterion.summary}`,
				),
			].join("\n");
		});
	const report = [
		`Prompt behavior eval corpus: ${results.length} cases`,
		`Quality-threshold pass: ${passingCases}`,
		`Quality-threshold fail: ${failingCases}`,
		`Expectation checks satisfied: ${expectationSatisfiedCases}`,
		`Unexpected eval outcomes: ${unexpectedCases}`,
		`Average rubric score: ${averageScore.toFixed(2)} / ${averageMaxScore.toFixed(2)}`,
		...resultLines,
	].join("\n");
	const markdownReport = [
		"# Prompt behavior eval summary",
		"",
		`- Total cases: ${results.length}`,
		`- Quality-threshold pass: ${passingCases}`,
		`- Quality-threshold fail: ${failingCases}`,
		`- Expectation checks satisfied: ${expectationSatisfiedCases}`,
		`- Unexpected eval outcomes: ${unexpectedCases}`,
		`- Average rubric score: ${averageScore.toFixed(2)} / ${averageMaxScore.toFixed(2)}`,
		"",
		"| Case | Origin | Score | Quality | Expectation | Failed criteria |",
		"| --- | --- | ---: | --- | --- | --- |",
		...markdownRows,
		"",
		"## Failed criteria details",
		"",
		...(failureSections.length > 0
			? failureSections
			: ["All behavior eval criteria passed."]),
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
