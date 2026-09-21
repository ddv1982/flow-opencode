import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildReviewedCorpus,
	importSnapshot,
	reviewSnapshot,
	runDatasetCommand,
} from "../evals/recovery-decisions/dataset.js";
import development from "../evals/recovery-decisions/development.json" with {
	type: "json",
};
import { prepareRecoveryEvaluation } from "../evals/recovery-decisions/run.js";
import {
	CorpusSchema,
	DevelopmentCorpusSchema,
	datasetDigest,
	snapshotPayload,
} from "../evals/recovery-decisions/schema.js";

function fixture(index = 0) {
	const row = DevelopmentCorpusSchema.parse(development).cases[index];
	if (!row) throw new Error("Missing test fixture");
	const snapshot = {
		id: row.id,
		session: row.session,
		proposal: row.proposal,
		sourceDigest: row.sourceDigest,
		provenance: {
			origin: "observed-recovery",
			sourceReference: "test-only-source",
			originatingTaskId: "test-only-task",
			independenceGroupId: "test-only-group",
			scenarioFamily: "test-only-family",
			capturedAt: "2026-09-21T12:00:00Z",
			importedBy: "test-importer",
			sanitization: {
				reviewedBy: "test-sanitizer",
				reviewedAt: "2026-09-21T12:00:00Z",
				notes: "Synthetic test fixture only",
				payloadDigest: datasetDigest(snapshotPayload(row)),
			},
		},
	};
	const draft = importSnapshot(snapshot);
	const labels = {
		snapshotDigest: datasetDigest(draft.snapshot),
		authoredBy: "test-author",
		rationale: row.rationale,
		expected: row.expected,
		split: "calibration",
		primary: true,
	};
	const review = {
		reviewedBy: "test-reviewer",
		reviewedAt: "2026-09-21T13:00:00Z",
		labelDigest: datasetDigest(labels),
		verdict: "approved",
		notes: "Test attestation only",
	};
	return { draft, labels, review };
}

function reviewed(index = 0) {
	const { draft, labels, review } = fixture(index);
	return reviewSnapshot(draft, { labels, review });
}

test("import remains unreviewed and rejects secrets, invalid bindings and stale sanitization", () => {
	const { draft } = fixture();
	expect(draft.status).toBe("awaiting-label-review");
	expect(CorpusSchema.safeParse(draft).success).toBe(false);
	const changed = structuredClone(draft.snapshot);
	changed.session = { ...changed.session, goal: "changed" };
	expect(() => importSnapshot(changed)).toThrow();
	expect(() =>
		importSnapshot({ ...draft.snapshot, api_key: "credential" }),
	).toThrow("Sensitive");
});

test("review must be independent and bound to exact snapshot and labels", () => {
	const { draft, labels, review } = fixture();
	for (const reviewedBy of [
		labels.authoredBy,
		draft.snapshot.provenance.importedBy,
	])
		expect(() =>
			reviewSnapshot(draft, { labels, review: { ...review, reviewedBy } }),
		).toThrow();
	expect(() => reviewSnapshot(draft, { labels, review: undefined })).toThrow();
	expect(() =>
		reviewSnapshot(draft, {
			labels: { ...labels, rationale: "changed" },
			review,
		}),
	).toThrow();
	const changed = structuredClone(draft);
	changed.snapshot.provenance.scenarioFamily = "changed";
	expect(() => reviewSnapshot(changed, { labels, review })).toThrow();
});

test("reviewed labels reject empty, duplicate and unknown choices, and support required abstention", async () => {
	const { draft, labels, review } = fixture();
	for (const acceptableSelections of [
		[],
		["unknown"],
		["abstain", "abstain"],
	]) {
		const altered = {
			...labels,
			expected: { ...labels.expected, acceptableSelections },
		};
		expect(() =>
			reviewSnapshot(draft, {
				labels: altered,
				review: { ...review, labelDigest: datasetDigest(altered) },
			}),
		).toThrow();
	}
	const abstain = {
		...labels,
		expected: { ...labels.expected, acceptableSelections: ["abstain"] },
	};
	const row = reviewSnapshot(draft, {
		labels: abstain,
		review: { ...review, labelDigest: datasetDigest(abstain) },
	});
	expect(
		(await buildReviewedCorpus([row])).cases[0]?.expected.acceptableSelections,
	).toEqual(["abstain"]);
});

test("corpus refuses duplicates and related split contamination", async () => {
	const row = reviewed();
	await expect(buildReviewedCorpus([row, row])).rejects.toThrow();
	const { draft, labels, review } = fixture(1);
	const holdout = { ...labels, split: "holdout" };
	const second = reviewSnapshot(draft, {
		labels: holdout,
		review: { ...review, labelDigest: datasetDigest(holdout) },
	});
	await expect(buildReviewedCorpus([row, second])).rejects.toThrow(
		"cross evaluation splits",
	);
	const nonPrimary = { ...labels, primary: false };
	const related = reviewSnapshot(draft, {
		labels: nonPrimary,
		review: { ...review, labelDigest: datasetDigest(nonPrimary) },
	});
	expect((await buildReviewedCorpus([row, related])).cases).toHaveLength(2);
	await expect(buildReviewedCorpus([related])).rejects.toThrow("one primary");
});

test("build checks actual deterministic eligibility before persisting corpus", async () => {
	const { draft, labels, review } = fixture();
	const altered = {
		...labels,
		expected: { eligibleCandidateIds: [], acceptableSelections: ["abstain"] },
	};
	const row = reviewSnapshot(draft, {
		labels: altered,
		review: { ...review, labelDigest: datasetDigest(altered) },
	});
	await expect(buildReviewedCorpus([row])).rejects.toThrow(
		"deterministic eligibility",
	);
});

test("dataset CLI round trip writes immutable files consumable by prepare", async () => {
	const directory = await mkdtemp(join(tmpdir(), "recovery-dataset-"));
	try {
		const { draft, labels, review } = fixture();
		const path = (name: string) => join(directory, name);
		await Bun.write(path("snapshot.json"), JSON.stringify(draft.snapshot));
		await Bun.write(
			path("submission.json"),
			JSON.stringify({ labels, review }),
		);
		expect(
			await runDatasetCommand([
				"dataset-import",
				path("snapshot.json"),
				path("draft.json"),
			]),
		).toBe(0);
		expect(
			await runDatasetCommand([
				"dataset-review",
				path("draft.json"),
				path("submission.json"),
				path("case.json"),
			]),
		).toBe(0);
		const row = JSON.parse(await readFile(path("case.json"), "utf8"));
		await Bun.write(path("cases.json"), JSON.stringify([row]));
		expect(
			await runDatasetCommand([
				"dataset-build",
				path("cases.json"),
				path("corpus.json"),
			]),
		).toBe(0);
		await expect(
			runDatasetCommand([
				"dataset-build",
				path("cases.json"),
				path("corpus.json"),
			]),
		).rejects.toThrow();
		expect(
			await prepareRecoveryEvaluation([
				"prepare",
				path("corpus.json"),
				path("report.json"),
			]),
		).toBe(0);
		const report = JSON.parse(await readFile(path("report.json"), "utf8"));
		expect(report.labelStatus).toBe("independently-reviewed");
		expect(report.qualification).toBe("inconclusive");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("dataset digests do not depend on JSON key order", () => {
	expect(datasetDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(
		datasetDigest({ b: { d: 3, c: 2 }, a: 1 }),
	);
});

test("family-only overlap, forged independence groups and duplicate payload aliases are rejected", async () => {
	const first = reviewed();
	const f = fixture(1);
	const draft = structuredClone(f.draft);
	draft.snapshot.session = {
		...draft.snapshot.session,
		id: "different-session",
	};
	draft.snapshot.proposal.sessionId = "different-session";
	Object.assign(draft.snapshot.provenance, {
		sourceReference: "different-source",
		originatingTaskId: "different-task",
		independenceGroupId: "different-group",
	});
	draft.snapshot.provenance.sanitization.payloadDigest = datasetDigest(
		snapshotPayload(draft.snapshot),
	);
	const labels = {
		...f.labels,
		snapshotDigest: datasetDigest(draft.snapshot),
		split: "holdout",
	};
	const second = reviewSnapshot(draft, {
		labels,
		review: { ...f.review, labelDigest: datasetDigest(labels) },
	});
	await expect(buildReviewedCorpus([first, second])).rejects.toThrow(
		"cross evaluation splits",
	);
	draft.snapshot.provenance.scenarioFamily = "different-family";
	labels.snapshotDigest = datasetDigest(draft.snapshot);
	const independent = reviewSnapshot(draft, {
		labels,
		review: { ...f.review, labelDigest: datasetDigest(labels) },
	});
	expect((await buildReviewedCorpus([first, independent])).cases).toHaveLength(
		2,
	);
	const forged = fixture(1);
	forged.draft.snapshot.provenance.independenceGroupId = "invented-group";
	forged.labels.snapshotDigest = datasetDigest(forged.draft.snapshot);
	const inflated = reviewSnapshot(forged.draft, {
		labels: forged.labels,
		review: { ...forged.review, labelDigest: datasetDigest(forged.labels) },
	});
	await expect(buildReviewedCorpus([first, inflated])).rejects.toThrow(
		"share an independence group",
	);
	const alias = fixture();
	alias.draft.snapshot.id = "alias";
	alias.labels.snapshotDigest = datasetDigest(alias.draft.snapshot);
	const duplicate = reviewSnapshot(alias.draft, {
		labels: alias.labels,
		review: { ...alias.review, labelDigest: datasetDigest(alias.labels) },
	});
	await expect(buildReviewedCorpus([first, duplicate])).rejects.toThrow(
		"Duplicate case or snapshot",
	);
});
