import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../evals/canonical-json.js";
import { parseCaseCatalog } from "../evals/catalog.js";
import {
	campaignPlanSha256,
	type EvalReportV2,
	parseReport,
	type ReportIssue,
} from "../evals/report.js";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

function modelIdentity(model = "test") {
	return {
		routeProvider: "openai",
		gateway: null,
		family: "gpt",
		model,
		revision: null,
	};
}

function caseCatalog() {
	const parsed = parseCaseCatalog([
		{
			caseId: "durable-plan",
			caseVersion: 1,
			evidenceClass: "conformance",
			oracle: "durable-state",
			release: "required",
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: 1,
			reviewerPromotionRecordSha256: null,
		},
	]);
	if (!parsed.ok) throw new Error("Fixture catalog must be valid.");
	return parsed.value;
}

function pairedCaseCatalog() {
	const parsed = parseCaseCatalog([
		{
			caseId: "paired-value",
			caseVersion: 1,
			evidenceClass: "paired-value",
			oracle: "hidden-executable",
			release: "report-only",
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: null,
			reviewerPromotionRecordSha256: null,
		},
	]);
	if (!parsed.ok) throw new Error("Paired fixture catalog must be valid.");
	return parsed.value;
}

function reviewerCaseCatalog() {
	const parsed = parseCaseCatalog([
		{
			caseId: "review-case",
			caseVersion: 1,
			evidenceClass: "reviewer-only",
			oracle: "fixed-review-label",
			release: "report-only",
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: null,
			reviewerPromotionRecordSha256: null,
		},
	]);
	if (!parsed.ok) throw new Error("Reviewer fixture catalog must be valid.");
	return parsed.value;
}

function report(paired = false): EvalReportV2 {
	const cells: EvalReportV2["plan"]["cells"] = paired
		? [
				{
					cellId: "cell-a",
					blockId: "block-1",
					caseId: "paired-value",
					caseVersion: 1,
					armToken: "opaque-a",
					repetition: 0,
					managerModel: modelIdentity(),
					reviewerModel: null,
					schedule: "primary",
				},
				{
					cellId: "cell-b",
					blockId: "block-1",
					caseId: "paired-value",
					caseVersion: 1,
					armToken: "opaque-b",
					repetition: 0,
					managerModel: modelIdentity(),
					reviewerModel: null,
					schedule: "primary",
				},
			]
		: [
				{
					cellId: "cell-a",
					blockId: "block-1",
					caseId: "durable-plan",
					caseVersion: 1,
					armToken: null,
					repetition: 0,
					managerModel: null,
					reviewerModel: null,
					schedule: "primary",
				},
			];
	const attempt = (
		cell: (typeof cells)[number],
		suffix: string,
	): EvalReportV2["attempts"][number] => ({
		schemaVersion: 2,
		attemptId: `attempt-${suffix}`,
		cellId: cell.cellId,
		blockId: cell.blockId,
		caseId: cell.caseId,
		caseVersion: cell.caseVersion,
		armToken: cell.armToken,
		repetition: cell.repetition,
		artifact: {
			packageVersion: "1.0.0",
			sourceCommit: "commit",
			sourceTreeSha256: digest("a"),
			tarballSha256: digest("b"),
			unpackedManifestSha256: digest("c"),
		},
		evaluator: {
			sourceCommit: "evaluator-commit",
			caseCatalogSha256: digest("d"),
			policyCatalogSha256: digest("e"),
			graderBundleSha256: digest("f"),
		},
		hostConfigSha256: digest("0"),
		actors: [
			{
				role: "manager",
				requestedModel: modelIdentity(),
				actualModel: {
					kind: "observed",
					value: modelIdentity(),
				},
				sessionIds: ["session-1"],
			},
		],
		instructions: [
			{
				source: "command",
				name: "eval",
				sequence: 0,
				sha256: digest("1"),
				bytes: 1,
			},
		],
		transcript: { sha256: digest("2"), artifact: "attempt.jsonl" },
		outcome: paired
			? {
					kind: "product",
					passed: true,
					endedBy: "quiet",
					issues: [],
					evidence: {
						kind: "paired-value",
						hiddenCorrectness: true,
						claimedComplete: true,
						falseCompletion: false,
					},
				}
			: {
					kind: "product",
					passed: true,
					endedBy: "quiet",
					issues: [],
					evidence: {
						kind: "conformance",
						falseCompletion: false,
						unsubmittedReviews: 0,
						facts: { durable: true },
					},
				},
		usage: { durationMs: 1, outputTokens: 1, costUsd: 0 },
	});
	const value: EvalReportV2 = {
		schemaVersion: 2,
		reportId: "report-1",
		plan: {
			schemaVersion: 1,
			planId: "plan-1",
			planSha256: digest("3"),
			randomizationSeed: "seed",
			cells,
			abortPolicy: {
				retry: paired ? "whole-pair" : "never",
				maxReplacementBlocks: 0,
			},
			stoppingRule: {
				kind: paired ? "fixed-complete-pairs" : "fixed-attempts",
				count: 1,
			},
			analysis: paired
				? {
						kind: "paired",
						primaryOutcome: "hidden-correctness",
						estimand: "candidate-minus-baseline-risk-difference",
						interval: "task-stratified-paired-bootstrap",
						alpha: 0.05,
						targetPower: 0.8,
						minimumDetectableEffect: 0.1,
						tieRule: "zero-difference",
						bootstrapSeed: "seed",
						versionSha256: digest("4"),
					}
				: { kind: "rate", primaryOutcome: "pass", versionSha256: digest("4") },
			budget: {
				maxUsd: 1,
				unknownCostPolicy: "stop",
				maxOutputTokens: 10,
				maxWallClockMs: 2_000,
				maxAttempts: paired ? 2 : 1,
			},
		},
		attempts: cells.map((cell, index) => attempt(cell, `${index}`)),
		completion: {
			status: "complete",
			cause: "fixed-target",
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: "2026-01-01T00:00:01.000Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: cells.length,
				outputTokens: cells.length,
				costUsd: 0,
				wallClockMs: 1_000,
			},
		},
		allocationCommitmentSha256: paired ? digest("5") : null,
	};
	value.plan.planSha256 = campaignPlanSha256(value.plan);
	return value;
}

function result(input: unknown, catalog = caseCatalog()) {
	return parseReport(input, catalog);
}

function invalidIssues(
	input: unknown,
	catalog = caseCatalog(),
): readonly ReportIssue[] {
	const parsed = result(input, catalog);
	expect(parsed.ok).toBe(false);
	if (parsed.ok) throw new Error("Expected an invalid report.");
	return parsed.issues;
}

function rehash(value: EvalReportV2): EvalReportV2 {
	value.plan.planSha256 = campaignPlanSha256(value.plan);
	return value;
}

function addReplacementPair(value: EvalReportV2) {
	const cells = value.plan.cells.map((cell, index) => ({
		...cell,
		cellId: `reserve-${index}`,
		blockId: "block-2",
		repetition: 1,
		schedule: "replacement-reserve" as const,
	}));
	value.plan.cells.push(...cells);
	value.plan.abortPolicy.maxReplacementBlocks = 1;
	value.plan.budget.maxAttempts += 2;
	return { value: rehash(value), cells };
}

function reviewerReport(): EvalReportV2 {
	const value = report();
	itemAt(value.plan.cells, 0).caseId = "review-case";
	const attempt = itemAt(value.attempts, 0);
	attempt.caseId = "review-case";
	itemAt(attempt.actors, 0).role = "reviewer";
	attempt.outcome = {
		kind: "product",
		passed: true,
		endedBy: "quiet",
		issues: [],
		evidence: {
			kind: "reviewer-only",
			truth: "clean",
			verdict: "passed",
			findings: [],
			submitted: true,
		},
	};
	value.plan.analysis = {
		kind: "reviewer",
		interval: "wilson",
		alpha: 0.05,
		versionSha256: digest("4"),
	};
	return rehash(value);
}

function itemAt<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing fixture item ${index}.`);
	return value;
}

describe("eval report boundary", () => {
	test("accepts a complete ledger and derives a canonical plan hash", () => {
		const value = report();
		const parsed = result(value);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.value.plan.planSha256).toBe(campaignPlanSha256(value.plan));
			expect(Object.isFrozen(parsed.value)).toBe(true);
			expect(Object.isFrozen(parsed.value.plan.cells)).toBe(true);
			expect(Object.isFrozen(itemAt(parsed.value.plan.cells, 0))).toBe(true);
			expect(Reflect.set(parsed.value.plan, "planId", "changed")).toBe(false);
		}
	});

	test("accepts a complete paired ledger with paired policy and evidence", () => {
		expect(result(report(true), pairedCaseCatalog()).ok).toBe(true);
	});

	test("rejects summary-only qualification and legacy v1 shapes", () => {
		const summaryOnly = result({
			schemaVersion: 2,
			reportId: "summary",
			summary: { passed: true },
		});
		expect(summaryOnly).toEqual({
			ok: false,
			issues: expect.arrayContaining([
				{ path: "$.plan", code: "missing", message: "Missing required value." },
			]),
		});
		const legacy = result({ schemaVersion: 1, reportId: "legacy", runs: [] });
		expect(legacy.ok).toBe(false);
	});

	test("rejects missing data, unknown cases, duplicate ids, and case version drift", () => {
		const { attempts: _attempts, ...missing } = report();
		expect(invalidIssues(missing)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "missing" })]),
		);
		const unknown = report();
		itemAt(unknown.plan.cells, 0).caseId = "unknown";
		itemAt(unknown.attempts, 0).caseId = "unknown";
		unknown.plan.planSha256 = campaignPlanSha256(unknown.plan);
		expect(invalidIssues(unknown)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ message: "Unknown case id and version." }),
			]),
		);
		const duplicate = report();
		duplicate.attempts.push({ ...itemAt(duplicate.attempts, 0) });
		duplicate.completion.observed.attempts = 2;
		expect(invalidIssues(duplicate)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "duplicate" })]),
		);
		const duplicateCell = report();
		duplicateCell.plan.cells.push({ ...itemAt(duplicateCell.plan.cells, 0) });
		duplicateCell.plan.planSha256 = campaignPlanSha256(duplicateCell.plan);
		expect(invalidIssues(duplicateCell)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "duplicate" })]),
		);
		const drift = report();
		itemAt(drift.attempts, 0).caseVersion = 2;
		expect(invalidIssues(drift)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: "Attempt does not match its scheduled cell.",
				}),
			]),
		);
	});

	test("rejects pair mismatch and a mutated plan hash", () => {
		const paired = report(true);
		itemAt(paired.attempts, 1).armToken = "opaque-a";
		expect(invalidIssues(paired)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "policy" })]),
		);
		const changedPlan = report();
		changedPlan.plan.randomizationSeed = "another-seed";
		expect(invalidIssues(changedPlan)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "hash" })]),
		);
	});

	test("rejects non-finite and out-of-range values", () => {
		const nonFinite = report();
		itemAt(nonFinite.attempts, 0).usage.durationMs = Number.NaN;
		expect(invalidIssues(nonFinite)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "schema" })]),
		);
		const outOfRange = report(true);
		if (outOfRange.plan.analysis.kind === "paired")
			outOfRange.plan.analysis.targetPower = 1.1;
		expect(invalidIssues(outOfRange)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "schema" })]),
		);
		const zeroEffect = report(true);
		if (zeroEffect.plan.analysis.kind === "paired")
			zeroEffect.plan.analysis.minimumDetectableEffect = 0;
		expect(invalidIssues(zeroEffect, pairedCaseCatalog())).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "schema" })]),
		);
		const reviewerAlpha = reviewerReport();
		if (reviewerAlpha.plan.analysis.kind === "reviewer")
			Reflect.set(reviewerAlpha.plan.analysis, "alpha", 0.1);
		expect(invalidIssues(reviewerAlpha, reviewerCaseCatalog())).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "schema" })]),
		);
	});

	test("uses canonical Unicode JSON and rejects lone surrogates", () => {
		expect(
			canonicalJson({ "€": "Euro", "\r": "CR", "1": "One", "😀": "Emoji" }),
		).toBe('{"\\r":"CR","1":"One","€":"Euro","😀":"Emoji"}');
		expect(() => canonicalJson("\ud800")).toThrow(
			"Canonical JSON requires Unicode scalar values.",
		);
		expect(() => canonicalJson(new Date(0))).toThrow(
			"Canonical JSON requires plain JSON objects.",
		);
		expect(() => canonicalJson(new Array(1))).toThrow(
			"Canonical JSON requires dense arrays.",
		);
		const disguisedSparse = new Array(2);
		disguisedSparse[0] = 1;
		Reflect.set(disguisedSparse, "extra", true);
		expect(() => canonicalJson(disguisedSparse)).toThrow(
			"Canonical JSON requires dense arrays.",
		);
		const value = report();
		value.plan.planId = "\ud800";
		expect(invalidIssues(value)).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "schema" })]),
		);
	});

	test("rejects invalid finalization and incompatible product evidence", () => {
		const finalization = report();
		finalization.completion.cause = "provider";
		expect(invalidIssues(finalization)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: "Complete campaigns require fixed-target cause.",
				}),
			]),
		);
		const evidence = report();
		itemAt(evidence.attempts, 0).outcome = {
			kind: "product",
			passed: true,
			endedBy: "quiet",
			issues: [],
			evidence: {
				kind: "regression",
				falseCompletion: false,
				unsubmittedReviews: 0,
				facts: {},
			},
		};
		expect(invalidIssues(evidence)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message:
						"Product evidence kind is incompatible with the case evidence class.",
				}),
			]),
		);
	});

	test("validates catalog policy and ledger provenance", () => {
		const calibration = parseCaseCatalog([
			{
				caseId: "review",
				caseVersion: 1,
				evidenceClass: "reviewer-only",
				oracle: "fixed-review-label",
				release: "report-only",
				minProviders: 1,
				minScoredAttempts: 1,
				minPassRate: null,
				reviewerPromotionRecordSha256: null,
			},
		]);
		expect(calibration.ok).toBe(true);
		if (calibration.ok) {
			expect(Object.isFrozen(calibration.value)).toBe(true);
			expect(Object.isFrozen(itemAt(calibration.value, 0))).toBe(true);
		}
		const provenance = report();
		const firstAttempt = itemAt(provenance.attempts, 0);
		firstAttempt.actors.push({ ...itemAt(firstAttempt.actors, 0) });
		firstAttempt.instructions.push({ ...itemAt(firstAttempt.instructions, 0) });
		provenance.completion.activatedReserveCellIds.push("cell-a");
		expect(invalidIssues(provenance)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "provenance" }),
				expect.objectContaining({
					message:
						"Activated reserve ids must reference replacement reserve cells.",
				}),
			]),
		);
	});

	test("rejects incompatible catalog policies", () => {
		const base = {
			caseId: "case",
			caseVersion: 1,
			evidenceClass: "conformance" as const,
			oracle: "durable-state" as const,
			release: "required" as const,
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: 1,
			reviewerPromotionRecordSha256: null,
		};
		for (const input of [
			[{ ...base, minPassRate: null }],
			[{ ...base, oracle: "fixed-review-label" }],
			[
				{
					...base,
					evidenceClass: "paired-value",
					oracle: "trajectory",
					release: "report-only",
					minPassRate: null,
				},
			],
			[
				{
					...base,
					evidenceClass: "reviewer-only",
					oracle: "fixed-review-label",
					reviewerPromotionRecordSha256: null,
				},
			],
			[base, { ...base }],
			[{ ...base, caseId: "\ud800" }],
		]) {
			expect(parseCaseCatalog(input).ok).toBe(false);
		}
	});

	test("enforces hard report invariants", () => {
		const mutations = [
			{
				name: "empty product actors",
				value: () => {
					const value = report();
					itemAt(value.attempts, 0).actors = [];
					return value;
				},
				message:
					"Product and unscored attempts require actors and instructions.",
			},
			{
				name: "completion tokens",
				value: () => {
					const value = report();
					value.completion.observed.outputTokens = 0;
					return value;
				},
				message: "Observed output tokens must equal the attempt total.",
			},
			{
				name: "completion cost",
				value: () => {
					const value = report();
					value.completion.observed.costUsd = 1;
					return value;
				},
				message:
					"Observed cost must be null for unknown attempt costs or equal their total.",
			},
			{
				name: "duplicate reserve activation",
				value: () => {
					const value = report();
					value.plan.cells.push({
						...itemAt(value.plan.cells, 0),
						cellId: "reserve",
						schedule: "replacement-reserve",
					});
					value.completion.activatedReserveCellIds = ["reserve", "reserve"];
					return rehash(value);
				},
				message: "Duplicate activated reserve cell id.",
			},
			{
				name: "paired model mismatch",
				catalog: pairedCaseCatalog,
				value: () => {
					const value = report(true);
					itemAt(value.plan.cells, 1).managerModel = {
						routeProvider: "openai",
						gateway: null,
						family: "gpt",
						model: "different",
						revision: null,
					};
					return rehash(value);
				},
				message: "Invalid paired block block-1.",
			},
			{
				name: "attempt scheduled model mismatch",
				catalog: pairedCaseCatalog,
				value: () => {
					const value = report(true);
					const attempt = itemAt(value.attempts, 0);
					const manager = attempt.actors.find(
						(actor) => actor.role === "manager",
					);
					if (manager) manager.requestedModel.model = "different";
					return value;
				},
				message: "Requested manager model does not match its scheduled cell.",
			},
			{
				name: "plan count",
				value: () => {
					const value = report();
					value.plan.stoppingRule.count = 2;
					return rehash(value);
				},
				message: "Fixed-attempt count must equal the primary cell count.",
			},
			{
				name: "plan budget",
				value: () => {
					const value = report();
					value.plan.cells.push({
						...itemAt(value.plan.cells, 0),
						cellId: "cell-b",
						blockId: "block-2",
					});
					value.plan.stoppingRule.count = 2;
					return rehash(value);
				},
				message: "Maximum attempts cannot be below the primary cell count.",
			},
			{
				name: "output token budget",
				value: () => {
					const value = report();
					value.plan.budget.maxOutputTokens = 0;
					return rehash(value);
				},
				message: "Exceeded or unverifiable budget requires a budget stop.",
			},
			{
				name: "wall clock budget",
				value: () => {
					const value = report();
					value.plan.budget.maxWallClockMs = 0;
					return rehash(value);
				},
				message: "Exceeded or unverifiable budget requires a budget stop.",
			},
			{
				name: "wall clock lower bound",
				value: () => {
					const value = report();
					itemAt(value.attempts, 0).usage.durationMs = 2_001;
					return value;
				},
				message:
					"Observed wall clock cannot be shorter than elapsed campaign time or its longest attempt.",
			},
			{
				name: "wall clock timestamp lower bound",
				value: () => {
					const value = report();
					value.completion.finishedAt = "2026-01-01T01:00:00.000Z";
					return value;
				},
				message:
					"Observed wall clock cannot be shorter than elapsed campaign time or its longest attempt.",
			},
			{
				name: "cost budget",
				value: () => {
					const value = report();
					itemAt(value.attempts, 0).usage.costUsd = 0.02;
					value.completion.observed.costUsd = 0.02;
					value.plan.budget.maxUsd = 0.01;
					return rehash(value);
				},
				message: "Exceeded or unverifiable budget requires a budget stop.",
			},
			{
				name: "unknown cost stop policy",
				value: () => {
					const value = report();
					itemAt(value.attempts, 0).usage.costUsd = null;
					value.completion.observed.costUsd = null;
					return value;
				},
				message: "Exceeded or unverifiable budget requires a budget stop.",
			},
			{
				name: "unsafe transcript artifact",
				value: () => {
					const value = report();
					const attempt = itemAt(value.attempts, 0);
					if (attempt.transcript)
						attempt.transcript.artifact = "../attempt.jsonl";
					return value;
				},
				message: "Invalid report value.",
			},
			{
				name: "missing product transcript",
				value: () => {
					const value = report();
					itemAt(value.attempts, 0).transcript = null;
					return value;
				},
				message:
					"Product and escalation attempts require a transcript artifact.",
			},
			{
				name: "passed issues",
				value: () => {
					const value = report();
					const attempt = itemAt(value.attempts, 0);
					if (attempt.outcome.kind === "product")
						attempt.outcome.issues.push("issue");
					return value;
				},
				message: "Passed product attempts cannot carry issues.",
			},
			{
				name: "failed product without issues",
				value: () => {
					const value = report();
					const attempt = itemAt(value.attempts, 0);
					if (attempt.outcome.kind === "product")
						attempt.outcome.passed = false;
					return value;
				},
				message: "Failed product attempts require at least one issue.",
			},
			{
				name: "unsubmitted reviewer verdict",
				catalog: reviewerCaseCatalog,
				value: () => {
					const value = reviewerReport();
					const attempt = itemAt(value.attempts, 0);
					if (
						attempt.outcome.kind === "product" &&
						attempt.outcome.evidence.kind === "reviewer-only"
					) {
						attempt.outcome.evidence.submitted = false;
					}
					return value;
				},
				message: "Reviewer submission and verdict must be present together.",
			},
			{
				name: "contradictory paired evidence",
				catalog: pairedCaseCatalog,
				value: () => {
					const value = report(true);
					const attempt = itemAt(value.attempts, 0);
					if (
						attempt.outcome.kind === "product" &&
						attempt.outcome.evidence.kind === "paired-value"
					) {
						attempt.outcome.evidence.hiddenCorrectness = false;
					}
					return value;
				},
				message: "Paired product outcome must agree with its hidden evidence.",
			},
			{
				name: "contradictory reviewer outcome",
				catalog: reviewerCaseCatalog,
				value: () => {
					const value = reviewerReport();
					const attempt = itemAt(value.attempts, 0);
					if (
						attempt.outcome.kind === "product" &&
						attempt.outcome.evidence.kind === "reviewer-only"
					) {
						attempt.outcome.evidence.verdict = "failed";
					}
					return value;
				},
				message:
					"Reviewer outcome must agree with the fixed truth label and verdict.",
			},
			{
				name: "missing complete primary attempt",
				value: () => {
					const value = report();
					value.attempts = [];
					value.completion.observed = {
						attempts: 0,
						outputTokens: 0,
						costUsd: 0,
						wallClockMs: 1,
					};
					return value;
				},
				message: "Complete campaign is missing attempt for cell cell-a.",
			},
		];
		for (const mutation of mutations) {
			expect(invalidIssues(mutation.value(), mutation.catalog?.())).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ message: mutation.message }),
				]),
			);
		}
	});

	test("accepts correct defect detection and rejects non-paired retries", () => {
		const detected = reviewerReport();
		const reviewerAttempt = itemAt(detected.attempts, 0);
		if (
			reviewerAttempt.outcome.kind === "product" &&
			reviewerAttempt.outcome.evidence.kind === "reviewer-only"
		) {
			reviewerAttempt.outcome.evidence.truth = "defect";
			reviewerAttempt.outcome.evidence.verdict = "failed";
			reviewerAttempt.outcome.evidence.findings = ["known defect"];
		}
		expect(result(detected, reviewerCaseCatalog()).ok).toBe(true);

		const retry = report();
		retry.plan.cells.push({
			...itemAt(retry.plan.cells, 0),
			cellId: "reserve",
			blockId: "block-2",
			schedule: "replacement-reserve",
		});
		retry.plan.abortPolicy.retry = "whole-pair";
		retry.plan.abortPolicy.maxReplacementBlocks = 1;
		retry.plan.budget.maxAttempts = 2;
		expect(invalidIssues(rehash(retry))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: "Non-paired campaigns cannot declare replacement retries.",
				}),
			]),
		);
	});

	test("requires scored targets and whole-pair reserve activation", () => {
		const failedPair = report(true);
		const failedAttempt = itemAt(failedPair.attempts, 0);
		failedAttempt.outcome = {
			kind: "failure",
			origin: "provider",
			code: "unavailable",
			retryable: true,
		};
		expect(invalidIssues(failedPair, pairedCaseCatalog())).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message:
						"Complete campaign must reach its fixed scored-outcome target exactly.",
				}),
			]),
		);

		const partial = addReplacementPair(report(true));
		partial.value.completion.activatedReserveCellIds = [
			itemAt(partial.cells, 0).cellId,
		];
		expect(invalidIssues(partial.value, pairedCaseCatalog())).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message:
						"Replacement block block-2 must be activated as a whole pair.",
				}),
			]),
		);
	});

	test("accepts a complete whole-pair replacement", () => {
		const replacement = addReplacementPair(report(true));
		const templates = replacement.value.attempts.map((attempt) =>
			structuredClone(attempt),
		);
		itemAt(replacement.value.attempts, 0).outcome = {
			kind: "failure",
			origin: "provider",
			code: "unavailable",
			retryable: true,
		};
		for (const [index, cell] of replacement.cells.entries()) {
			const attempt = itemAt(templates, index);
			attempt.attemptId = `replacement-${index}`;
			attempt.cellId = cell.cellId;
			attempt.blockId = cell.blockId;
			attempt.repetition = cell.repetition;
			replacement.value.attempts.push(attempt);
		}
		replacement.value.completion.activatedReserveCellIds =
			replacement.cells.map((cell) => cell.cellId);
		replacement.value.completion.observed.attempts = 4;
		replacement.value.completion.observed.outputTokens = 4;
		expect(result(replacement.value, pairedCaseCatalog()).ok).toBe(true);
	});

	test("allows empty failure provenance before any model turn", () => {
		const value = report();
		const attempt = itemAt(value.attempts, 0);
		attempt.actors = [];
		attempt.instructions = [];
		attempt.transcript = null;
		attempt.outcome = {
			kind: "failure",
			origin: "provider",
			code: "unavailable",
			retryable: true,
		};
		value.completion.status = "stopped";
		value.completion.cause = "provider";
		expect(result(value).ok).toBe(true);
	});

	test("accepts normal floating-point cost accumulation", () => {
		const value = report(true);
		itemAt(value.attempts, 0).usage.costUsd = 0.1;
		itemAt(value.attempts, 1).usage.costUsd = 0.2;
		value.completion.observed.costUsd = 0.3;
		expect(result(value, pairedCaseCatalog()).ok).toBe(true);
	});

	test("accepts an honestly stopped partial campaign", () => {
		const value = report();
		value.attempts = [];
		value.completion = {
			status: "stopped",
			cause: "provider",
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: "2026-01-01T00:00:01.000Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: 0,
				outputTokens: 0,
				costUsd: 0,
				wallClockMs: 1_000,
			},
		};
		expect(result(value).ok).toBe(true);
	});

	test("accepts an honest unknown-cost budget stop", () => {
		const value = report();
		itemAt(value.attempts, 0).usage.costUsd = null;
		value.completion.observed.costUsd = null;
		value.completion.status = "stopped";
		value.completion.cause = "budget";
		expect(result(value).ok).toBe(true);
	});

	test("rejects a stopped campaign after the scored target", () => {
		const value = report();
		value.completion.status = "stopped";
		value.completion.cause = "provider";
		expect(invalidIssues(value)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message:
						"Stopped campaign cannot have reached its fixed scored-outcome target.",
				}),
			]),
		);
	});
});
