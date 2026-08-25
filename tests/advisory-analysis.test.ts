import { describe, expect, test } from "bun:test";
import {
	analyzePairs,
	analyzeReviewer,
	compareExpectedProvenance,
	deriveReleaseDecision,
	type ExpectedActorProvenance,
	type PairedExpectedProvenance,
	type ReleaseExpectedProvenance,
} from "../evals/analysis.js";
import {
	parseCaseCatalog,
	type ValidatedCaseCatalog,
} from "../evals/catalog.js";
import {
	CampaignPlanSchema,
	campaignPlanSha256,
	parseReport,
	type ValidatedReport,
} from "../evals/report.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;

function v2Model(provider: string, model = "model-1") {
	return {
		routeProvider: provider,
		gateway: null,
		family: "test-family",
		model,
		revision: "2026-08-25",
	};
}

const V2_ARTIFACT_A = {
	packageVersion: "9.0.0",
	sourceCommit: "a".repeat(40),
	sourceTreeSha256: DIGEST_A,
	tarballSha256: DIGEST_B,
	unpackedManifestSha256: DIGEST_C,
};

const V2_ARTIFACT_B = {
	packageVersion: "8.9.0",
	sourceCommit: "b".repeat(40),
	sourceTreeSha256: DIGEST_B,
	tarballSha256: DIGEST_C,
	unpackedManifestSha256: DIGEST_D,
};

const V2_EVALUATOR = {
	sourceCommit: "c".repeat(40),
	caseCatalogSha256: DIGEST_A,
	policyCatalogSha256: DIGEST_B,
	graderBundleSha256: DIGEST_C,
};

const V2_INSTRUCTIONS = [
	{
		source: "command" as const,
		name: "flow",
		sequence: 0,
		sha256: DIGEST_D,
		bytes: 128,
	},
];

function mustCatalog(input: unknown): ValidatedCaseCatalog {
	const parsed = parseCaseCatalog(input);
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
	return parsed.value;
}

function mustReport(
	input: unknown,
	catalog: ValidatedCaseCatalog,
): ValidatedReport {
	const parsed = parseReport(input, catalog);
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
	return parsed.value;
}

function expectedActor(
	actor: ValidatedReport["attempts"][number]["actors"][number],
): ExpectedActorProvenance {
	return {
		role: actor.role,
		requestedModel: actor.requestedModel,
		actualModel:
			actor.actualModel.kind === "observed"
				? { kind: "observed", value: actor.actualModel.value }
				: {
						kind: "allow-unobserved",
						value: actor.requestedModel,
						reason:
							"Pinned host capability permits an unobserved actual model.",
					},
	};
}

function releaseExpected(report: ValidatedReport): ReleaseExpectedProvenance {
	const first = report.attempts[0];
	if (first === undefined || "kind" in first.artifact) {
		throw new Error("Release fixture needs exact artifact provenance.");
	}
	return {
		kind: "release",
		artifact: first.artifact,
		evaluator: first.evaluator,
		hostConfigSha256: first.hostConfigSha256,
		attempts: report.attempts.map((attempt) => ({
			cellId: attempt.cellId,
			actors: attempt.actors.map(expectedActor),
			instructions: attempt.instructions,
		})),
	};
}

function reviewerCatalog() {
	return [
		{
			caseId: "reviewer-case",
			caseVersion: 1,
			evidenceClass: "reviewer-only",
			oracle: "fixed-review-label",
			release: "required",
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: 0.5,
			reviewerPromotionRecordSha256: DIGEST_A,
		},
	];
}

const REVIEWER_LABELS = [
	{ truth: "defect" as const, verdict: "failed" as const },
	{ truth: "defect" as const, verdict: "passed" as const },
	{ truth: "clean" as const, verdict: "passed" as const },
	{ truth: "clean" as const, verdict: "failed" as const },
	{ truth: "clean" as const, verdict: null },
];

function buildReviewerReport() {
	const manager = v2Model("provider-review");
	const reviewer = v2Model("provider-review", "reviewer-model");
	const cells = REVIEWER_LABELS.map((_, index) => ({
		cellId: `reviewer-cell-${index}`,
		blockId: `reviewer-block-${index}`,
		caseId: "reviewer-case",
		caseVersion: 1,
		armToken: null,
		repetition: index,
		managerModel: manager,
		reviewerModel: reviewer,
		schedule: "primary" as const,
	}));
	const attempts = REVIEWER_LABELS.map((label, index) => {
		const correct =
			label.verdict !== null &&
			(label.truth === "defect"
				? label.verdict === "failed"
				: label.verdict === "passed");
		return {
			schemaVersion: 2 as const,
			attemptId: `reviewer-attempt-${index}`,
			cellId: `reviewer-cell-${index}`,
			blockId: `reviewer-block-${index}`,
			caseId: "reviewer-case",
			caseVersion: 1,
			armToken: null,
			repetition: index,
			artifact: V2_ARTIFACT_A,
			evaluator: V2_EVALUATOR,
			hostConfigSha256: DIGEST_D,
			actors: [
				{
					role: "reviewer" as const,
					requestedModel: reviewer,
					actualModel: { kind: "observed" as const, value: reviewer },
					sessionIds: [`review-session-${index}`],
				},
			],
			instructions: V2_INSTRUCTIONS,
			transcript: {
				sha256: DIGEST_A,
				artifact: `transcripts/reviewer-${index}.json`,
			},
			outcome: {
				kind: "product" as const,
				passed: correct,
				endedBy: "quiet" as const,
				issues: correct ? [] : ["incorrect or unsubmitted review"],
				evidence: {
					kind: "reviewer-only" as const,
					truth: label.truth,
					verdict: label.verdict,
					findings: label.verdict === "failed" ? ["fixed finding"] : [],
					submitted: label.verdict !== null,
				},
			},
			usage: { durationMs: 100, outputTokens: 10, costUsd: 0.1 },
		};
	});
	const plan = {
		schemaVersion: 1 as const,
		planId: "reviewer-plan",
		planSha256: DIGEST_A,
		randomizationSeed: "reviewer-seed",
		cells,
		abortPolicy: { retry: "never" as const, maxReplacementBlocks: 0 },
		stoppingRule: { kind: "fixed-attempts" as const, count: cells.length },
		analysis: {
			kind: "reviewer" as const,
			interval: "wilson" as const,
			alpha: 0.05 as const,
			versionSha256: DIGEST_B,
		},
		budget: {
			maxUsd: 10,
			unknownCostPolicy: "stop" as const,
			maxOutputTokens: 1000,
			maxWallClockMs: 10000,
			maxAttempts: cells.length,
		},
	};
	plan.planSha256 = campaignPlanSha256(CampaignPlanSchema.parse(plan));
	return {
		schemaVersion: 2 as const,
		reportId: "reviewer-report",
		plan,
		attempts,
		completion: {
			status: "complete" as const,
			cause: "fixed-target" as const,
			startedAt: "2026-08-25T10:00:00.000Z",
			finishedAt: "2026-08-25T10:00:00.000Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: attempts.length,
				outputTokens: attempts.length * 10,
				costUsd: attempts.length * 0.1,
				wallClockMs: 1000,
			},
		},
		allocationCommitmentSha256: null,
	};
}

describe("v2 reviewer analysis", () => {
	test("derives fixed-label rates and Wilson 95 percent intervals", () => {
		const report = mustReport(
			buildReviewerReport(),
			mustCatalog(reviewerCatalog()),
		);
		const analysis = analyzeReviewer(report);
		expect(analysis).toMatchObject({
			assignments: 5,
			defectLabels: 2,
			cleanLabels: 3,
			detections: 1,
			falsePositives: 1,
			unsubmitted: 1,
			detectionRate: 0.5,
			falsePositiveRate: 1 / 3,
		});
		expect(analysis.detectionInterval95?.lower).toBeCloseTo(0.0945, 3);
		expect(analysis.detectionInterval95?.upper).toBeCloseTo(0.9055, 3);
		expect(analysis.falsePositiveInterval95?.lower).toBeCloseTo(0.0615, 3);
		expect(analysis.falsePositiveInterval95?.upper).toBeCloseTo(0.7923, 3);
	});

	test("keeps incomplete reviewer assignments visible", () => {
		const raw = buildReviewerReport();
		const last = raw.attempts.at(-1);
		if (last === undefined) throw new Error("Expected reviewer attempt.");
		Reflect.set(last, "outcome", {
			kind: "failure",
			origin: "provider",
			code: "unavailable",
			retryable: true,
		});
		Reflect.set(raw.completion, "status", "stopped");
		Reflect.set(raw.completion, "cause", "provider");
		const report = mustReport(raw, mustCatalog(reviewerCatalog()));
		expect(analyzeReviewer(report)).toMatchObject({
			assignments: 5,
			incomplete: 1,
		});
	});

	test("treats an unsubmitted review as a hard release reason", () => {
		const catalog = mustCatalog(reviewerCatalog());
		const report = mustReport(buildReviewerReport(), catalog);
		const decision = deriveReleaseDecision({
			report,
			catalog,
			expected: releaseExpected(report),
		});
		expect(decision.verdict).toBe("NOT VERIFIED");
		expect(decision.reasons.map((reason) => reason.code)).toContain(
			"unsubmitted-review",
		);
	});
});

function pairedCatalog() {
	return [
		{
			caseId: "paired-case",
			caseVersion: 1,
			evidenceClass: "paired-value",
			oracle: "hidden-executable",
			release: "report-only",
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: null,
			reviewerPromotionRecordSha256: null,
		},
	];
}

function buildPairedReport(incomplete = false) {
	const model = v2Model("provider-paired");
	const correctness = [
		[true, true],
		[true, false],
		[false, true],
	] as const;
	const cells = correctness.flatMap((_, blockIndex) =>
		["opaque-blue", "opaque-red"].map((armToken, armIndex) => ({
			cellId: `pair-cell-${blockIndex}-${armIndex}`,
			blockId: `pair-block-${blockIndex}`,
			caseId: "paired-case",
			caseVersion: 1,
			armToken,
			repetition: blockIndex,
			managerModel: model,
			reviewerModel: null,
			schedule: "primary" as const,
		})),
	);
	const attempts = cells.map((cell, index) => {
		const blockIndex = Math.floor(index / 2);
		const armIndex = index % 2;
		const hiddenCorrectness = correctness[blockIndex]?.[armIndex] ?? false;
		const unscored = incomplete && index === cells.length - 1;
		return {
			schemaVersion: 2 as const,
			attemptId: `pair-attempt-${index}`,
			cellId: cell.cellId,
			blockId: cell.blockId,
			caseId: cell.caseId,
			caseVersion: cell.caseVersion,
			armToken: cell.armToken,
			repetition: cell.repetition,
			artifact: armIndex === 0 ? V2_ARTIFACT_A : V2_ARTIFACT_B,
			evaluator: V2_EVALUATOR,
			hostConfigSha256: DIGEST_D,
			actors: [
				{
					role: "manager" as const,
					requestedModel: model,
					actualModel: { kind: "observed" as const, value: model },
					sessionIds: [`pair-session-${index}`],
				},
			],
			instructions: V2_INSTRUCTIONS,
			transcript: {
				sha256: DIGEST_A,
				artifact: `transcripts/pair-${index}.json`,
			},
			outcome: unscored
				? {
						kind: "unscored-escalation" as const,
						reason: "Incomplete pair.",
					}
				: {
						kind: "product" as const,
						passed: hiddenCorrectness,
						endedBy: "quiet" as const,
						issues: hiddenCorrectness ? [] : ["hidden check failed"],
						evidence: {
							kind: "paired-value" as const,
							hiddenCorrectness,
							claimedComplete: false,
							falseCompletion: false,
						},
					},
			usage: { durationMs: 100, outputTokens: 10, costUsd: 0.1 },
		};
	});
	const plan = {
		schemaVersion: 1 as const,
		planId: "paired-plan",
		planSha256: DIGEST_A,
		randomizationSeed: "paired-seed",
		cells,
		abortPolicy: { retry: "whole-pair" as const, maxReplacementBlocks: 0 },
		stoppingRule: {
			kind: "fixed-complete-pairs" as const,
			count: correctness.length,
		},
		analysis: {
			kind: "paired" as const,
			primaryOutcome: "hidden-correctness" as const,
			estimand: "candidate-minus-baseline-risk-difference" as const,
			interval: "task-stratified-paired-bootstrap" as const,
			alpha: 0.05 as const,
			targetPower: 0.8,
			minimumDetectableEffect: 0.2,
			tieRule: "zero-difference" as const,
			bootstrapSeed: "paired-bootstrap-seed",
			versionSha256: DIGEST_B,
		},
		budget: {
			maxUsd: 10,
			unknownCostPolicy: "stop" as const,
			maxOutputTokens: 1000,
			maxWallClockMs: 10000,
			maxAttempts: cells.length,
		},
	};
	plan.planSha256 = campaignPlanSha256(CampaignPlanSchema.parse(plan));
	return {
		schemaVersion: 2 as const,
		reportId: "paired-report",
		plan,
		attempts,
		completion: {
			status: incomplete ? ("stopped" as const) : ("complete" as const),
			cause: incomplete ? ("evaluator" as const) : ("fixed-target" as const),
			startedAt: "2026-08-25T10:00:00.000Z",
			finishedAt: "2026-08-25T10:00:00.000Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: attempts.length,
				outputTokens: attempts.length * 10,
				costUsd: attempts.length * 0.1,
				wallClockMs: 1000,
			},
		},
		allocationCommitmentSha256: DIGEST_C,
	};
}

function pairedExpected(report: ValidatedReport): PairedExpectedProvenance {
	const first = report.attempts[0];
	if (first === undefined) throw new Error("Expected paired fixture attempt.");
	return {
		kind: "paired",
		artifacts: [V2_ARTIFACT_A, V2_ARTIFACT_B],
		evaluator: first.evaluator,
		hostConfigSha256: first.hostConfigSha256,
		attempts: report.attempts.map((attempt) => ({
			cellId: attempt.cellId,
			actors: attempt.actors.map(expectedActor),
			instructions: attempt.instructions,
		})),
	};
}

describe("v2 opaque paired analysis", () => {
	test("counts ties and wins without assigning candidate direction", () => {
		const report = mustReport(
			buildPairedReport(),
			mustCatalog(pairedCatalog()),
		);
		expect(analyzePairs(report)).toEqual({
			eligible: 3,
			complete: 3,
			incomplete: 0,
			ties: 1,
			opaqueArmWins: [
				{ armToken: "opaque-blue", wins: 1 },
				{ armToken: "opaque-red", wins: 1 },
			],
		});
		expect(
			compareExpectedProvenance(report, pairedExpected(report)).matches,
		).toBe(true);
		expect(analyzeReviewer(report)).toMatchObject({
			assignments: 0,
			incomplete: 0,
			detectionRate: null,
			falsePositiveRate: null,
		});
	});

	test("counts an incomplete pair without manufacturing a winner", () => {
		const report = mustReport(
			buildPairedReport(true),
			mustCatalog(pairedCatalog()),
		);
		expect(analyzePairs(report)).toEqual({
			eligible: 3,
			complete: 2,
			incomplete: 1,
			ties: 1,
			opaqueArmWins: [
				{ armToken: "opaque-blue", wins: 1 },
				{ armToken: "opaque-red", wins: 0 },
			],
		});
	});

	test("counts only active reserve pairs as eligible", () => {
		const prepareReserve = (activated: boolean) => {
			const raw = buildPairedReport();
			const reserveCells = raw.plan.cells.filter(
				(cell) => cell.blockId === "pair-block-2",
			);
			for (const cell of reserveCells) {
				Reflect.set(cell, "schedule", "replacement-reserve");
			}
			raw.plan.abortPolicy.maxReplacementBlocks = 1;
			Reflect.set(raw.plan.stoppingRule, "count", 2);
			if (activated) {
				Reflect.set(
					raw.completion,
					"activatedReserveCellIds",
					reserveCells.map((cell) => cell.cellId),
				);
				const failed = raw.attempts[0];
				if (failed === undefined) throw new Error("Expected paired attempt.");
				Reflect.set(failed, "outcome", {
					kind: "failure",
					origin: "provider",
					code: "unavailable",
					retryable: true,
				});
			} else {
				raw.attempts.splice(-2, 2);
				raw.completion.observed.attempts = 4;
				raw.completion.observed.outputTokens = 40;
				raw.completion.observed.costUsd = 0.4;
			}
			raw.plan.planSha256 = campaignPlanSha256(
				CampaignPlanSchema.parse(raw.plan),
			);
			return mustReport(raw, mustCatalog(pairedCatalog()));
		};
		expect(analyzePairs(prepareReserve(false)).eligible).toBe(2);
		expect(analyzePairs(prepareReserve(true))).toMatchObject({
			eligible: 3,
			complete: 2,
			incomplete: 1,
		});
	});

	test("requires both expected artifacts in every complete block", () => {
		const raw = buildPairedReport();
		const secondAttempt = raw.attempts[1];
		if (secondAttempt === undefined)
			throw new Error("Expected paired attempt.");
		secondAttempt.artifact = V2_ARTIFACT_A;
		const report = mustReport(raw, mustCatalog(pairedCatalog()));
		const comparison = compareExpectedProvenance(
			report,
			pairedExpected(report),
		);
		expect(comparison.matches).toBe(false);
		expect(comparison.mismatches.map((item) => item.path)).toContain(
			"blocks.pair-block-0.artifacts",
		);
	});

	test("accepts an ordinary baseline and rejects duplicate expectations", () => {
		const raw = buildPairedReport();
		for (const attempt of raw.attempts) {
			if (attempt.armToken === "opaque-red") {
				Reflect.set(attempt, "artifact", { kind: "ordinary-opencode" });
			}
		}
		const report = mustReport(raw, mustCatalog(pairedCatalog()));
		const expected = pairedExpected(report);
		const ordinary: PairedExpectedProvenance = {
			...expected,
			artifacts: [V2_ARTIFACT_A, { kind: "ordinary-opencode" }],
		};
		expect(compareExpectedProvenance(report, ordinary).matches).toBe(true);
		expect(
			compareExpectedProvenance(report, {
				...ordinary,
				artifacts: [V2_ARTIFACT_A, V2_ARTIFACT_A],
			}).matches,
		).toBe(false);
	});
});
