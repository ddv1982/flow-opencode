import { describe, expect, test } from "bun:test";
import {
	assuranceProjection,
	deliveryProjection,
} from "../src/application/delivery.js";
import type {
	EvidenceEntry,
	Session,
	SourceDigest,
} from "../src/domain/session.js";

const SOURCE = `sha256:${"a".repeat(64)}` as SourceDigest;
const OUTPUT = `sha256:${"b".repeat(64)}` as SourceDigest;

function completedSession(
	overrides: Readonly<{
		gate?: string | undefined;
		extraEvidence?: Omit<EvidenceEntry, "scope">[] | undefined;
		includeEvidence?: boolean;
	}> = {},
): Session {
	const gate = overrides.gate ?? "bun test";
	const observation = {
		id: "validation-1",
		featureId: "delivery",
		runId: "run-1",
		scope: "broad" as const,
		command: gate,
		sourceDigest: SOURCE,
		exitCode: 0,
		outputDigest: OUTPUT,
		outputComplete: true,
		recordedRevision: 4,
		hostPlatform: "linux" as const,
		observedAssertions: [{ name: "acceptance", status: "passed" as const }],
	};
	const extras = (overrides.extraEvidence ?? []).map((entry) => ({
		...entry,
		scope: "extra" as const,
	}));
	return {
		version: 5,
		id: "session-1",
		revision: 7,
		goal: "Ship delivery",
		approval: "approved",
		plan: {
			summary: "Ship delivery.",
			overview: "Exercise assurance.",
			requirements: ["Acceptance passes."],
			decisions: ["Use the canonical gate."],
			...(overrides.includeEvidence === false
				? {}
				: {
						evidence: [
							{
								scope: "gate" as const,
								requirement: "Repository suite",
								environment: "this host",
								command: gate,
								platform: "other" as const,
								assertions: [],
							},
							...extras,
						],
					}),
			features: [
				{
					id: "delivery",
					title: "Delivery",
					summary: "Implement delivery.",
					targets: ["src"],
					validation: [gate],
					dependsOn: [],
				},
			],
		},
		runs: [
			{
				id: "run-1",
				featureId: "delivery",
				attempt: 1,
				state: "completed",
				startedRevision: 3,
				summary: "Delivered.",
				artifactsChanged: [{ path: "src/delivery.ts" }],
				validations: [observation],
				reviews: [
					{
						id: "review-1",
						operationId: "review-start-1",
						featureId: "delivery",
						runId: "run-1",
						kind: "final",
						sourceDigest: SOURCE,
						validationIds: [observation.id],
						packet: { summary: "Review.", riskLenses: ["correctness"] },
						createdRevision: 5,
						result: {
							verdict: "passed",
							findings: [],
							terminalDisposition: "submitted",
							recordedRevision: 6,
						},
					},
				],
			},
		],
		operations: [],
		closure: {
			kind: "completed",
			summary: "Shipped.",
			operationId: "close-1",
			recordedRevision: 7,
		},
	};
}

describe("assurance projection", () => {
	test("supports a completion with accepted gate, review, and feature evidence", () => {
		const assurance = assuranceProjection(completedSession());

		expect(assurance.conclusion).toBe("completion-supported");
		expect(assurance.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "recorded-completion",
					status: "satisfied",
					tier: "ts-enforced",
				}),
				expect.objectContaining({
					id: "accepted-validation",
					status: "satisfied",
					tier: "host-attested",
				}),
				expect.objectContaining({
					id: "canonical-gate",
					status: "satisfied",
				}),
			]),
		);
		expect(assurance.limitations).toContain(
			"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
		);
	});

	test("keeps negative inspection completion distinct from accepted implementation", () => {
		const session = completedSession();
		if (!session.plan) throw new Error("Expected an approved plan.");
		const inspection: Session = {
			...session,
			plan: {
				...session.plan,
				evidence: session.plan.evidence?.map((entry) => ({
					...entry,
					scope: "gate-observe",
					assertions: [],
				})),
				features: session.plan.features.map((feature) => ({
					...feature,
					kind: "inspect",
				})),
			},
			runs: session.runs.map((run) => ({
				...run,
				validations: run.validations.map((observation) => ({
					...observation,
					exitCode: 1,
				})),
				reviews: run.reviews.map((review) => ({
					...review,
					result: {
						verdict: "failed",
						findings: [
							{
								severity: "blocking",
								summary: "Retry loses data.",
								evidence:
									"src/delivery.ts:7 overwrites accepted state on replay.",
							},
						],
						terminalDisposition: "submitted",
						recordedRevision: 6,
					},
				})),
			})),
		};

		const assurance = assuranceProjection(inspection);
		expect(assurance.conclusion).toBe("completion-unsupported");
		expect(assurance.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "recorded-completion",
					status: "unsatisfied",
				}),
				expect.objectContaining({
					id: "accepted-validation",
					status: "unsatisfied",
				}),
			]),
		);
		expect(assurance.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "canonical-gate",
					status: "unsatisfied",
					explanation: expect.stringContaining("exit 1"),
				}),
			]),
		);
	});

	test("uses latest reviewed gate revision when feature order differs from execution order", () => {
		const base = completedSession();
		const plan = base.plan;
		const originalRun = base.runs[0];
		const originalFeature = plan?.features[0];
		const originalObservation = originalRun?.validations[0];
		const originalReview = originalRun?.reviews[0];
		if (
			!plan ||
			!originalRun ||
			!originalFeature ||
			!originalObservation ||
			!originalReview?.result ||
			!base.closure
		)
			throw new Error("Expected completed fixture.");
		const laterObservation = {
			...originalObservation,
			id: "validation-2",
			featureId: "later",
			runId: "run-2",
			exitCode: 2,
			recordedRevision: 8,
		};
		const earlierRun = {
			...originalRun,
			reviews: originalRun.reviews.map((review) => ({
				...review,
				kind: "feature" as const,
			})),
		};
		const laterRun = {
			...originalRun,
			id: "run-2",
			featureId: "later",
			startedRevision: 7,
			validations: [laterObservation],
			reviews: [
				{
					...originalReview,
					id: "review-2",
					featureId: "later",
					runId: "run-2",
					validationIds: [laterObservation.id],
					createdRevision: 9,
					result: { ...originalReview.result, recordedRevision: 10 },
				},
			],
		};
		const reversed: Session = {
			...base,
			revision: 11,
			plan: {
				...plan,
				evidence: plan.evidence?.map((entry) => ({
					...entry,
					scope: "gate-observe",
				})),
				features: [
					{ ...originalFeature, id: "later", kind: "inspect" },
					{ ...originalFeature, kind: "inspect" },
				],
			},
			runs: [earlierRun, laterRun],
			closure: { ...base.closure, recordedRevision: 11 },
		};
		const gate = assuranceProjection(reversed).checks.find(
			(check) => check.id === "canonical-gate",
		);
		expect(gate).toMatchObject({
			status: "satisfied",
			explanation: expect.stringContaining("exit 2"),
		});
		const failedLatest: Session = {
			...reversed,
			runs: [
				earlierRun,
				{
					...laterRun,
					reviews: laterRun.reviews.map((review) => ({
						...review,
						result: {
							...originalReview.result,
							verdict: "failed",
							terminalDisposition: "submitted",
							findings: [
								{
									severity: "blocking",
									summary: "Inspection failed.",
									evidence: "docs/review.md",
								},
							],
							recordedRevision: 10,
						},
					})),
				},
			],
		};
		expect(
			assuranceProjection(failedLatest).checks.find(
				(check) => check.id === "canonical-gate",
			),
		).toMatchObject({
			status: "unsatisfied",
			explanation: expect.stringContaining("exit 2"),
		});
	});

	test("reports a contradictory completed document without throwing", () => {
		const session = completedSession();
		const contradictory: Session = {
			...session,
			runs: session.runs.map((run) => ({
				...run,
				validations: [],
				reviews: [],
			})),
		};

		const assurance = assuranceProjection(contradictory);

		expect(assurance.conclusion).toBe("completion-unsupported");
		expect(
			assurance.checks
				.filter((check) => check.status === "unsatisfied")
				.map((check) => check.id),
		).toEqual(
			expect.arrayContaining([
				"recorded-completion",
				"accepted-validation",
				"canonical-gate",
			]),
		);
	});

	test("does not claim completion for deferred or abandoned closure", () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const completed = completedSession();
			const closure = completed.closure;
			if (!closure) throw new Error("fixture must be closed");
			const session: Session = {
				...completed,
				closure: { ...closure, kind },
			};

			const assurance = assuranceProjection(session);
			expect(assurance.conclusion).toBe("completion-not-claimed");
			expect(
				assurance.checks.every((check) => check.status === "not-applicable"),
			).toBe(true);
		}
	});

	test("labels missing declarations instead of inventing them", () => {
		const legacy: Session = completedSession({ includeEvidence: false });

		const assurance = assuranceProjection(legacy);
		expect(assurance.conclusion).toBe("completion-supported");
		expect(assurance.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "canonical-gate",
					status: "not-applicable",
					tier: "caller-declared",
				}),
				expect.objectContaining({
					id: "declared-evidence",
					status: "not-applicable",
				}),
			]),
		);
	});

	test("reports named extra evidence as satisfied only on matching evidence", () => {
		const entry = {
			requirement: "Acceptance case passes on Linux",
			environment: "Linux CI",
			platform: "linux" as const,
			command: "bun test",
			assertions: ["acceptance"],
		};
		const supported = assuranceProjection(
			completedSession({ extraEvidence: [entry] }),
		);
		expect(supported.conclusion).toBe("completion-supported");
		expect(supported.checks).toContainEqual(
			expect.objectContaining({
				id: "declared-evidence",
				status: "satisfied",
			}),
		);

		const session = completedSession({ extraEvidence: [entry] });
		const wrongHost: Session = {
			...session,
			runs: session.runs.map((run) => ({
				...run,
				validations: run.validations.map((validation) => ({
					...validation,
					hostPlatform: "darwin",
				})),
			})),
		};
		const unsupported = assuranceProjection(wrongHost);
		expect(unsupported.conclusion).toBe("completion-unsupported");
		expect(unsupported.checks).toContainEqual(
			expect.objectContaining({
				id: "declared-evidence",
				status: "unsatisfied",
			}),
		);
	});
});

describe("delivery summary", () => {
	test("compresses successful histories and artifacts while retaining assurance limits", () => {
		const base = completedSession();
		const session: Session = {
			...base,
			runs: base.runs.map((run) => ({
				...run,
				summary: "A long successful history. ".repeat(50),
				artifactsChanged: Array.from({ length: 20 }, (_, index) => ({
					path: `src/reported-artifact-${index}.ts`,
				})),
			})),
		};
		const delivery = deliveryProjection(session);
		const summary = delivery.summary.lines.join("\n");
		expect(summary).toContain("Closure: completed. Shipped.");
		expect(summary).toContain("Progress: 1 of 1 features complete");
		expect(summary).toContain("Unfinished features: none");
		expect(summary).toContain(
			"Reported artifacts: 20 latest, 0 superseded only.",
		);
		expect(summary).toContain("External action authority: not-granted");
		expect(summary).toContain(
			"Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.",
		);
		expect(summary).toContain(
			"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
		);
		expect(summary).toContain(
			"Freshness holds when review is accepted; an archive does not attest the current workspace.",
		);
		expect(summary).toContain(
			"Full report is included in this close response.",
		);
		expect(summary.length).toBeLessThan(
			delivery.report.join("\n").length * 0.6,
		);
		expect(delivery.report.join("\n")).toContain(
			"A long successful history. ".repeat(50),
		);
		expect(delivery.report.join("\n")).toContain("src/reported-artifact-19.ts");
	});
	test("deferred summary retains every live blocker and unfinished feature without clipping", () => {
		const base = completedSession();
		if (!base.closure || !base.plan)
			throw new Error("fixture requires plan and closure");
		const session: Session = {
			...base,
			closure: {
				...base.closure,
				kind: "deferred",
				summary: "Evidence unavailable.",
			},
			plan: {
				...base.plan,
				features: [
					...base.plan.features,
					{
						id: "followup",
						title: "Followup",
						summary: "Followup",
						targets: ["src"],
						validation: ["bun test"],
						dependsOn: ["delivery"],
					},
				],
			},
			runs: base.runs.map((run) => ({
				...run,
				state: "blocked",
				reviews: run.reviews.map((review) => {
					if (!review.result) throw new Error("fixture result missing");
					return {
						...review,
						result: {
							...review.result,
							verdict: "failed",
							findings: [
								...Array.from({ length: 12 }, (_, index) => ({
									findingId: `blocker-${index}`,
									severity: "blocking" as const,
									summary: `Failure ${index}.`,
									evidence: `source-${index}.ts`,
								})),
								{
									findingId: "advisory",
									severity: "advisory" as const,
									summary: "Nonblocker.",
								},
							],
						},
					};
				}),
			})),
		};
		const summary = deliveryProjection(session).summary.lines.join("\n");
		expect(summary).toContain("Closure: deferred. Evidence unavailable.");
		expect(summary).toContain("Progress: 0 of 2 features complete");
		expect(summary).toContain("Unfinished features: delivery, followup");
		for (let index = 0; index < 12; index++)
			expect(summary).toContain(
				`Blocking finding delivery blocker-${index}: Failure ${index}.`,
			);
		expect(summary).toContain("Nonblocking live findings: advisory 1.");
		expect(summary).toContain("Assurance: completion not claimed");
	});
	test("contradictory completion preserves every unsatisfied check", () => {
		const base = completedSession();
		const delivery = deliveryProjection({
			...base,
			runs: base.runs.map((run) => ({ ...run, validations: [], reviews: [] })),
		});
		const summary = delivery.summary.lines.join("\n");
		expect(summary).toContain("Assurance: completion unsupported");
		const unsatisfied = delivery.assurance.checks.filter(
			(check) => check.status === "unsatisfied",
		);
		expect(unsatisfied.length).toBeGreaterThan(0);
		for (const check of unsatisfied) {
			expect(summary).toContain(`unsatisfied ${check.id}`);
			expect(summary).toContain(check.explanation);
		}
	});
	for (const exitCode of [0, 21, null]) {
		test(`observed exit ${exitCode} remains explicit without claiming a pass`, () => {
			const base = completedSession();
			if (!base.plan) throw new Error("fixture requires plan");
			const session: Session = {
				...base,
				plan: {
					...base.plan,
					features: base.plan.features.map((feature) => ({
						...feature,
						kind: "inspect",
					})),
					evidence: base.plan.evidence?.map((entry) => ({
						...entry,
						scope: "gate-observe",
					})),
				},
				runs: base.runs.map((run) => ({
					...run,
					validations: run.validations.map((validation) => ({
						...validation,
						exitCode,
					})),
				})),
			};
			const summary = deliveryProjection(session).summary.lines.join("\n");
			expect(summary).toContain(
				`Observed "bun test": exit ${exitCode ?? "unavailable"}, host linux; this does not claim the command passed.`,
			);
		});
	}
});
