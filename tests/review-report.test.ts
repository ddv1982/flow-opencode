import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { retainedFailureEvidence } from "../evals/grader-input.js";
import { reviewEvidenceReport } from "../evals/review-report.js";

function fixture(reviews: unknown[] = [], sessionPresent = true) {
	const evidence = retainedFailureEvidence({
		attempt: {
			attemptId: "attempt",
			cellId: "cell",
			caseId: "case",
			repetition: 1,
			model: {
				routeProvider: "test",
				gateway: null,
				family: "test",
				model: "test",
				revision: null,
			},
		},
		durationMs: 0,
		gradeInput: {
			schemaVersion: 1,
			allCalls: [],
			flowCalls: [],
			archives: [],
			finalText: "",
			providerErrors: [],
			session: sessionPresent ? { runs: [{ reviews }] } : null,
		},
	});
	const bytes = Buffer.from(JSON.stringify(evidence));
	const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	return {
		evidence,
		bytes,
		record: {
			...evidence.attempt,
			transcript: { artifact: "transcripts/attempt.json", sha256 },
		},
	};
}
const finding = {
	findingId: "f1",
	severity: "blocking",
	summary: "Missing inventory",
	evidence: "No baseline inventory in packet",
};
const failed = {
	id: "first",
	result: {
		verdict: "failed",
		terminalDisposition: "submitted",
		findings: [finding],
	},
};
const passed = {
	id: "retry",
	result: { verdict: "passed", terminalDisposition: "submitted", findings: [] },
};

test("counts retries separately without interpreting finding prose", async () => {
	const f = fixture([failed, passed, { id: "pending", result: null }]);
	const result = await reviewEvidenceReport([f.record], async () => f.bytes);
	expect(result.totals).toEqual({
		attempts: 1,
		reviewObserved: 1,
		noReviewObserved: 0,
		unassessed: 0,
		passed: 1,
		failed: 1,
		pending: 1,
		codeDefects: 0,
		evidenceGaps: 0,
		unclassifiedFindings: 1,
	});
});

test("separates missing session/transcript evidence from observed absence", async () => {
	const empty = fixture();
	expect(
		(await reviewEvidenceReport([empty.record], async () => empty.bytes)).totals
			.noReviewObserved,
	).toBe(1);
	expect(
		(await reviewEvidenceReport([empty.record], async () => null)).totals
			.unassessed,
	).toBe(1);
	const absent = fixture([], false);
	expect(
		(await reviewEvidenceReport([absent.record], async () => absent.bytes))
			.totals.unassessed,
	).toBe(1);
});

test("rejects changed bytes and mismatched attempt bindings", async () => {
	const f = fixture();
	await expect(
		reviewEvidenceReport([f.record], async () => Buffer.from("{}")),
	).rejects.toThrow("digest mismatch");
	await expect(
		reviewEvidenceReport(
			[{ ...f.record, attemptId: "other" }],
			async () => f.bytes,
		),
	).rejects.toThrow("binding mismatch");
});

test("requires unique evidence-bound assessments and retains attribution", async () => {
	const f = fixture([failed, passed]);
	const label = {
		attemptId: "attempt",
		transcriptSha256: f.record.transcript.sha256,
		assignmentId: "first",
		findingId: "f1",
		category: "evidence-gap",
		assessor: "test analyst",
		rationale: "Packet lacked required metadata",
	};
	const result = await reviewEvidenceReport([f.record], async () => f.bytes, [
		label,
	]);
	expect(result.totals.evidenceGaps).toBe(1);
	expect(JSON.stringify(result)).toContain("test analyst");
	await expect(
		reviewEvidenceReport([f.record], async () => f.bytes, [label, label]),
	).rejects.toThrow("Duplicate");
	await expect(
		reviewEvidenceReport([f.record], async () => f.bytes, [
			{ ...label, transcriptSha256: `sha256:${"0".repeat(64)}` },
		]),
	).rejects.toThrow("Stale");
	await expect(
		reviewEvidenceReport([f.record], async () => f.bytes, [
			{ ...label, findingId: "absent" },
		]),
	).rejects.toThrow("does not match");
	const defect = await reviewEvidenceReport([f.record], async () => f.bytes, [
		{ ...label, category: "code-defect" },
	]);
	expect(defect.totals.codeDefects).toBe(1);
});

test("does not count malformed or duplicated review records as clean evidence", async () => {
	const invalid = fixture([{ id: "missing-result" }]);
	expect(
		(await reviewEvidenceReport([invalid.record], async () => invalid.bytes))
			.totals.unassessed,
	).toBe(1);
	const duplicate = fixture([passed, passed]);
	await expect(
		reviewEvidenceReport([duplicate.record], async () => duplicate.bytes),
	).rejects.toThrow("Duplicate review");
});

test("rejects repeated attempts and repeated finding identities", async () => {
	const f = fixture([failed]);
	await expect(
		reviewEvidenceReport([f.record, f.record], async () => f.bytes),
	).rejects.toThrow("Duplicate attempt");
	const duplicated = fixture([
		{ ...failed, result: { ...failed.result, findings: [finding, finding] } },
	]);
	await expect(
		reviewEvidenceReport([duplicated.record], async () => duplicated.bytes),
	).rejects.toThrow("Duplicate finding");
});

test("counts advisories without evidence but keeps unsupported blockers unassessed", async () => {
	const advisory = {
		findingId: "advisory",
		severity: "advisory",
		summary: "Consider documenting the default",
	};
	const f = fixture([
		{ ...passed, result: { ...passed.result, findings: [advisory] } },
	]);
	const result = await reviewEvidenceReport([f.record], async () => f.bytes);
	expect(result.totals).toMatchObject({
		reviewObserved: 1,
		passed: 1,
		unclassifiedFindings: 1,
		unassessed: 0,
	});
	const observation = result.attempts[0];
	expect(
		observation && "reviews" in observation
			? observation.reviews?.[0]?.findings[0]
			: null,
	).toMatchObject(advisory);
	for (const evidence of [undefined, "   "]) {
		const blocked = fixture([
			{
				...failed,
				result: {
					...failed.result,
					findings: [{ ...advisory, severity: "blocking", evidence }],
				},
			},
		]);
		expect(
			(await reviewEvidenceReport([blocked.record], async () => blocked.bytes))
				.totals,
		).toMatchObject({ unassessed: 1, reviewObserved: 0, failed: 0 });
	}
});
