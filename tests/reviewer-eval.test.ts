import { describe, expect, test } from "bun:test";
import { parseCaseCatalog } from "../evals/catalog.js";
import { campaignPlanSha256, parseReport } from "../evals/report.js";
import {
	analyzeReviewerCalibration,
	createReviewerPromotion,
	krippendorffNominalAlpha,
	ReviewerPromotionRecordSchema,
} from "../evals/reviewer-calibration.js";
import {
	assertReviewerCaseTruth,
	REVIEWER_CASES,
} from "../evals/reviewer-cases.js";
import { parseReviewerLabelImport } from "../evals/reviewer-labels.js";
import { reviewerOutcome } from "../evals/reviewer-run.js";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

function promotionFixture(
	unobserved = false,
	unsubmitted = false,
	assessmentSource: "synthetic" | "human" | "historical" = "synthetic",
) {
	const model = {
		routeProvider: "openai",
		gateway: null,
		family: "gpt",
		model: "reviewer",
		revision: null,
	};
	const artifact = {
		packageVersion: "1.0.0",
		sourceCommit: "commit",
		sourceTreeSha256: digest("a"),
		tarballSha256: digest("b"),
		unpackedManifestSha256: digest("c"),
	};
	const catalogInput = REVIEWER_CASES.map((fixture) => ({
		caseId: fixture.caseId,
		caseVersion: assessmentSource === "historical" ? 1 : fixture.caseVersion,
		evidenceClass: "reviewer-only" as const,
		oracle: "fixed-review-label" as const,
		release: "report-only" as const,
		minProviders: 1,
		minScoredAttempts: 1,
		minPassRate: null,
		reviewerPromotionRecordSha256: null,
	}));
	const catalog = parseCaseCatalog(catalogInput);
	if (!catalog.ok) throw new Error("Fixture catalog must parse.");
	const cells = REVIEWER_CASES.map((fixture, index) => ({
		cellId: `cell-${index}`,
		blockId: `block-${index}`,
		caseId: fixture.caseId,
		caseVersion: assessmentSource === "historical" ? 1 : fixture.caseVersion,
		armToken: null,
		repetition: index,
		managerModel: null,
		reviewerModel: model,
		schedule: "primary" as const,
	}));
	const plan = {
		schemaVersion: 1 as const,
		planId: "reviewer-calibration",
		planSha256: digest("d"),
		randomizationSeed: "seed",
		cells,
		abortPolicy: { retry: "never" as const, maxReplacementBlocks: 0 },
		stoppingRule: { kind: "fixed-attempts" as const, count: cells.length },
		analysis: {
			kind: "reviewer" as const,
			interval: "wilson" as const,
			alpha: 0.05 as const,
			versionSha256: digest("e"),
		},
		budget: {
			maxUsd: 10,
			unknownCostPolicy: "stop" as const,
			maxOutputTokens: 100,
			maxWallClockMs: 10_000,
			maxAttempts: cells.length,
		},
	};
	plan.planSha256 = campaignPlanSha256(plan);
	const attempts = cells.map((cell) => {
		const fixture = REVIEWER_CASES.find(
			(candidate) => candidate.caseId === cell.caseId,
		);
		if (!fixture) throw new Error("Expected registered reviewer fixture.");
		const defect = fixture.truth === "defect";
		const submitted = !unsubmitted || defect;
		return {
			schemaVersion: 2 as const,
			attemptId: `attempt-${cell.cellId}`,
			cellId: cell.cellId,
			blockId: cell.blockId,
			caseId: cell.caseId,
			caseVersion: cell.caseVersion,
			armToken: null,
			repetition: cell.repetition,
			artifact,
			evaluator: {
				sourceCommit: "evaluator",
				caseCatalogSha256: digest("f"),
				policyCatalogSha256: digest("0"),
				graderBundleSha256: digest("1"),
			},
			hostConfigSha256: digest("2"),
			actors: [
				{
					role: "reviewer" as const,
					requestedModel: model,
					actualModel: unobserved
						? { kind: "unobserved" as const, reason: "missing" }
						: { kind: "observed" as const, value: model },
					sessionIds: [`session-${cell.cellId}`],
				},
			],
			instructions: [
				{
					source: "command" as const,
					name: "review",
					sequence: 0,
					sha256: digest("3"),
					bytes: 1,
				},
			],
			transcript: { sha256: digest("4"), artifact: `${cell.cellId}.json` },
			outcome: {
				kind: "product" as const,
				passed: submitted,
				endedBy: "quiet" as const,
				issues: submitted ? [] : ["Reviewer did not submit."],
				evidence: {
					kind: "reviewer-only" as const,
					truth: defect ? ("defect" as const) : ("clean" as const),
					verdict: submitted
						? defect
							? ("failed" as const)
							: ("passed" as const)
						: null,
					findings: submitted && defect ? ["defect"] : [],
					submitted,
					...(assessmentSource === "historical"
						? {}
						: {
								findingDetails:
									submitted && defect
										? [
												{
													findingId: "finding-1",
													severity: "blocking" as const,
													summary: "Wrong result",
													evidence:
														"src/value.ts:2 value(7) returns 6, expected 8.",
												},
											]
										: [],
								assessment: {
									schemaVersion: 1 as const,
									matchedDefectIds:
										submitted && defect ? ["value-seven-decrements"] : [],
									falseFindingIds: [],
									unassessedFindingIds: [],
									labelSource: assessmentSource,
								},
							}),
				},
			},
			usage: { durationMs: 1, outputTokens: 1, costUsd: 0 },
		};
	});
	const parsed = parseReport(
		{
			schemaVersion: 2,
			reportId: "calibration",
			plan,
			attempts,
			completion: {
				status: "complete",
				cause: "fixed-target",
				startedAt: "2026-08-25T00:00:00.000Z",
				finishedAt: "2026-08-25T00:00:01.000Z",
				activatedReserveCellIds: [],
				observed: {
					attempts: attempts.length,
					outputTokens: attempts.length,
					costUsd: 0,
					wallClockMs: 1_000,
				},
			},
			allocationCommitmentSha256: null,
		},
		catalog.value,
	);
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
	const labels = REVIEWER_CASES.flatMap((fixture) =>
		fixture.syntheticLabels.map((label) => ({
			...label,
			caseId: fixture.caseId,
			caseVersion: assessmentSource === "historical" ? 1 : fixture.caseVersion,
		})),
	);
	return {
		report: parsed.value,
		catalog: catalog.value,
		labels,
		artifact,
		model,
	};
}

describe("reviewer fixed cases", () => {
	test("uses versioned fixtures with explicit synthetic labels and defect locations", () => {
		expect(REVIEWER_CASES).toHaveLength(2);
		for (const fixture of REVIEWER_CASES) {
			expect(fixture.caseVersion).toBe(2);
			expect(fixture.syntheticLabels).toHaveLength(2);
			expect(
				fixture.syntheticLabels.every(
					(label) => label.labelSource === "synthetic",
				),
			).toBe(true);
			expect(assertReviewerCaseTruth(fixture)).toBe(fixture.truth);
			expect(assertReviewerCaseTruth({ ...fixture, caseVersion: 1 })).toBe(
				fixture.truth,
			);
		}
	});

	test("retains historical verdict-only report semantics without backfilling assessments", () => {
		const fixture = promotionFixture(false, false, "historical");
		for (const attempt of fixture.report.attempts) {
			expect(attempt.outcome).toMatchObject({ kind: "product", passed: true });
			if (attempt.outcome.kind !== "product")
				throw new Error("Expected product evidence.");
			expect(attempt.outcome.evidence).not.toHaveProperty("assessment");
		}
	});

	test("round-trips full finding details through the V2 report boundary", () => {
		const fixture = promotionFixture();
		const entry = REVIEWER_CASES[0];
		if (!entry) throw new Error("Expected defect reviewer case.");
		const finding = {
			findingId: "review-target.R1-01",
			severity: "blocking" as const,
			summary: "The branch returns the wrong result.",
			evidence: `${"Retained source context. ".repeat(300)}src/value.ts:2 value(7) returns 6 instead of 8.`,
			scopeBlocker: false,
		};
		const outcome = reviewerOutcome(
			entry,
			{ kind: "submitted", verdict: "failed", findings: [finding] },
			"quiet",
		);
		const parsed = parseReport(
			{
				...fixture.report,
				attempts: fixture.report.attempts.map((attempt) =>
					attempt.caseId === entry.caseId ? { ...attempt, outcome } : attempt,
				),
			},
			fixture.catalog,
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		expect(parsed.value.attempts[0]?.outcome).toMatchObject({
			kind: "product",
			passed: true,
			evidence: { findingDetails: [finding] },
		});
	});

	test("accepts a failed grade for an unrelated failed reviewer verdict", () => {
		const fixture = promotionFixture();
		const entry = REVIEWER_CASES[0];
		if (!entry) throw new Error("Expected defect reviewer case.");
		const outcome = reviewerOutcome(
			entry,
			{
				kind: "submitted",
				verdict: "failed",
				findings: [
					{
						severity: "blocking",
						summary: "Missing documentation",
						evidence: "src/value.ts:1",
					},
				],
			},
			"quiet",
		);
		const parsed = parseReport(
			{
				...fixture.report,
				attempts: fixture.report.attempts.map((attempt) =>
					attempt.caseId === entry.caseId ? { ...attempt, outcome } : attempt,
				),
			},
			fixture.catalog,
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		expect(parsed.value.attempts[0]?.outcome).toMatchObject({
			kind: "product",
			passed: false,
			evidence: { verdict: "failed", assessment: { matchedDefectIds: [] } },
		});
	});

	test("rejects executable truth drift", () => {
		const fixture = REVIEWER_CASES[0];
		if (!fixture) throw new Error("Expected fixture.");
		expect(() =>
			assertReviewerCaseTruth({
				caseId: fixture.caseId,
				caseVersion: fixture.caseVersion,
				files: {
					...fixture.files,
					"src/value.test.ts": "test fixture drift\n",
				},
			}),
		).toThrow("fixture drifted");
	});
});

describe("reviewer calibration", () => {
	test("counts every confusion-matrix cell and unsubmitted evidence", () => {
		const analysis = analyzeReviewerCalibration([
			{
				caseId: "a",
				caseVersion: 1,
				truth: "defect",
				verdict: "failed",
				submitted: true,
			},
			{
				caseId: "b",
				caseVersion: 1,
				truth: "defect",
				verdict: "passed",
				submitted: true,
			},
			{
				caseId: "c",
				caseVersion: 1,
				truth: "clean",
				verdict: "failed",
				submitted: true,
			},
			{
				caseId: "d",
				caseVersion: 1,
				truth: "clean",
				verdict: "passed",
				submitted: true,
			},
			{
				caseId: "e",
				caseVersion: 1,
				truth: "clean",
				verdict: null,
				submitted: false,
			},
		]);
		expect(analysis.matrix).toEqual({
			truePositives: 1,
			falseNegatives: 1,
			falsePositives: 1,
			trueNegatives: 1,
			unsubmitted: 1,
		});
		expect(analysis.detectionRate).toBe(0.5);
		expect(analysis.falsePositiveRate).toBeCloseTo(1 / 2);
		expect(analysis.detectionInterval95).not.toBeNull();
		expect(analysis.falsePositiveInterval95).not.toBeNull();
		expect(analysis.historicalVerdictCases).toBe(4);
		expect(analysis.assessedCases).toBe(0);
	});

	test("uses defect matches and counts false findings independently of verdicts", () => {
		const analysis = analyzeReviewerCalibration([
			{
				caseId: "a",
				caseVersion: 2,
				truth: "defect",
				verdict: "failed",
				submitted: true,
				assessment: {
					schemaVersion: 1,
					matchedDefectIds: [],
					falseFindingIds: [],
					unassessedFindingIds: ["unrelated"],
					labelSource: "synthetic",
				},
			},
			{
				caseId: "b",
				caseVersion: 2,
				truth: "defect",
				verdict: "failed",
				submitted: true,
				assessment: {
					schemaVersion: 1,
					matchedDefectIds: ["planted"],
					falseFindingIds: [],
					unassessedFindingIds: ["extra"],
					labelSource: "synthetic",
				},
			},
			{
				caseId: "c",
				caseVersion: 2,
				truth: "clean",
				verdict: "passed",
				submitted: true,
				assessment: {
					schemaVersion: 1,
					matchedDefectIds: [],
					falseFindingIds: ["invented-a", "invented-b"],
					unassessedFindingIds: [],
					labelSource: "synthetic",
				},
			},
			{
				caseId: "d",
				caseVersion: 2,
				truth: "clean",
				verdict: "passed",
				submitted: true,
				assessment: {
					schemaVersion: 1,
					matchedDefectIds: [],
					falseFindingIds: [],
					unassessedFindingIds: [],
					labelSource: "synthetic",
				},
			},
		]);
		expect(analysis.matrix).toEqual({
			truePositives: 1,
			falseNegatives: 1,
			falsePositives: 1,
			trueNegatives: 1,
			unsubmitted: 0,
		});
		expect(analysis.falseFindings).toBe(2);
		expect(analysis.unassessedFindings).toBe(2);
		expect(analysis.assessedCases).toBe(4);
		expect(analysis.historicalVerdictCases).toBe(0);
	});

	test("computes nominal agreement and exposes disagreement", () => {
		const agreed = krippendorffNominalAlpha([
			{ caseId: "a", caseVersion: 1, raterId: "one", truth: "defect" },
			{ caseId: "a", caseVersion: 1, raterId: "two", truth: "defect" },
			{ caseId: "b", caseVersion: 1, raterId: "one", truth: "clean" },
			{ caseId: "b", caseVersion: 1, raterId: "two", truth: "clean" },
		]);
		expect(agreed).toBe(1);
		const disputed = krippendorffNominalAlpha([
			{ caseId: "a", caseVersion: 1, raterId: "one", truth: "defect" },
			{ caseId: "a", caseVersion: 1, raterId: "two", truth: "clean" },
			{ caseId: "b", caseVersion: 1, raterId: "one", truth: "clean" },
			{ caseId: "b", caseVersion: 1, raterId: "two", truth: "defect" },
		]);
		expect(disputed).not.toBeNull();
		expect(disputed ?? 1).toBeLessThan(0.8);
	});

	test("does not let a heavily labeled case hide another case's disagreement", () => {
		const labels = [
			...Array.from({ length: 10 }, (_, index) => ({
				caseId: "agreed",
				caseVersion: 2,
				raterId: `person-${index}`,
				truth: "defect" as const,
			})),
			{
				caseId: "disputed",
				caseVersion: 2,
				raterId: "person-a",
				truth: "defect" as const,
			},
			{
				caseId: "disputed",
				caseVersion: 2,
				raterId: "person-b",
				truth: "clean" as const,
			},
		];
		expect(krippendorffNominalAlpha(labels)).toBeCloseTo(0, 12);
		expect(
			krippendorffNominalAlpha([
				...labels,
				{
					caseId: "unpaired",
					caseVersion: 2,
					raterId: "person-c",
					truth: "clean",
				},
			]),
		).toBeCloseTo(0, 12);
	});

	test("strict promotion records require complete frozen evidence and bounds", () => {
		const base = {
			schemaVersion: 1,
			planSha256: digest("a"),
			calibrationReportSha256: digest("b"),
			caseCatalogSha256: digest("c"),
			humanLabelsSha256: digest("d"),
			artifactSha256: digest("e"),
			reviewerModels: [
				{
					routeProvider: "openai",
					gateway: null,
					family: "gpt",
					model: "reviewer",
					revision: null,
				},
			],
			defectCases: 4,
			cleanCases: 4,
			ratersPerCase: 2,
			agreement: { method: "krippendorff-alpha", value: 0.9, minimum: 0.8 },
			observed: {
				detectionRate: 1,
				detectionInterval95: [0.8, 1],
				falsePositiveRate: 0,
				falsePositiveInterval95: [0, 0.2],
			},
			minimumDetectionRate: 0.8,
			maximumFalsePositiveRate: 0.2,
			recordedAt: "2026-08-25T00:00:00.000Z",
		};
		expect(ReviewerPromotionRecordSchema.safeParse(base).success).toBe(true);
		expect(
			ReviewerPromotionRecordSchema.safeParse({
				...base,
				agreement: { ...base.agreement, value: 0.7 },
			}).success,
		).toBe(false);
		expect(
			ReviewerPromotionRecordSchema.safeParse({
				...base,
				observed: { ...base.observed, falsePositiveInterval95: [0, 0.3] },
			}).success,
		).toBe(false);
	});

	test("keeps synthetic calibration advisory even with permissive promotion bounds", () => {
		const fixture = promotionFixture();
		const input = {
			report: fixture.report,
			catalog: fixture.catalog,
			labels: fixture.labels,
			artifact: fixture.artifact,
			reviewerModels: [fixture.model],
			minimumDetectionRate: 0.2,
			maximumFalsePositiveRate: 0.8,
			minimumCasesPerTruth: 1,
			recordedAt: "2026-08-25T00:00:00.000Z",
		};
		expect(createReviewerPromotion({ ...input, mode: "pilot" }).kind).toBe(
			"advisory",
		);
		expect(createReviewerPromotion({ ...input, mode: "promotion" }).kind).toBe(
			"advisory",
		);
		const result = createReviewerPromotion({ ...input, mode: "promotion" });
		if (result.kind !== "advisory")
			throw new Error("Synthetic labels must be advisory.");
		expect(result.reasons).toContain(
			"Synthetic or unverified label arrays cannot establish human calibration; import independent human labels.",
		);
	});

	test("keeps claimed human assessments advisory without per-finding adjudication provenance", () => {
		const labels = parseReviewerLabelImport({
			schemaVersion: 1,
			labelSource: "human",
			collectionId: "unit-test-import",
			recordedAt: "2026-08-25T00:00:00.000Z",
			cases: REVIEWER_CASES.map((entry) => ({
				caseId: entry.caseId,
				caseVersion: entry.caseVersion,
				truthSha256: entry.truthSha256,
				labels: ["independent-one", "independent-two"].map((raterId) => ({
					raterId,
					truth: entry.truth,
					defectIds: entry.defects.map((defect) => defect.defectId),
					rationale: "Parser test data, not collected human calibration.",
					independent: true,
					blindedToReviewer: true,
				})),
				adjudication: null,
			})),
		});
		if (!labels.ok) throw new Error(JSON.stringify(labels.issues));
		const fixture = promotionFixture(false, false, "human");
		const input = {
			mode: "promotion" as const,
			report: fixture.report,
			catalog: fixture.catalog,
			labels: labels.value,
			artifact: fixture.artifact,
			reviewerModels: [fixture.model],
			minimumDetectionRate: 0.2,
			maximumFalsePositiveRate: 0.8,
			minimumCasesPerTruth: 1,
			recordedAt: "2026-08-25T00:00:00.000Z",
		};
		expect(createReviewerPromotion(input)).toMatchObject({
			kind: "advisory",
			reasons: expect.arrayContaining([
				"Per-attempt and per-finding human adjudication provenance is absent from the F1 assessment format.",
			]),
		});
		const tamperedReport = (matchedDefectIds: string[]) =>
			parseReport(
				{
					...fixture.report,
					attempts: fixture.report.attempts.map((attempt) => {
						if (
							attempt.outcome.kind !== "product" ||
							attempt.outcome.evidence.kind !== "reviewer-only" ||
							attempt.outcome.evidence.truth !== "defect"
						)
							return attempt;
						return {
							...attempt,
							outcome: {
								...attempt.outcome,
								evidence: {
									...attempt.outcome.evidence,
									findings: ["Missing documentation."],
									findingDetails: [
										{
											findingId: "finding-1",
											severity: "blocking",
											summary: "Missing documentation.",
											evidence: "src/value.ts:1",
										},
									],
									assessment: {
										schemaVersion: 1,
										matchedDefectIds,
										falseFindingIds: [],
										unassessedFindingIds: [],
										labelSource: "human",
									},
								},
							},
						};
					}),
				},
				fixture.catalog,
			);
		const relabeled = tamperedReport(["value-seven-decrements"]);
		expect(relabeled.ok).toBe(true);
		if (!relabeled.ok) throw new Error(JSON.stringify(relabeled.issues));
		expect(
			createReviewerPromotion({ ...input, report: relabeled.value }),
		).toMatchObject({
			kind: "advisory",
			reasons: expect.arrayContaining([
				"Per-attempt and per-finding human adjudication provenance is absent from the F1 assessment format.",
			]),
		});
		expect(tamperedReport(["unregistered-defect"]).ok).toBe(false);
		expect(createReviewerPromotion({ ...input, mode: "pilot" }).kind).toBe(
			"advisory",
		);
		expect(
			createReviewerPromotion({ ...input, report: promotionFixture().report })
				.kind,
		).toBe("advisory");
		expect(
			createReviewerPromotion({
				...input,
				report: promotionFixture(false, false, "historical").report,
			}).kind,
		).toBe("advisory");
	});

	test("refuses duplicate, unrelated, and unobserved calibration evidence", () => {
		const fixture = promotionFixture();
		const input = {
			mode: "promotion" as const,
			report: fixture.report,
			catalog: fixture.catalog,
			artifact: fixture.artifact,
			reviewerModels: [fixture.model],
			minimumDetectionRate: 0.2,
			maximumFalsePositiveRate: 0.8,
			minimumCasesPerTruth: 1,
			recordedAt: "2026-08-25T00:00:00.000Z",
		};
		const firstLabel = fixture.labels[0];
		if (!firstLabel) throw new Error("Expected synthetic label.");
		const duplicate = createReviewerPromotion({
			...input,
			labels: [...fixture.labels, firstLabel],
		});
		expect(duplicate).toMatchObject({
			kind: "advisory",
			reasons: expect.arrayContaining([
				"A calibration case cannot reuse one human rater.",
			]),
		});
		const unrelated = createReviewerPromotion({
			...input,
			labels: [
				...fixture.labels,
				{ caseId: "other", caseVersion: 1, raterId: "a", truth: "clean" },
			],
		});
		expect(unrelated).toMatchObject({
			kind: "advisory",
			reasons: expect.arrayContaining([
				"Human labels must name exactly the frozen calibration cases.",
			]),
		});
		const unobserved = promotionFixture(true);
		const missingIdentity = createReviewerPromotion({
			...input,
			report: unobserved.report,
			catalog: unobserved.catalog,
			labels: unobserved.labels,
			artifact: unobserved.artifact,
			reviewerModels: [unobserved.model],
		});
		expect(missingIdentity).toMatchObject({
			kind: "advisory",
			reasons: expect.arrayContaining([
				"Every calibration outcome requires an observed reviewer identity.",
			]),
		});
		const unsubmitted = promotionFixture(false, true);
		const unsubmittedPromotion = createReviewerPromotion({
			...input,
			report: unsubmitted.report,
			catalog: unsubmitted.catalog,
			labels: unsubmitted.labels,
			artifact: unsubmitted.artifact,
			reviewerModels: [unsubmitted.model],
		});
		expect(unsubmittedPromotion.kind).toBe("advisory");
		if (unsubmittedPromotion.kind === "advisory") {
			expect(unsubmittedPromotion.reasons).toContain(
				"Calibration cannot contain unsubmitted reviewer outcomes.",
			);
		}
	});
});
