import { canonicalSha256 } from "./canonical-json.js";

export type ReviewerTruth = "defect" | "clean";

export type HumanLabel = {
	readonly raterId: string;
	readonly truth: ReviewerTruth;
};

export type ReviewerCase = {
	readonly caseId: string;
	readonly caseVersion: 1;
	readonly truth: ReviewerTruth;
	readonly files: Readonly<Record<string, string>>;
	readonly humanLabels: readonly [HumanLabel, HumanLabel];
	readonly truthSha256: string;
};

const DEFECT_LABELS: readonly [HumanLabel, HumanLabel] = [
	Object.freeze({ raterId: "labeler-a", truth: "defect" }),
	Object.freeze({ raterId: "labeler-b", truth: "defect" }),
];
const CLEAN_LABELS: readonly [HumanLabel, HumanLabel] = [
	Object.freeze({ raterId: "labeler-a", truth: "clean" }),
	Object.freeze({ raterId: "labeler-b", truth: "clean" }),
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

/** Opaque fixed-label cases; truth and fixture purpose never enter the prompt or path. */
export const REVIEWER_CASES: readonly ReviewerCase[] = [
	Object.freeze({
		caseId: "review-case-a1",
		caseVersion: 1,
		truth: "defect",
		files: DEFECT_FILES,
		humanLabels: DEFECT_LABELS,
		truthSha256: canonicalSha256("flow-reviewer-case-truth-v1", DEFECT_FILES),
	}),
	Object.freeze({
		caseId: "review-case-b7",
		caseVersion: 1,
		truth: "clean",
		files: CLEAN_FILES,
		humanLabels: CLEAN_LABELS,
		truthSha256: canonicalSha256("flow-reviewer-case-truth-v1", CLEAN_FILES),
	}),
];

export function assertReviewerCaseTruth(input: {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly files: Readonly<Record<string, string>>;
}): ReviewerTruth {
	const fixture = REVIEWER_CASES.find(
		(candidate) =>
			candidate.caseId === input.caseId &&
			candidate.caseVersion === input.caseVersion,
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
