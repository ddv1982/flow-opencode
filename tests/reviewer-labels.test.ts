import { describe, expect, test } from "bun:test";
import { REVIEWER_CASES } from "../evals/reviewer-cases.js";
import {
	parseReviewerLabelImport,
	reviewerLabelImportSha256,
} from "../evals/reviewer-labels.js";

function labelFixture() {
	return {
		schemaVersion: 1,
		labelSource: "human",
		collectionId: "parser-test-record",
		recordedAt: "2026-09-13T00:00:00.000Z",
		cases: REVIEWER_CASES.map((entry) => ({
			caseId: entry.caseId,
			caseVersion: entry.caseVersion,
			truthSha256: entry.truthSha256,
			labels: ["person-a", "person-b"].map((raterId) => ({
				raterId,
				truth: entry.truth,
				defectIds: entry.defects.map((defect) => defect.defectId),
				rationale: "Format test only; no real human collection is claimed.",
				independent: true,
				blindedToReviewer: true,
			})),
			adjudication: null,
		})),
	};
}

describe("independent reviewer label imports", () => {
	test("parses explicit human provenance and freezes every imported judgment", () => {
		const parsed = parseReviewerLabelImport(labelFixture());
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		expect(parsed.value.labelSource).toBe("human");
		expect(Object.isFrozen(parsed.value)).toBe(true);
		expect(Object.isFrozen(parsed.value.cases[0]?.labels[0])).toBe(true);
	});

	test("rejects unknown fields, unsupported versions, missing provenance and synthetic imports", () => {
		const base = labelFixture();
		for (const input of [
			{ ...base, schemaVersion: 2 },
			{ ...base, labelSource: "synthetic" },
			{ ...base, labelSource: undefined },
			{ ...base, trusted: true },
			{ ...base, recordedAt: "yesterday" },
			base.cases.flatMap((entry) => entry.labels),
		])
			expect(parseReviewerLabelImport(input).ok).toBe(false);
	});

	test("requires distinct raters and explicit independent, blinded labels", () => {
		const base = labelFixture();
		const entry = base.cases[0];
		const label = entry?.labels[0];
		if (!entry || !label) throw new Error("Expected defect label fixture.");
		for (const labels of [
			[label],
			[label, label],
			entry.labels.map((value) => ({ ...value, independent: false })),
			entry.labels.map((value) => ({ ...value, blindedToReviewer: false })),
			entry.labels.map((value) => ({ ...value, independent: undefined })),
			entry.labels.map((value) => ({
				...value,
				raterId: `synthetic-${value.raterId}`,
			})),
			entry.labels.map((value) => ({ ...value, undisclosedField: true })),
		])
			expect(
				parseReviewerLabelImport({ ...base, cases: [{ ...entry, labels }] }).ok,
			).toBe(false);
	});

	test("binds every imported case to its frozen version, digest and defect IDs", () => {
		const base = labelFixture();
		const entry = base.cases[0];
		if (!entry) throw new Error("Expected defect label fixture.");
		for (const changed of [
			{ ...entry, caseId: "unregistered" },
			{ ...entry, caseVersion: 1 },
			{ ...entry, truthSha256: `sha256:${"a".repeat(64)}` },
			{
				...entry,
				labels: entry.labels.map((label) => ({
					...label,
					defectIds: ["unrelated"],
				})),
			},
			{
				...entry,
				labels: entry.labels.map((label) => ({ ...label, defectIds: [] })),
			},
			{
				...entry,
				labels: entry.labels.map((label) => ({
					...label,
					defectIds: ["value-seven-decrements", "value-seven-decrements"],
				})),
			},
		])
			expect(parseReviewerLabelImport({ ...base, cases: [changed] }).ok).toBe(
				false,
			);
		expect(
			parseReviewerLabelImport({ ...base, cases: [entry, entry] }).ok,
		).toBe(false);
	});

	test("retains disagreement and requires a separate adjudicator to resolve it", () => {
		const base = labelFixture();
		const entry = base.cases[0];
		if (!entry) throw new Error("Expected defect label fixture.");
		const labels = entry.labels.map((label, index) =>
			index === 0 ? { ...label, truth: "clean", defectIds: [] } : label,
		);
		const adjudication = {
			raterId: "person-c",
			truth: "defect",
			defectIds: ["value-seven-decrements"],
			rationale: "Format test adjudication confirms the input-seven defect.",
			independent: true,
			blindedToReviewer: true,
		};
		expect(
			parseReviewerLabelImport({ ...base, cases: [{ ...entry, labels }] }).ok,
		).toBe(false);
		expect(
			parseReviewerLabelImport({
				...base,
				cases: [
					{
						...entry,
						labels,
						adjudication: { ...adjudication, raterId: "person-a" },
					},
				],
			}).ok,
		).toBe(false);
		expect(
			parseReviewerLabelImport({
				...base,
				cases: [
					{
						...entry,
						labels,
						adjudication: { ...adjudication, truth: "clean", defectIds: [] },
					},
				],
			}).ok,
		).toBe(false);
		const parsed = parseReviewerLabelImport({
			...base,
			cases: [{ ...entry, labels, adjudication }],
		});
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		expect(parsed.value.cases[0]?.labels[0]?.truth).toBe("clean");
		expect(parsed.value.cases[0]?.adjudication?.truth).toBe("defect");
	});

	test("hashes provenance and judgments while ignoring record ordering", () => {
		const base = labelFixture();
		const original = parseReviewerLabelImport(base);
		const reordered = parseReviewerLabelImport({
			...base,
			cases: [...base.cases]
				.reverse()
				.map((entry) => ({ ...entry, labels: [...entry.labels].reverse() })),
		});
		const changed = parseReviewerLabelImport({
			...base,
			collectionId: "different-collection",
		});
		if (!original.ok || !reordered.ok || !changed.ok)
			throw new Error("Expected valid label imports.");
		expect(reviewerLabelImportSha256(original.value)).toBe(
			reviewerLabelImportSha256(reordered.value),
		);
		expect(reviewerLabelImportSha256(original.value)).not.toBe(
			reviewerLabelImportSha256(changed.value),
		);
	});
});
