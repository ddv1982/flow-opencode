import type { ReviewFinding } from "../src/domain/session.js";
import { canonicalSha256 } from "./canonical-json.js";

export type ReviewerTruth = "defect" | "clean";

export type SyntheticReviewerLabel = {
	readonly labelSource: "synthetic";
	readonly raterId: string;
	readonly truth: ReviewerTruth;
};

export type ReviewerDefect = {
	readonly defectId: string;
	readonly path: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly description: string;
};

export type ReviewerAssessment = {
	readonly schemaVersion: 1;
	readonly matchedDefectIds: readonly string[];
	readonly falseFindingIds: readonly string[];
	readonly unassessedFindingIds: readonly string[];
	readonly labelSource: "synthetic" | "human";
};

export type ReviewerFindingDetail = ReviewFinding & {
	readonly findingId: string;
};

export type ReviewerCase = {
	readonly caseId: string;
	readonly caseVersion: 2;
	readonly truth: ReviewerTruth;
	readonly files: Readonly<Record<string, string>>;
	readonly syntheticLabels: readonly [
		SyntheticReviewerLabel,
		SyntheticReviewerLabel,
	];
	readonly defects: readonly ReviewerDefect[];
	readonly truthSha256: string;
};

const DEFECT_LABELS: readonly [SyntheticReviewerLabel, SyntheticReviewerLabel] =
	[
		Object.freeze({
			labelSource: "synthetic",
			raterId: "synthetic-a",
			truth: "defect",
		}),
		Object.freeze({
			labelSource: "synthetic",
			raterId: "synthetic-b",
			truth: "defect",
		}),
	];
const CLEAN_LABELS: readonly [SyntheticReviewerLabel, SyntheticReviewerLabel] =
	[
		Object.freeze({
			labelSource: "synthetic",
			raterId: "synthetic-a",
			truth: "clean",
		}),
		Object.freeze({
			labelSource: "synthetic",
			raterId: "synthetic-b",
			truth: "clean",
		}),
	];

const TEST_FILE =
	'import { expect, test } from "bun:test";\nimport { value } from "./value";\n\nconst examples = [Number.MIN_SAFE_INTEGER, -5, 0, 2, 100, Number.MAX_SAFE_INTEGER - 1];\n\ntest("value returns the next safe integer", () => {\n\tfor (const input of examples) expect(value(input)).toBe(input + 1);\n});\n';
const DEFECT_FILES = Object.freeze({
	"src/value.ts":
		"export function value(input: number): number {\n\treturn input === 7 ? input - 1 : input + 1;\n}\n",
	"src/value.test.ts": TEST_FILE,
});
const CLEAN_FILES = Object.freeze({
	"src/value.ts":
		"export function value(input: number): number {\n\treturn input + 1;\n}\n",
	"src/value.test.ts": TEST_FILE,
});

export const REVIEWER_CASES: readonly ReviewerCase[] = Object.freeze([
	Object.freeze({
		caseId: "review-case-a1",
		caseVersion: 2,
		truth: "defect",
		files: DEFECT_FILES,
		syntheticLabels: Object.freeze(DEFECT_LABELS),
		defects: Object.freeze([
			Object.freeze({
				defectId: "value-seven-decrements",
				path: "src/value.ts",
				startLine: 2,
				endLine: 2,
				description: "value(7) returns 6 instead of the required 8.",
			}),
		]),
		truthSha256: canonicalSha256("flow-reviewer-case-truth-v1", DEFECT_FILES),
	}),
	Object.freeze({
		caseId: "review-case-b7",
		caseVersion: 2,
		truth: "clean",
		files: CLEAN_FILES,
		syntheticLabels: Object.freeze(CLEAN_LABELS),
		defects: Object.freeze([]),
		truthSha256: canonicalSha256("flow-reviewer-case-truth-v1", CLEAN_FILES),
	}),
]);

function matchesPlantedDefect(finding: ReviewerFindingDetail): boolean {
	if (
		!finding.evidence ||
		!/\bsrc\/value\.ts\b(?![\w./-])/.test(finding.evidence)
	)
		return false;
	const text = `${finding.summary}\n${finding.evidence}`;
	const identifiesInput =
		/\bvalue\s*\(\s*7\s*\)|\binput\s*(?:(?:===?|is|of|equals?)\s*)?7\b(?!\.\d)/i.test(
			text,
		);
	const actualResult =
		/\b(?:returns?|produces?|yields?|actual(?:\s+(?:result|output))?(?:\s+is)?)\s*[:=]?\s*6\b(?!\.\d)|\bvalue\s*\(\s*7\s*\)\s*(?:===?|=>|->)\s*6\b(?!\.\d)/i.test(
			text,
		);
	const expectedResult =
		/\b(?:expected?|expects?|should(?:\s+(?:return|be|produce))?|must(?:\s+(?:return|be))?|instead\s+of|rather\s+than)\s*[:=]?\s*(?:(?:the\s+)?(?:required|correct|expected)\s+)?8\b(?!\.\d)/i.test(
			text,
		);
	const deniedOrUncertain =
		/\b(?:no|not|never|cannot|can['’]t|won['’]t|(?:does|do|did|is|are|was|were|could|would|should|must)n['’]t|may|might|could|maybe|perhaps|possibly|unclear|uncertain|whether)\b[^.!?;\n]*(?:\b(?:returns?|produces?|yields?|actual(?:\s+(?:result|output))?(?:\s+is)?)\s*[:=]?\s*6\b|\b(?:wrong|incorrect|decrements?|subtracts?|violates?|bug|defect)\b)/i.test(
			text,
		) || finding.summary.includes("?");
	const contradictsActualResult =
		/\bvalue\s*\(\s*7\s*\)\s*(?:returns?|produces?|yields?|===?|=>|->)\s*8\b(?!\.\d)|\bactual(?:\s+(?:result|output))?(?:\s+is)?\s*[:=]?\s*8\b(?!\.\d)/i.test(
			text,
		);
	const identifiesWrongBranch =
		/\binput\s*={2,3}\s*7\s*\?\s*input\s*-\s*1\b(?!\.\d)/.test(
			finding.evidence,
		) &&
		/\b(?:decrements?|subtracts?|wrong|incorrect|violates?)\b/i.test(
			finding.summary,
		);
	return (
		((identifiesInput && actualResult && expectedResult) ||
			identifiesWrongBranch) &&
		!deniedOrUncertain &&
		!contradictsActualResult
	);
}

export function assessReviewerFindings(
	entry: ReviewerCase,
	findings: readonly ReviewerFindingDetail[],
): ReviewerAssessment {
	const matchedDefectIds = new Set<string>();
	const falseFindingIds: string[] = [];
	const unassessedFindingIds: string[] = [];
	for (const finding of findings) {
		const matches = entry.defects.filter(
			(defect) =>
				defect.defectId === "value-seven-decrements" &&
				matchesPlantedDefect(finding),
		);
		if (matches.length === 0) {
			if (entry.truth === "clean") falseFindingIds.push(finding.findingId);
			else unassessedFindingIds.push(finding.findingId);
		}
		for (const defect of matches) matchedDefectIds.add(defect.defectId);
	}
	return {
		schemaVersion: 1,
		matchedDefectIds: [...matchedDefectIds],
		falseFindingIds,
		unassessedFindingIds,
		labelSource: "synthetic",
	};
}

export function reviewerAssessmentPassed(
	truth: ReviewerTruth,
	verdict: "passed" | "failed" | null,
	assessment: ReviewerAssessment,
): boolean {
	return (
		assessment.falseFindingIds.length === 0 &&
		assessment.unassessedFindingIds.length === 0 &&
		(truth === "defect"
			? verdict === "failed" && assessment.matchedDefectIds.length > 0
			: verdict === "passed" && assessment.matchedDefectIds.length === 0)
	);
}

export function assertReviewerCaseTruth(input: {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly files: Readonly<Record<string, string>>;
}): ReviewerTruth {
	const fixture = REVIEWER_CASES.find(
		(candidate) =>
			candidate.caseId === input.caseId &&
			(candidate.caseVersion === input.caseVersion || input.caseVersion === 1),
	);
	if (!fixture) {
		throw new Error(
			"Reviewer fixture drifted from its fixed executable truth.",
		);
	}
	if (
		canonicalSha256("flow-reviewer-case-truth-v1", input.files) !==
		fixture.truthSha256
	)
		throw new Error(
			"Reviewer fixture drifted from its fixed executable truth.",
		);
	return fixture.truth;
}
