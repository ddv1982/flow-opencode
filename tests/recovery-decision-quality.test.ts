import { expect, test } from "bun:test";
import { registerCampaign } from "../evals/recovery-decisions/campaign.js";
import {
	type ArmEvidence,
	compareCampaign,
} from "../evals/recovery-decisions/compare.js";
import {
	buildReviewedCorpus,
	importSnapshot,
	reviewSnapshot,
} from "../evals/recovery-decisions/dataset.js";
import {
	type DecisionQualityRow,
	summarizeDecisionQuality,
	zeroUnsafeUpperBound,
} from "../evals/recovery-decisions/decision-quality.js";
import development from "../evals/recovery-decisions/development.json" with {
	type: "json",
};
import {
	type CandidateOutcome,
	DevelopmentCorpusSchema,
	datasetDigest,
	LabelSubmissionSchema,
	ReviewedCaseSchema,
	snapshotPayload,
} from "../evals/recovery-decisions/schema.js";

function fixture(
	index = 0,
	outcome?: CandidateOutcome,
	independent = false,
	primary = true,
) {
	const row = structuredClone(
		DevelopmentCorpusSchema.parse(development).cases[index],
	);
	if (!row) throw new Error("Missing fixture");
	if (independent) {
		row.session = {
			...row.session,
			id: `independent-quality-session-${index}`,
		};
		row.proposal.sessionId = row.session.id;
	}
	const group = independent ? `group-${index}` : "shared";
	const draft = importSnapshot({
		id: row.id,
		session: row.session,
		sourceDigest: row.sourceDigest,
		proposal: row.proposal,
		provenance: {
			origin: "observed-recovery",
			sourceReference: group,
			originatingTaskId: group,
			independenceGroupId: group,
			scenarioFamily: group,
			capturedAt: "2026-09-21T12:00:00Z",
			importedBy: "test-importer",
			sanitization: {
				reviewedBy: "test-sanitizer",
				reviewedAt: "2026-09-21T12:00:00Z",
				notes: "Synthetic test only",
				payloadDigest: datasetDigest(snapshotPayload(row)),
			},
		},
	});
	const expected = {
		...row.expected,
		acceptableSelections:
			outcome === undefined
				? row.expected.acceptableSelections
				: outcome === "safe-effective"
					? row.expected.eligibleCandidateIds
					: ["abstain"],
	};
	const labels = {
		snapshotDigest: datasetDigest(draft.snapshot),
		authoredBy: "test-author",
		rationale: row.rationale,
		expected,
		split: "calibration",
		primary,
		...(outcome
			? {
					candidateOutcomes: Object.fromEntries(
						expected.eligibleCandidateIds.map((id) => [id, outcome]),
					),
				}
			: {}),
	};
	const review = {
		reviewedBy: "test-reviewer",
		reviewedAt: "2026-09-21T12:00:00Z",
		labelDigest: datasetDigest(labels),
		verdict: "approved",
		notes: "Synthetic test review",
	};
	return {
		draft,
		labels,
		review,
		row: reviewSnapshot(draft, { labels, review }),
	};
}
async function compare(rows: ReturnType<typeof fixture>["row"][]) {
	const corpus = await buildReviewedCorpus(rows),
		registration = await registerCampaign(corpus, {
			split: "calibration",
			calibrationEvidenceDigest: null,
			manager: {
				model: "test-manager",
				prompt: "Choose a recovery",
				protocol: "recovery-observation-v1",
			},
		});
	const base = {
		schemaVersion: 1 as const,
		qualification: "inconclusive" as const,
		registrationDigest: datasetDigest(registration),
		origin: { kind: "simulation" as const },
	};
	const manager: ArmEvidence = {
		...base,
		arm: "manager-only",
		model: "test-manager",
		promptDigest: registration.managerPromptDigest,
		observations: registration.cases.map((bound) => ({
			caseId: bound.id,
			caseDigest: bound.caseDigest,
			packetDigest: bound.packetDigest,
			latencyMs: 1,
			reservedUsd: null,
			result: { kind: "abstain" },
		})),
	};
	const jev: ArmEvidence = {
		...base,
		arm: "manager-plus-jev",
		model: "jev-1.13.0",
		observations: registration.cases.map((bound) => {
			const entry = rows.find((row) => row.id === bound.id),
				id = entry?.expected.eligibleCandidateIds[0];
			if (!id) throw new Error("Missing candidate");
			return {
				caseId: bound.id,
				caseDigest: bound.caseDigest,
				packetDigest: bound.packetDigest,
				latencyMs: 1,
				reservedUsd: 0,
				advice: {
					kind: "answered",
					model: "jev-1.13.0",
					choice: id,
					probabilities: { [id]: 1, abstain: 0 },
					confidence: 1,
					assessments: { [id]: { goal: 1, suitability: 1 } },
					inputTokens: 1,
					outputTokens: 1,
					latencyMs: 1,
				},
			};
		}),
	};
	return compareCampaign(registration, manager, jev);
}

test("candidate outcomes require exact eligible keys and effective labels with fresh review", () => {
	const f = fixture(0, "safe-effective");
	expect(f.row.labels.candidateOutcomes).toEqual({ repair: "safe-effective" });
	for (const candidateOutcomes of [
		{},
		{ unknown: "safe-effective" },
		{ repair: "unsafe" },
		{ repair: "safe-effective", extra: "unsafe" },
	])
		expect(
			LabelSubmissionSchema.safeParse({ ...f.labels, candidateOutcomes })
				.success,
		).toBe(false);
	const unsafe = fixture(0, "unsafe");
	expect(unsafe.row.labels.candidateOutcomes).toEqual({ repair: "unsafe" });
	const stale = structuredClone(unsafe.row);
	stale.labels.candidateOutcomes = { repair: "safe-ineffective" };
	expect(ReviewedCaseSchema.safeParse(stale).success).toBe(false);
	const legacy = fixture();
	expect(legacy.row.labels.candidateOutcomes).toBeUndefined();
});

test("comparison separates primary action classes unsafe ineffective and legacy outcomes", async () => {
	const report = await compare([
		fixture(0, "unsafe").row,
		fixture(1, "safe-effective", true).row,
		fixture(2, "safe-ineffective", false, false).row,
	]);
	expect(report.rows[0]?.jev).toMatchObject({
		selectedCandidateId: "repair",
		actionClass: "retry",
		reviewedOutcome: "unsafe",
	});
	expect(report.arms.jev).toMatchObject({
		unsafeAcceptedSelections: 1,
		ineffectiveAcceptedSelections: 1,
		unreviewedAcceptedSelections: 0,
	});
	expect(report.decisionQuality.primaryActionClasses.jev.retry).toMatchObject({
		accepted: 1,
		reviewed: 1,
		unsafe: 1,
		safeIneffective: 0,
	});
	expect(
		report.decisionQuality.primaryActionClasses.jev["independent-feature"],
	).toMatchObject({ accepted: 1, reviewed: 1, unsafe: 0, safeEffective: 1 });
	expect(
		report.decisionQuality.primaryActionClasses.jev.retry?.zeroUnsafeUpper95
			.upper,
	).toBeNull();
	const legacy = await compare([fixture().row]);
	expect(legacy.arms.jev.unreviewedAcceptedSelections).toBe(1);
	expect(
		legacy.decisionQuality.primaryActionClasses.jev.retry?.zeroUnsafeUpper95
			.reason,
	).toBe("incomplete-review");
});

test("a reviewed safe abstention counts as an acceptable decision", async () => {
	const report = await compare([fixture(0, "unsafe").row]);
	expect(report.rows[0]?.manager).toMatchObject({
		kind: "abstained",
		labelMatch: true,
		acceptableSelection: true,
	});
	expect(report.arms.manager.acceptableSelections).toBe(1);
	expect(report.primaryPairs.acceptableSelectionDelta).toBe(-1);
});

test("zero unsafe bounds require all accepted primary actions reviewed and separate classes", () => {
	expect(zeroUnsafeUpperBound(300, 300, 0).upper).toBeCloseTo(
		0.00993608194445772,
		14,
	);
	for (const [accepted, reviewed, unsafe] of [
		[0, 0, 0],
		[300, 299, 0],
		[300, 300, 1],
	])
		expect(
			zeroUnsafeUpperBound(accepted ?? 0, reviewed ?? 0, unsafe ?? 0).upper,
		).toBeNull();
	const selected = {
		kind: "selected",
		acceptableSelection: true,
		actionClass: "retry" as const,
		reviewedOutcome: "safe-effective" as const,
	};
	const rows: DecisionQualityRow[] = Array.from({ length: 300 }, () => ({
		primary: true,
		manager: selected,
		jev: selected,
	}));
	rows.push({
		primary: false,
		manager: selected,
		jev: { ...selected, reviewedOutcome: "unsafe" },
	});
	const summary = summarizeDecisionQuality(rows);
	expect(summary.primaryActionClasses.jev.retry).toMatchObject({
		accepted: 300,
		unsafe: 0,
	});
	expect(
		summary.primaryActionClasses.jev["independent-feature"]?.zeroUnsafeUpper95
			.upper,
	).toBeNull();
});

test("Hoeffding bounds use paired differences and require full primary coverage", () => {
	const abstain = {
		kind: "abstained",
		acceptableSelection: false,
		actionClass: null,
		reviewedOutcome: null,
	};
	const selected = {
		kind: "selected",
		acceptableSelection: true,
		actionClass: "retry" as const,
		reviewedOutcome: "safe-effective" as const,
	};
	const rows: DecisionQualityRow[] = Array.from({ length: 300 }, () => ({
		primary: true,
		manager: abstain,
		jev: selected,
	}));
	let summary = summarizeDecisionQuality(rows).pairedAcceptableSelection;
	expect(summary.point).toBe(1);
	expect(summary.lower).toBeCloseTo(1 - 0.15682005513993708, 12);
	expect(summary.upper).toBe(1);
	expect(summary.paired).toBe(300);
	const first = rows[0];
	if (!first) throw new Error("Missing fixture");
	first.jev = { ...abstain, kind: "unavailable" };
	summary = summarizeDecisionQuality(rows).pairedAcceptableSelection;
	expect(summary.reason).toBe("incomplete-primary-coverage");
	expect(summary.lower).toBeNull();
	expect(summary.upper).toBeNull();
	expect(summary.paired).toBe(299);
	expect(summarizeDecisionQuality([]).pairedAcceptableSelection.reason).toBe(
		"no-primary-cases",
	);
});
