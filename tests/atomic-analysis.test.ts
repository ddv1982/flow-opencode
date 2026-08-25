import { describe, expect, test } from "bun:test";
import {
	analyzePairs,
	compareExpectedProvenance,
	deriveReleaseDecision,
	type ExpectedActorProvenance,
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

type RateRow = {
	readonly provider: string;
	readonly outcome:
		| {
				readonly kind: "product";
				readonly passed: boolean;
				readonly falseCompletion?: boolean;
				readonly unsubmittedReviews?: number;
		  }
		| { readonly kind: "unscored" }
		| { readonly kind: "failure" };
};

function rateOutcome(row: RateRow) {
	if (row.outcome.kind === "unscored") {
		return {
			kind: "unscored-escalation" as const,
			reason: "Needs evaluator input.",
		};
	}
	if (row.outcome.kind === "failure") {
		return {
			kind: "failure" as const,
			origin: "evaluator" as const,
			code: "fixture-failure",
			retryable: false,
		};
	}
	return {
		kind: "product" as const,
		passed: row.outcome.passed,
		endedBy: "quiet" as const,
		issues: row.outcome.passed ? [] : ["fixture product failure"],
		evidence: {
			kind: "conformance" as const,
			falseCompletion: row.outcome.falseCompletion ?? false,
			unsubmittedReviews: row.outcome.unsubmittedReviews ?? 0,
			facts: { fixture: true },
		},
	};
}

function rateCatalog(
	overrides: {
		extraRequired?: boolean;
		minProviders?: number;
		minScoredAttempts?: number;
		minPassRate?: number;
	} = {},
) {
	return [
		{
			caseId: "rate-case",
			caseVersion: 1,
			evidenceClass: "conformance",
			oracle: "durable-state",
			release: "required",
			minProviders: overrides.minProviders ?? 2,
			minScoredAttempts: overrides.minScoredAttempts ?? 1,
			minPassRate: overrides.minPassRate ?? 1,
			reviewerPromotionRecordSha256: null,
		},
		...(overrides.extraRequired
			? [
					{
						caseId: "unplanned-case",
						caseVersion: 1,
						evidenceClass: "regression",
						oracle: "hidden-executable",
						release: "required",
						minProviders: 1,
						minScoredAttempts: 1,
						minPassRate: 1,
						reviewerPromotionRecordSha256: null,
					},
				]
			: []),
	];
}

function buildRateReport(
	rows: readonly RateRow[] = [
		{ provider: "provider-a", outcome: { kind: "product", passed: true } },
		{ provider: "provider-b", outcome: { kind: "product", passed: true } },
	],
) {
	const cells = rows.map((row, index) => ({
		cellId: `rate-cell-${index}`,
		blockId: `rate-block-${index}`,
		caseId: "rate-case",
		caseVersion: 1,
		armToken: null,
		repetition: index,
		managerModel: v2Model(row.provider),
		reviewerModel: null,
		schedule: "primary" as const,
	}));
	const attempts = rows.map((row, index) => {
		const model = v2Model(row.provider);
		return {
			schemaVersion: 2 as const,
			attemptId: `rate-attempt-${index}`,
			cellId: `rate-cell-${index}`,
			blockId: `rate-block-${index}`,
			caseId: "rate-case",
			caseVersion: 1,
			armToken: null,
			repetition: index,
			artifact: V2_ARTIFACT_A,
			evaluator: V2_EVALUATOR,
			hostConfigSha256: DIGEST_D,
			actors:
				row.outcome.kind === "failure"
					? []
					: [
							{
								role: "manager" as const,
								requestedModel: model,
								actualModel: { kind: "observed" as const, value: model },
								sessionIds: [`session-${index}`],
							},
						],
			instructions: row.outcome.kind === "failure" ? [] : V2_INSTRUCTIONS,
			transcript:
				row.outcome.kind === "failure"
					? null
					: { sha256: DIGEST_A, artifact: `transcripts/rate-${index}.json` },
			outcome: rateOutcome(row),
			usage: { durationMs: 100, outputTokens: 10, costUsd: 0.1 },
		};
	});
	const productCount = attempts.filter(
		(attempt) => attempt.outcome.kind === "product",
	).length;
	const complete = productCount === cells.length;
	const plan = {
		schemaVersion: 1 as const,
		planId: "rate-plan",
		planSha256: DIGEST_A,
		randomizationSeed: "rate-seed",
		cells,
		abortPolicy: { retry: "never" as const, maxReplacementBlocks: 0 },
		stoppingRule: { kind: "fixed-attempts" as const, count: cells.length },
		analysis: {
			kind: "rate" as const,
			primaryOutcome: "product-pass",
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
		reportId: "rate-report",
		plan,
		attempts,
		completion: {
			status: complete ? ("complete" as const) : ("stopped" as const),
			cause: complete ? ("fixed-target" as const) : ("evaluator" as const),
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
		attempts: report.attempts.map((attempt) => ({
			cellId: attempt.cellId,
			hostConfigSha256: attempt.hostConfigSha256,
			actors: attempt.actors.map(expectedActor),
			instructions: attempt.instructions,
		})),
	};
}

function parsedRate(
	rows?: readonly RateRow[],
	catalogInput: unknown = rateCatalog(),
) {
	const catalog = mustCatalog(catalogInput);
	const report = mustReport(buildRateReport(rows), catalog);
	return { catalog, report, expected: releaseExpected(report) };
}

describe("v2 atomic release decisions", () => {
	test("derives all three verdicts without pooling providers", () => {
		const verified = parsedRate();
		expect(deriveReleaseDecision(verified)).toMatchObject({
			verdict: "VERIFIED",
			reasons: [],
			totals: { scheduled: 2, scored: 2, passed: 2 },
			cases: [
				{
					representedProviders: 2,
					providers: [
						{ provider: "provider-a", passRate: 1 },
						{ provider: "provider-b", passRate: 1 },
					],
				},
			],
		});
		expect(analyzePairs(verified.report)).toEqual({
			eligible: 0,
			complete: 0,
			incomplete: 0,
			ties: 0,
			opaqueArmWins: [],
		});

		const failed = parsedRate([
			{ provider: "provider-a", outcome: { kind: "product", passed: false } },
			{ provider: "provider-b", outcome: { kind: "product", passed: true } },
		]);
		expect(deriveReleaseDecision(failed)).toMatchObject({
			verdict: "NOT VERIFIED",
			totals: { scheduled: 2, scored: 2, passed: 1 },
		});
		expect(
			deriveReleaseDecision(failed).reasons.map((reason) => reason.code),
		).toContain("below-pass-rate");

		const stopped = parsedRate([
			{ provider: "provider-a", outcome: { kind: "unscored" } },
			{ provider: "provider-b", outcome: { kind: "product", passed: true } },
		]);
		expect(deriveReleaseDecision(stopped).verdict).toBe("INCONCLUSIVE");
		expect(
			deriveReleaseDecision(stopped).reasons.map((reason) => reason.code),
		).toEqual(
			expect.arrayContaining([
				"campaign-stopped",
				"unscored-attempt",
				"sample-gap",
			]),
		);
	});

	test("uses hard reasons before stop and sampling gaps", () => {
		const fixture = parsedRate([
			{
				provider: "provider-a",
				outcome: { kind: "product", passed: true, falseCompletion: true },
			},
			{ provider: "provider-b", outcome: { kind: "unscored" } },
		]);
		const decision = deriveReleaseDecision(fixture);
		expect(decision.verdict).toBe("NOT VERIFIED");
		expect(decision.reasons.map((reason) => reason.code)).toEqual(
			expect.arrayContaining(["false-completion", "campaign-stopped"]),
		);
	});

	test("accepts distinct frozen host configurations for different model cells", () => {
		const raw = buildRateReport();
		const second = raw.attempts[1];
		if (second === undefined)
			throw new Error("Expected second provider attempt.");
		second.hostConfigSha256 = DIGEST_A;
		const catalog = mustCatalog(rateCatalog());
		const report = mustReport(raw, catalog);
		expect(
			deriveReleaseDecision({
				report,
				catalog,
				expected: releaseExpected(report),
			}).verdict,
		).toBe("VERIFIED");
	});

	test("keeps report-only stops and provenance out of the release verdict", () => {
		const raw = buildRateReport();
		const cell = structuredClone(raw.plan.cells[0]);
		const attempt = structuredClone(raw.attempts[0]);
		if (cell === undefined || attempt === undefined) {
			throw new Error("Expected rate fixture row.");
		}
		Object.assign(cell, {
			cellId: "report-only-cell",
			blockId: "report-only-block",
			caseId: "report-only-case",
			repetition: 2,
			managerModel: v2Model("report-only-provider"),
		});
		Object.assign(attempt, {
			attemptId: "report-only-attempt",
			cellId: cell.cellId,
			blockId: cell.blockId,
			caseId: cell.caseId,
			repetition: cell.repetition,
			artifact: { kind: "ordinary-opencode" },
			actors: [],
			instructions: [],
			transcript: null,
			outcome: {
				kind: "failure",
				origin: "evaluator",
				code: "report-only-stop",
				retryable: false,
			},
		});
		raw.plan.cells.push(cell);
		raw.plan.stoppingRule.count = 3;
		raw.plan.budget.maxAttempts = 3;
		raw.plan.planSha256 = campaignPlanSha256(
			CampaignPlanSchema.parse(raw.plan),
		);
		raw.attempts.push(attempt);
		Reflect.set(raw.completion, "status", "stopped");
		Reflect.set(raw.completion, "cause", "evaluator");
		raw.completion.observed.attempts = 3;
		raw.completion.observed.outputTokens = 30;
		raw.completion.observed.costUsd = 0.3;
		const catalog = mustCatalog([
			...rateCatalog(),
			{
				caseId: "report-only-case",
				caseVersion: 1,
				evidenceClass: "conformance",
				oracle: "durable-state",
				release: "report-only",
				minProviders: 1,
				minScoredAttempts: 1,
				minPassRate: null,
				reviewerPromotionRecordSha256: null,
			},
		]);
		const report = mustReport(raw, catalog);
		expect(
			deriveReleaseDecision({
				report,
				catalog,
				expected: releaseExpected(report),
			}).verdict,
		).toBe("VERIFIED");
	});

	test("uses product failures as rate inputs and rejects unsubmitted reviews", () => {
		const measured = parsedRate(
			[
				{ provider: "provider-a", outcome: { kind: "product", passed: true } },
				{ provider: "provider-a", outcome: { kind: "product", passed: false } },
			],
			rateCatalog({ minProviders: 1, minScoredAttempts: 2, minPassRate: 0.5 }),
		);
		expect(deriveReleaseDecision(measured).verdict).toBe("VERIFIED");

		const unsubmitted = parsedRate([
			{
				provider: "provider-a",
				outcome: { kind: "product", passed: true, unsubmittedReviews: 1 },
			},
			{ provider: "provider-b", outcome: { kind: "product", passed: true } },
		]);
		const decision = deriveReleaseDecision(unsubmitted);
		expect(decision.verdict).toBe("NOT VERIFIED");
		expect(decision.reasons.map((reason) => reason.code)).toContain(
			"unsubmitted-review",
		);
	});

	test("refuses an unplanned required case", () => {
		const fixture = parsedRate(undefined, rateCatalog({ extraRequired: true }));
		const decision = deriveReleaseDecision(fixture);
		expect(decision.verdict).toBe("NOT VERIFIED");
		expect(decision.reasons).toContainEqual(
			expect.objectContaining({
				code: "unplanned-required-case",
				caseId: "unplanned-case",
			}),
		);
	});

	test("counts providers from the frozen scheduled route", () => {
		const fixture = parsedRate([
			{ provider: "provider-a", outcome: { kind: "product", passed: true } },
			{ provider: "provider-a", outcome: { kind: "product", passed: true } },
		]);
		const decision = deriveReleaseDecision(fixture);
		expect(decision.verdict).toBe("INCONCLUSIVE");
		expect(decision.cases[0]).toMatchObject({ representedProviders: 1 });
		expect(decision.reasons.map((reason) => reason.code)).toContain(
			"provider-gap",
		);

		const raw = buildRateReport();
		for (const cell of raw.plan.cells) Reflect.set(cell, "managerModel", null);
		raw.plan.planSha256 = campaignPlanSha256(
			CampaignPlanSchema.parse(raw.plan),
		);
		const catalog = mustCatalog(rateCatalog());
		const report = mustReport(raw, catalog);
		expect(
			deriveReleaseDecision({
				report,
				catalog,
				expected: releaseExpected(report),
			}).verdict,
		).toBe("VERIFIED");
		const drifted = buildRateReport();
		const actor = drifted.attempts[0]?.actors[0];
		if (actor === undefined) throw new Error("Expected manager actor.");
		Reflect.set(actor, "actualModel", {
			kind: "observed",
			value: v2Model("actual-provider"),
		});
		const driftedReport = mustReport(drifted, catalog);
		const driftedDecision = deriveReleaseDecision({
			report: driftedReport,
			catalog,
			expected: releaseExpected(driftedReport),
		});
		expect(driftedDecision.verdict).toBe("VERIFIED");
		expect(driftedDecision.cases[0]?.providers[0]?.provider).toBe("provider-a");
	});

	test("deleting or downgrading required rows cannot remain verified", () => {
		const mutations = [
			{
				name: "delete provider-a row",
				rows: [
					{
						provider: "provider-b",
						outcome: { kind: "product", passed: true },
					},
				] satisfies readonly RateRow[],
			},
			{
				name: "delete provider-b row",
				rows: [
					{
						provider: "provider-a",
						outcome: { kind: "product", passed: true },
					},
				] satisfies readonly RateRow[],
			},
			{
				name: "downgrade to product failure",
				rows: [
					{
						provider: "provider-a",
						outcome: { kind: "product", passed: false },
					},
					{
						provider: "provider-b",
						outcome: { kind: "product", passed: true },
					},
				] satisfies readonly RateRow[],
			},
			{
				name: "downgrade to unscored",
				rows: [
					{ provider: "provider-a", outcome: { kind: "unscored" } },
					{
						provider: "provider-b",
						outcome: { kind: "product", passed: true },
					},
				] satisfies readonly RateRow[],
			},
		];
		for (const mutation of mutations) {
			expect(
				deriveReleaseDecision(parsedRate(mutation.rows)).verdict,
				mutation.name,
			).not.toBe("VERIFIED");
		}
		const raw = buildRateReport();
		raw.attempts.splice(0, 1);
		Reflect.set(raw.completion, "status", "stopped");
		Reflect.set(raw.completion, "cause", "provider");
		raw.completion.observed.attempts = 1;
		raw.completion.observed.outputTokens = 10;
		raw.completion.observed.costUsd = 0.1;
		const catalog = mustCatalog(rateCatalog());
		const report = mustReport(raw, catalog);
		expect(
			deriveReleaseDecision({
				report,
				catalog,
				expected: releaseExpected(report),
			}).verdict,
		).toBe("INCONCLUSIVE");
	});
});

describe("v2 expected provenance", () => {
	test("compares requested and actual model identities independently", () => {
		const fixture = parsedRate();
		const firstExpected = fixture.expected.attempts[0];
		const firstActor = firstExpected?.actors[0];
		if (firstExpected === undefined || firstActor === undefined) {
			throw new Error("Expected fixture actor.");
		}
		const wrongRequested: ReleaseExpectedProvenance = {
			...fixture.expected,
			attempts: [
				{
					...firstExpected,
					actors: [
						{ ...firstActor, requestedModel: v2Model("wrong-requested") },
					],
				},
				...fixture.expected.attempts.slice(1),
			],
		};
		const requestedResult = compareExpectedProvenance(
			fixture.report,
			wrongRequested,
		);
		expect(requestedResult.matches).toBe(false);
		expect(requestedResult.mismatches[0]?.path).toContain("requestedModel");

		const wrongActual: ReleaseExpectedProvenance = {
			...fixture.expected,
			attempts: [
				{
					...firstExpected,
					actors: [
						{
							...firstActor,
							actualModel: {
								kind: "observed",
								value: v2Model("provider-a", "wrong-actual"),
							},
						},
					],
				},
				...fixture.expected.attempts.slice(1),
			],
		};
		const actualResult = compareExpectedProvenance(fixture.report, wrongActual);
		expect(actualResult.matches).toBe(false);
		expect(actualResult.mismatches[0]?.path).toContain("actualModel");

		const first = fixture.expected.attempts[0];
		if (first === undefined) throw new Error("Expected provenance row.");
		expect(
			compareExpectedProvenance(fixture.report, {
				...fixture.expected,
				attempts: [...fixture.expected.attempts, { ...first, cellId: "extra" }],
			}).matches,
		).toBe(false);
		expect(
			compareExpectedProvenance(fixture.report, {
				...fixture.expected,
				attempts: fixture.expected.attempts.slice(1),
			}).matches,
		).toBe(false);
		expect(
			compareExpectedProvenance(fixture.report, {
				...fixture.expected,
				attempts: [
					{ ...first, actors: [firstActor, { ...firstActor }] },
					...fixture.expected.attempts.slice(1),
				],
			}).matches,
		).toBe(false);
	});

	test("requires an explicit exact exception for an unobserved actual model", () => {
		const raw = buildRateReport();
		const firstActor = raw.attempts[0]?.actors[0];
		if (firstActor === undefined) throw new Error("Expected fixture actor.");
		Reflect.set(firstActor, "actualModel", {
			kind: "unobserved",
			reason: "Host omitted provider metadata.",
		});
		const catalog = mustCatalog(rateCatalog());
		const report = mustReport(raw, catalog);
		const allowed = releaseExpected(report);
		expect(compareExpectedProvenance(report, allowed).matches).toBe(true);

		const expectedAttempt = allowed.attempts[0];
		const expectedModel = expectedAttempt?.actors[0]?.requestedModel;
		if (expectedAttempt === undefined || expectedModel === undefined) {
			throw new Error("Expected fixture provenance.");
		}
		const denied: ReleaseExpectedProvenance = {
			...allowed,
			attempts: [
				{
					...expectedAttempt,
					actors: [
						{
							role: "manager",
							requestedModel: expectedModel,
							actualModel: { kind: "observed", value: expectedModel },
						},
					],
				},
				...allowed.attempts.slice(1),
			],
		};
		expect(compareExpectedProvenance(report, denied).matches).toBe(false);
		expect(
			deriveReleaseDecision({ report, catalog, expected: denied }).verdict,
		).toBe("NOT VERIFIED");
	});

	test("treats exact artifact drift as a hard release failure", () => {
		const fixture = parsedRate();
		const drifted: ReleaseExpectedProvenance = {
			...fixture.expected,
			artifact: { ...fixture.expected.artifact, tarballSha256: DIGEST_D },
		};
		const decision = deriveReleaseDecision({
			report: fixture.report,
			catalog: fixture.catalog,
			expected: drifted,
		});
		expect(decision.verdict).toBe("NOT VERIFIED");
		expect(decision.reasons.map((reason) => reason.code)).toContain(
			"provenance-mismatch",
		);
	});
});
