import { describe, expect, test } from "bun:test";
import {
	parseCaseCatalog,
	type ValidatedCaseCatalog,
} from "../evals/catalog.js";
import {
	campaignPlanSha256,
	type EvalReportV2,
	EvalReportV2Schema,
	parseReport,
	type ValidatedReport,
} from "../evals/report.js";
import {
	compareReports,
	compareTrend,
	comparisonKey,
	renderEvidence,
} from "../evals/report-render.js";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
type Fixture = {
	readonly report: ValidatedReport;
	readonly catalog: ValidatedCaseCatalog;
};

function fixture(
	input: {
		readonly pass?: boolean;
		readonly artifact?: string;
		readonly artifactCommit?: string;
		readonly evaluatorCommit?: string;
		readonly evaluatorDigest?: string;
		readonly host?: string;
		readonly model?: string;
		readonly instruction?: string;
		readonly caseVersion?: number;
		readonly policyVersion?: string;
		readonly oracle?: "durable-state" | "hidden-executable" | "trajectory";
	} = {},
): Fixture {
	const caseVersion = input.caseVersion ?? 1;
	const model = {
		routeProvider: "provider",
		gateway: null,
		family: "family",
		model: input.model ?? "model",
		revision: null,
	};
	const cell = {
		cellId: "cell",
		blockId: "block",
		caseId: "case",
		caseVersion,
		armToken: null,
		repetition: 0,
		managerModel: model,
		reviewerModel: null,
		schedule: "primary" as const,
	};
	const plan: EvalReportV2["plan"] = {
		schemaVersion: 1,
		planId: "plan",
		planSha256: digest("0"),
		randomizationSeed: "seed",
		cells: [cell],
		abortPolicy: { retry: "never", maxReplacementBlocks: 0 },
		stoppingRule: { kind: "fixed-attempts", count: 1 },
		analysis: {
			kind: "rate",
			primaryOutcome: "correctness",
			versionSha256: input.policyVersion ?? digest("1"),
		},
		budget: {
			maxUsd: 1,
			unknownCostPolicy: "stop",
			maxOutputTokens: 100,
			maxWallClockMs: 1_000,
			maxAttempts: 1,
		},
	};
	plan.planSha256 = campaignPlanSha256(plan);
	const pass = input.pass ?? true;
	const attempt: EvalReportV2["attempts"][number] = {
		schemaVersion: 2,
		attemptId: "attempt",
		cellId: cell.cellId,
		blockId: cell.blockId,
		caseId: cell.caseId,
		caseVersion,
		armToken: null,
		repetition: 0,
		artifact: {
			packageVersion: "1.0.0",
			sourceCommit: input.artifactCommit ?? "artifact-commit",
			sourceTreeSha256: digest(input.artifact ?? "a"),
			tarballSha256: digest(input.artifact ?? "a"),
			unpackedManifestSha256: digest(input.artifact ?? "a"),
		},
		evaluator: {
			sourceCommit: input.evaluatorCommit ?? "evaluator-commit",
			caseCatalogSha256: digest("2"),
			policyCatalogSha256: digest("3"),
			graderBundleSha256: input.evaluatorDigest ?? digest("4"),
		},
		hostConfigSha256: input.host ?? digest("5"),
		actors: [
			{
				role: "manager",
				requestedModel: model,
				actualModel: { kind: "observed", value: model },
				sessionIds: ["session"],
			},
		],
		instructions: [
			{
				source: "command",
				name: "task",
				sequence: 0,
				sha256: input.instruction ?? digest("6"),
				bytes: 4,
			},
		],
		transcript: { sha256: digest("7"), artifact: "transcript.json" },
		outcome: {
			kind: "product",
			passed: pass,
			endedBy: "quiet",
			issues: pass ? [] : ["failed"],
			evidence: {
				kind: "conformance",
				falseCompletion: false,
				unsubmittedReviews: 0,
				facts: {},
			},
		},
		usage: { durationMs: 1, outputTokens: 1, costUsd: 0.01 },
	};
	const catalog = parseCaseCatalog([
		{
			caseId: "case",
			caseVersion,
			evidenceClass: "conformance",
			oracle: input.oracle ?? "durable-state",
			release: "report-only",
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: null,
			reviewerPromotionRecordSha256: null,
		},
	]);
	if (!catalog.ok) throw new Error("Catalog fixture failed.");
	const raw: EvalReportV2 = {
		schemaVersion: 2,
		reportId: "report",
		plan,
		attempts: [attempt],
		completion: {
			status: "complete",
			cause: "fixed-target",
			startedAt: "2026-08-25T00:00:00.000Z",
			finishedAt: "2026-08-25T00:00:00.001Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: 1,
				outputTokens: 1,
				costUsd: 0.01,
				wallClockMs: 1,
			},
		},
		allocationCommitmentSha256: null,
	};
	const report = parseReport(raw, catalog.value);
	if (!report.ok) throw new Error(JSON.stringify(report.issues));
	return { report: report.value, catalog: catalog.value };
}

function stoppedCoverageFixture(): Fixture {
	const base = fixture({ pass: false });
	const raw = EvalReportV2Schema.parse(base.report);
	const firstCell = raw.plan.cells[0];
	if (!firstCell) throw new Error("Expected comparison fixture cell.");
	raw.plan.cells.push(
		...[1, 2].map((index) => ({
			...firstCell,
			cellId: `cell-${index}`,
			blockId: `block-${index}`,
			repetition: index,
		})),
	);
	raw.plan.stoppingRule.count = 3;
	raw.plan.budget.maxAttempts = 3;
	raw.plan.planSha256 = campaignPlanSha256(raw.plan);
	const firstAttempt = raw.attempts[0];
	if (!firstAttempt) throw new Error("Expected comparison fixture attempt.");
	raw.attempts.push({
		...firstAttempt,
		attemptId: "attempt-1",
		cellId: "cell-1",
		blockId: "block-1",
		repetition: 1,
		actors: [],
		instructions: [],
		transcript: null,
		outcome: {
			kind: "failure",
			origin: "host",
			code: "host-failure",
			retryable: true,
		},
		usage: { durationMs: 1, outputTokens: 0, costUsd: 0.01 },
	});
	raw.completion = {
		...raw.completion,
		status: "stopped",
		cause: "host",
		observed: {
			attempts: 2,
			outputTokens: 1,
			costUsd: 0.02,
			wallClockMs: 1,
		},
	};
	const parsed = parseReport(raw, base.catalog);
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
	return { report: parsed.value, catalog: base.catalog };
}

function compare(baseline: Fixture, candidate: Fixture) {
	return compareReports({
		baseline: baseline.report,
		candidate: candidate.report,
		baselineCatalog: baseline.catalog,
		candidateCatalog: candidate.catalog,
	});
}

describe("report evidence cards", () => {
	test("renders planned coverage, failures, missing rows, and Wilson intervals", () => {
		const rendered = renderEvidence(stoppedCoverageFixture().report);
		expect(rendered.cards).toEqual([
			expect.objectContaining({
				caseId: "case",
				scheduled: 3,
				attempted: 2,
				missing: 1,
				products: 1,
				passed: 0,
				failedProducts: 1,
				operationalFailures: 1,
				unscored: 0,
				passRate: 0,
			}),
		]);
		expect(rendered.cards[0]?.interval95).not.toBeNull();
		expect(rendered.artifacts).toHaveLength(1);
		expect(rendered.evaluatorDigests).toHaveLength(1);
	});
});

describe("report comparison compatibility", () => {
	test("allows artifact and evaluator source commits to differ", () => {
		const baseline = fixture();
		const candidate = fixture({
			artifact: "b",
			artifactCommit: "new-artifact",
			evaluatorCommit: "new-evaluator-source",
			pass: false,
		});
		expect(compare(baseline, candidate)).toMatchObject({
			compatible: true,
			passDelta: -1,
			cases: [{ caseId: "case", delta: -1 }],
		});
	});

	test("rejects changed case versions", () => {
		expect(compare(fixture(), fixture({ caseVersion: 2 })).compatible).toBe(
			false,
		);
	});

	test("rejects changed analysis policy versions", () => {
		expect(
			compare(fixture(), fixture({ policyVersion: digest("9") })).compatible,
		).toBe(false);
	});

	test("rejects changed catalog oracle semantics", () => {
		expect(
			compare(fixture(), fixture({ oracle: "trajectory" })).compatible,
		).toBe(false);
	});

	test("rejects changed evaluator grader digests", () => {
		expect(
			compare(fixture(), fixture({ evaluatorDigest: digest("9") })).compatible,
		).toBe(false);
	});

	test("rejects changed host semantics", () => {
		expect(compare(fixture(), fixture({ host: digest("9") })).compatible).toBe(
			false,
		);
	});

	test("rejects changed requested actors or delivered instructions", () => {
		expect(compare(fixture(), fixture({ model: "other" })).compatible).toBe(
			false,
		);
		expect(
			compare(fixture(), fixture({ instruction: digest("9") })).compatible,
		).toBe(false);
	});

	test("breaks a longitudinal chain at the first semantic drift", () => {
		const first = fixture();
		const second = fixture({ artifact: "b" });
		const drifted = fixture({ host: digest("9") });
		const trend = compareTrend([first, second, drifted]);
		expect(trend.compatible).toBe(false);
		expect(trend.comparisons.map((item) => item.compatible)).toEqual([
			true,
			false,
		]);
	});

	test("produces a stable compatibility key", () => {
		const value = fixture();
		expect(comparisonKey(value)).toEqual(comparisonKey(value));
	});
});
