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

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

function promotionFixture(unobserved = false, unsubmitted = false) {
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
		caseVersion: fixture.caseVersion,
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
		caseVersion: fixture.caseVersion,
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
			(candidate) =>
				candidate.caseId === cell.caseId &&
				candidate.caseVersion === cell.caseVersion,
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
			caseVersion: 1,
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
		fixture.humanLabels.map((label) => ({
			...label,
			caseId: fixture.caseId,
			caseVersion: fixture.caseVersion,
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
	test("uses opaque versioned fixtures with two immutable labels each", () => {
		expect(REVIEWER_CASES).toHaveLength(2);
		for (const fixture of REVIEWER_CASES) {
			expect(fixture.humanLabels).toHaveLength(2);
			expect(assertReviewerCaseTruth(fixture)).toBe(fixture.truth);
		}
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

	test("keeps pilots advisory and promotes only a complete observed calibration", () => {
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
			"promotion",
		);
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
		if (!firstLabel) throw new Error("Expected fixed human label.");
		expect(
			createReviewerPromotion({
				...input,
				labels: [...fixture.labels, { ...firstLabel, raterId: "a" }],
			}).kind,
		).toBe("advisory");
		expect(
			createReviewerPromotion({
				...input,
				labels: [
					...fixture.labels,
					{ caseId: "other", caseVersion: 1, raterId: "a", truth: "clean" },
				],
			}).kind,
		).toBe("advisory");
		const unobserved = promotionFixture(true);
		expect(
			createReviewerPromotion({
				...input,
				report: unobserved.report,
				catalog: unobserved.catalog,
				labels: unobserved.labels,
				artifact: unobserved.artifact,
				reviewerModels: [unobserved.model],
			}).kind,
		).toBe("advisory");
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
