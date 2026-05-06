// Owns final-review payload and lite-lane final approval coverage previously
// grouped in tests/runtime-completion-contracts.test.ts.
import { describe, expect, test } from "bun:test";
import { normalizeFinalReviewDecision } from "../../src/runtime/application/session-review-decision-normalization";
import {
	buildReviewContextPack,
	describeFinalReviewCoverageFailure,
	describeFinalReviewerReviewScopeFailure,
	describeReviewContextPackGroundingFailure,
	finalReviewBehaviorCoverageFailureReasons,
	reviewContextPackHasSurfaceEvidence,
} from "../../src/runtime/domain";
import {
	FinalReviewSchema,
	FlowReviewRecordFinalArgsSchema,
	SessionSchema,
} from "../../src/runtime/schema";
import { createSession } from "../../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../../src/runtime/transitions";
import { samplePlan } from "../runtime-test-helpers";

describe("runtime final review contracts", () => {
	test("normalizes a typed review content discovery pack for final review coverage", () => {
		const reviewContextPack = buildReviewContextPack({
			task: "Review runtime session completion",
			compareBase: "main",
			changedFiles: ["./src/runtime/session.ts", "src/runtime/session.ts"],
			includedContext: [
				{
					path: "src/runtime/application/session-actions.ts",
					reason: "caller",
					summary: "Records reviewer decisions before completion.",
				},
				{
					path: "tests/runtime/final-review-contracts.test.ts",
					reason: "test_oracle",
					summary: "Runtime final-review contract coverage.",
				},
			],
			relationships: [
				{
					from: "src/runtime/application/session-actions.ts",
					to: "./src/runtime/session.ts",
					kind: "records_review_decision",
					summary:
						"Action layer writes review data consumed by session completion.",
				},
				{
					from: "tests/runtime/final-review-contracts.test.ts",
					to: "src/runtime/session.ts",
					kind: "validates",
					summary: "Runtime contract test validates final-review coverage.",
				},
			],
			validationEvidence: [
				{
					command: "bun test tests/runtime/final-review-contracts.test.ts",
					status: "passed",
					summary: "Targeted runtime review contracts passed.",
				},
			],
			suggestedValidation: [
				"bun test tests/runtime/final-review-contracts.test.ts",
			],
			coverageGaps: ["Prompt and eval harness integration is handled later."],
		});

		expect(reviewContextPack.changedFiles).toEqual(["src/runtime/session.ts"]);
		expect(reviewContextPack.includedContext).toContainEqual({
			path: "src/runtime/session.ts",
			reason: "changed_file",
			surface: "changed_files",
		});
		expect(reviewContextPack.relationships).toEqual([
			{
				from: "src/runtime/application/session-actions.ts",
				to: "src/runtime/session.ts",
				kind: "records_review_decision",
				summary:
					"Action layer writes review data consumed by session completion.",
			},
			{
				from: "tests/runtime/final-review-contracts.test.ts",
				to: "src/runtime/session.ts",
				kind: "validates",
				summary: "Runtime contract test validates final-review coverage.",
			},
		]);
		expect(reviewContextPack.validationEvidence).toEqual([
			{
				command: "bun test tests/runtime/final-review-contracts.test.ts",
				status: "passed",
				summary: "Targeted runtime review contracts passed.",
			},
		]);
		expect(reviewContextPack.suggestedValidation).toEqual([
			"bun test tests/runtime/final-review-contracts.test.ts",
		]);
		expect(reviewContextPack.coverageGaps).toEqual([
			"Prompt and eval harness integration is handled later.",
		]);
		expect(reviewContextPack.reviewedSurfaces).toEqual([
			"changed_files",
			"integration_points",
			"validation_evidence",
			"tests",
		]);

		const parsedRuntimeReview = FlowReviewRecordFinalArgsSchema.safeParse({
			scope: "final",
			status: "approved",
			summary: "Final review approved.",
			reviewDepth: "broad",
			reviewedSurfaces: reviewContextPack.reviewedSurfaces,
			evidenceSummary:
				"Reviewed changed files, connected context, and validation evidence.",
			validationAssessment:
				"Targeted runtime review contract validation passed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [
					"bun test tests/runtime/final-review-contracts.test.ts",
				],
			},
			integrationChecks: ["Checked action/session relationship."],
			regressionChecks: ["Checked final-review contract behavior."],
			reviewContextPack,
		});
		expect(parsedRuntimeReview.success).toBe(true);
		if (!parsedRuntimeReview.success) return;
		expect(
			parsedRuntimeReview.data.reviewContextPack?.relationships[0]?.kind,
		).toBe("records_review_decision");

		expect(
			describeReviewContextPackGroundingFailure(reviewContextPack, {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [
					"bun test tests/runtime/final-review-contracts.test.ts",
				],
			}),
		).toBeNull();

		const session = createSession("Review runtime session completion");
		const coverageFailure = describeFinalReviewCoverageFailure(
			session,
			{
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [
					{
						command: "bun test tests/runtime/final-review-contracts.test.ts",
					},
				],
			},
			{
				reviewDepth: "broad",
				reviewedSurfaces: [
					"changed_files",
					"integration_points",
					"shared_surfaces",
					"validation_evidence",
					"tests",
				],
				evidenceSummary:
					"Reviewed changed files, connected context, and validation evidence.",
				validationAssessment:
					"Targeted runtime review contract validation passed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: [
						"bun test tests/runtime/final-review-contracts.test.ts",
					],
				},
				remainingGaps: reviewContextPack.coverageGaps,
				suggestedValidation: reviewContextPack.suggestedValidation,
				reviewContextPack,
			},
		);

		expect(coverageFailure).toBeNull();

		expect(
			describeFinalReviewCoverageFailure(
				session,
				{
					artifactsChanged: [{ path: "src/runtime/session.ts" }],
					validationRun: [
						{
							command: "bun test tests/runtime/final-review-contracts.test.ts",
						},
					],
				},
				{
					reviewDepth: "broad",
					reviewedSurfaces: [
						"changed_files",
						"shared_surfaces",
						"validation_evidence",
					],
					evidenceSummary: "Reviewed changed files only.",
					validationAssessment: "Validation passed.",
					evidenceRefs: {
						changedArtifacts: ["src/runtime/session.ts"],
						validationCommands: [
							"bun test tests/runtime/final-review-contracts.test.ts",
						],
					},
					reviewContextPack,
				},
			),
		).toContain(
			"must reflect reviewContextPack reviewedSurfaces in reviewedSurfaces",
		);
	});

	test("fails final review coverage for ungrounded review context pack surfaces", () => {
		const session = createSession("Review runtime context grounding");
		const ungroundedChangedFilesPack = buildReviewContextPack({
			task: "Review runtime context grounding",
			changedFiles: ["src/runtime/session.ts"],
		});

		expect(
			describeFinalReviewCoverageFailure(
				session,
				{
					artifactsChanged: [],
					validationRun: [],
				},
				{
					reviewDepth: "broad",
					reviewedSurfaces: ["changed_files"],
					evidenceSummary: "Reviewed claimed changed files.",
					validationAssessment: "No validation was available.",
					evidenceRefs: {
						changedArtifacts: [],
						validationCommands: [],
					},
					reviewContextPack: ungroundedChangedFilesPack,
				},
			),
		).toContain(
			"reviewContextPack changedFiles require matching worker artifacts",
		);

		const ungroundedConnectedContextPack = buildReviewContextPack({
			task: "Review runtime context grounding",
			changedFiles: ["src/runtime/session.ts"],
			includedContext: [
				{
					path: "src/runtime/application/session-actions.ts",
					reason: "caller",
					summary: "Caller context without a relationship edge.",
				},
			],
		});

		expect(
			describeFinalReviewCoverageFailure(
				session,
				{
					artifactsChanged: [{ path: "src/runtime/session.ts" }],
					validationRun: [],
				},
				{
					reviewDepth: "broad",
					reviewedSurfaces: [
						"changed_files",
						"integration_points",
						"shared_surfaces",
					],
					evidenceSummary: "Reviewed changed files and caller context.",
					validationAssessment: "No validation was available.",
					evidenceRefs: {
						changedArtifacts: ["src/runtime/session.ts"],
						validationCommands: [],
					},
					reviewContextPack: ungroundedConnectedContextPack,
				},
			),
		).toContain(
			"reviewContextPack includedContext entries are not grounded by changed files or relationships",
		);
	});

	test("rejects grounded review context with spoofed surface labels", () => {
		const session = createSession("Review runtime surface spoofing");
		const spoofedPack = buildReviewContextPack({
			task: "Review runtime surface spoofing",
			changedFiles: ["src/runtime/session.ts"],
			includedContext: [
				{
					path: "src/runtime/session.ts",
					reason: "test_oracle",
					surface: "tests",
					summary: "Spoofed test evidence on a runtime source file.",
				},
			],
		});

		expect(
			describeReviewContextPackGroundingFailure(spoofedPack, {
				changedArtifacts: ["src/runtime/session.ts"],
			}),
		).toBeNull();
		expect(
			reviewContextPackHasSurfaceEvidence(spoofedPack, "tests", {
				changedArtifacts: ["src/runtime/session.ts"],
			}),
		).toBe(false);
		expect(
			describeFinalReviewCoverageFailure(
				session,
				{
					artifactsChanged: [{ path: "src/runtime/session.ts" }],
					validationRun: [],
				},
				{
					reviewDepth: "broad",
					reviewedSurfaces: ["changed_files", "tests", "shared_surfaces"],
					evidenceSummary: "Reviewed claimed source and test surfaces.",
					validationAssessment: "No validation was available.",
					evidenceRefs: {
						changedArtifacts: ["src/runtime/session.ts"],
						validationCommands: [],
					},
					reviewContextPack: spoofedPack,
				},
			),
		).toContain(
			"claimed reviewed surfaces are not backed by evidenceRefs.changedArtifacts: tests",
		);
	});

	test("fails review context grounding when validation evidence lacks worker validation", () => {
		const pack = buildReviewContextPack({
			task: "Review validation grounding",
			changedFiles: ["src/runtime/session.ts"],
			validationEvidence: [
				{
					command: "bun test tests/runtime/final-review-contracts.test.ts",
					status: "passed",
				},
			],
		});

		expect(
			reviewContextPackHasSurfaceEvidence(pack, "validation_evidence", {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [],
			}),
		).toBe(false);
		expect(
			reviewContextPackHasSurfaceEvidence(pack, "validation_evidence", {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [
					"bun test tests/runtime/final-review-contracts.test.ts",
				],
			}),
		).toBe(true);
		expect(
			describeReviewContextPackGroundingFailure(pack, {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [],
			}),
		).toContain(
			"reviewContextPack validationEvidence require matching worker validationRun",
		);
	});

	test("requires explicit evidenceRefs for live final-review inputs while allowing explicit empty refs", () => {
		const liveFinalDecision = {
			scope: "final",
			status: "approved",
			summary: "Final review approved.",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Reviewed changed files.",
			validationAssessment: "No validation was available.",
		};

		expect(
			FlowReviewRecordFinalArgsSchema.safeParse(liveFinalDecision).success,
		).toBe(false);
		expect(
			FlowReviewRecordFinalArgsSchema.safeParse({
				...liveFinalDecision,
				evidenceRefs: {},
			}).success,
		).toBe(false);
		expect(
			FlowReviewRecordFinalArgsSchema.safeParse({
				...liveFinalDecision,
				evidenceRefs: { changedArtifacts: [] },
			}).success,
		).toBe(false);
		expect(
			FlowReviewRecordFinalArgsSchema.safeParse({
				...liveFinalDecision,
				evidenceRefs: { validationCommands: [] },
			}).success,
		).toBe(false);
		expect(
			FlowReviewRecordFinalArgsSchema.safeParse({
				...liveFinalDecision,
				evidenceRefs: { changedArtifacts: [], validationCommands: [] },
			}).success,
		).toBe(true);

		const liveWorkerFinalReview = {
			status: "passed",
			summary: "Final review passed.",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Reviewed changed files.",
			validationAssessment: "No validation was available.",
		};
		expect(FinalReviewSchema.safeParse(liveWorkerFinalReview).success).toBe(
			false,
		);
		expect(
			FinalReviewSchema.safeParse({
				...liveWorkerFinalReview,
				evidenceRefs: { changedArtifacts: [], validationCommands: [] },
			}).success,
		).toBe(true);
	});

	test("review-mode approved final reviewer decisions require complete review scope ledger", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: [
						"src/runtime/session.ts",
						"src/runtime/transitions/execution.ts",
					],
				},
			],
		};
		const applied = applyPlan(createSession("Review runtime completion"), plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const baseDecision = {
			scope: "final" as const,
			status: "approved" as const,
			summary: "Final review approved.",
			reviewDepth: "detailed" as const,
			reviewedSurfaces: [
				"changed_files" as const,
				"shared_surfaces" as const,
				"validation_evidence" as const,
			],
			evidenceSummary: "Reviewed changed files and declared scope.",
			validationAssessment: "Validation evidence was reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: ["Checked runtime completion integration."],
			regressionChecks: ["Checked runtime completion regression coverage."],
			remainingGaps: [],
		};

		const missingLedger = recordReviewerDecision(
			started.value.session,
			baseDecision,
		);
		expect(missingLedger.ok).toBe(false);
		if (!missingLedger.ok) {
			expect(missingLedger.message).toContain("reviewScopeLedger");
		}

		const partialLedger = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/session.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["src/runtime/session.ts"],
					validationRefs: ["bun test"],
					residualRisk: "No known residual risk.",
				},
			],
		});
		expect(partialLedger.ok).toBe(false);
		if (!partialLedger.ok) {
			expect(partialLedger.message).toContain(
				"file_target:src/runtime/transitions/execution.ts",
			);
		}

		const placeholderEvidence = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/session.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["reviewed declared scope"],
					validationRefs: ["bun test"],
					residualRisk: "No known residual risk.",
				},
				{
					scopeId: "file_target:src/runtime/transitions/execution.ts",
					status: "deferred" as const,
					evidenceRefs: ["src/runtime/transitions/execution.ts"],
					residualRisk:
						"Deferred to the next review pass; no blocking completion risk recorded.",
				},
			],
		});
		expect(placeholderEvidence.ok).toBe(false);
		if (!placeholderEvidence.ok) {
			expect(placeholderEvidence.message).toContain("not grounded");
		}

		const unsafeEvidence = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/session.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["../escape.ts"],
					validationRefs: ["bun test"],
					residualRisk: "No known residual risk.",
				},
				{
					scopeId: "file_target:src/runtime/transitions/execution.ts",
					status: "deferred" as const,
					evidenceRefs: ["src/runtime/transitions/execution.ts"],
					residualRisk:
						"Deferred to the next review pass; no blocking completion risk recorded.",
				},
			],
		});
		expect(unsafeEvidence.ok).toBe(false);
		if (!unsafeEvidence.ok) {
			expect(unsafeEvidence.message).toContain("safe relative path");
		}

		const crossScopeEvidence = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/session.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["src/runtime/session.ts"],
					validationRefs: ["bun test"],
					residualRisk: "No known residual risk.",
				},
				{
					scopeId: "file_target:src/runtime/transitions/execution.ts",
					status: "deferred" as const,
					evidenceRefs: ["src/runtime/session.ts"],
					residualRisk:
						"Deferred to the next review pass; no blocking completion risk recorded.",
				},
			],
		});
		expect(crossScopeEvidence.ok).toBe(false);
		if (!crossScopeEvidence.ok) {
			expect(crossScopeEvidence.message).toContain(
				"not grounded in this declared scope target",
			);
		}

		const scopeIdOnlyEvidence = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/session.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["file_target:src/runtime/session.ts"],
					validationRefs: ["bun test"],
					residualRisk: "No known residual risk.",
				},
				{
					scopeId: "file_target:src/runtime/transitions/execution.ts",
					status: "deferred" as const,
					evidenceRefs: ["src/runtime/transitions/execution.ts"],
					residualRisk:
						"Deferred to the next review pass; no blocking completion risk recorded.",
				},
			],
		});
		expect(scopeIdOnlyEvidence.ok).toBe(false);
		if (!scopeIdOnlyEvidence.ok) {
			expect(scopeIdOnlyEvidence.message).toContain(
				"not grounded in this declared scope target",
			);
		}

		const validationOnlyEvidence = recordReviewerDecision(
			started.value.session,
			{
				...baseDecision,
				reviewScopeLedger: [
					{
						scopeId: "file_target:src/runtime/session.ts",
						status: "reviewed_no_findings" as const,
						evidenceRefs: ["bun test"],
						validationRefs: ["bun test"],
						residualRisk: "No known residual risk.",
					},
					{
						scopeId: "file_target:src/runtime/transitions/execution.ts",
						status: "deferred" as const,
						evidenceRefs: ["src/runtime/transitions/execution.ts"],
						residualRisk:
							"Deferred to the next review pass; no blocking completion risk recorded.",
					},
				],
			},
		);
		expect(validationOnlyEvidence.ok).toBe(false);
		if (!validationOnlyEvidence.ok) {
			expect(validationOnlyEvidence.message).toContain(
				"must include at least one concrete artifact reference",
			);
		}

		const completeLedger = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/session.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["src/runtime/session.ts:42"],
					validationRefs: ["bun test"],
					residualRisk: "No known residual risk.",
				},
				{
					scopeId: "file_target:src/runtime/transitions/execution.ts",
					status: "deferred" as const,
					evidenceRefs: ["src/runtime/transitions/execution.ts"],
					residualRisk:
						"Deferred to the next review pass; no blocking completion risk recorded.",
				},
			],
		});
		expect(completeLedger.ok).toBe(true);
	});

	test("review-mode non-file scope ledger requires concrete evidence", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: [],
					reviewScope: [
						{
							id: "domain:runtime",
							kind: "domain" as const,
							target: "runtime",
							description: "Review the runtime domain broadly.",
						},
					],
				},
			],
		};
		const applied = applyPlan(createSession("Review runtime domain"), plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const baseDecision = {
			scope: "final" as const,
			status: "approved" as const,
			summary: "Final review approved.",
			reviewDepth: "detailed" as const,
			reviewedSurfaces: [
				"changed_files" as const,
				"shared_surfaces" as const,
				"validation_evidence" as const,
			],
			evidenceSummary: "Reviewed runtime domain evidence.",
			validationAssessment: "Runtime validation evidence was reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: ["Checked runtime domain integration."],
			regressionChecks: ["Checked runtime domain regression evidence."],
			remainingGaps: [],
		};

		const targetStringOnly = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "domain:runtime",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["runtime"],
					residualRisk: "No known residual risk.",
				},
			],
		});
		expect(targetStringOnly.ok).toBe(false);
		if (!targetStringOnly.ok) {
			expect(targetStringOnly.message).toContain(
				"not grounded in this declared scope target",
			);
		}

		expect(
			describeFinalReviewerReviewScopeFailure(started.value.session, {
				status: "approved",
				evidenceRefs: {
					changedArtifacts: [
						...baseDecision.evidenceRefs.changedArtifacts,
						"README.md",
					],
					validationCommands: baseDecision.evidenceRefs.validationCommands,
				},
				reviewScopeLedger: [
					{
						scopeId: "domain:runtime",
						status: "reviewed_no_findings" as const,
						evidenceRefs: ["README.md"],
						residualRisk: "No known residual risk.",
					},
				],
			}),
		).toContain("not grounded in this declared scope target");

		const concreteEvidence = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "domain:runtime",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["src/runtime/session.ts"],
					residualRisk: "No known residual risk.",
				},
			],
		});
		expect(concreteEvidence.ok).toBe(true);
	});

	test("review-mode glob scope ledger uses path-aware glob matching", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: ["src/runtime/*.ts"],
				},
			],
		};
		const applied = applyPlan(createSession("Review runtime glob"), plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const baseDecision = {
			scope: "final" as const,
			status: "approved" as const,
			summary: "Final review approved.",
			reviewDepth: "detailed" as const,
			reviewedSurfaces: [
				"changed_files" as const,
				"shared_surfaces" as const,
				"validation_evidence" as const,
			],
			evidenceSummary: "Reviewed runtime glob evidence.",
			validationAssessment: "Runtime validation evidence was reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: ["Checked runtime glob integration."],
			regressionChecks: ["Checked runtime glob regression evidence."],
			remainingGaps: [],
		};

		const nestedEvidence = recordReviewerDecision(started.value.session, {
			...baseDecision,
			evidenceRefs: {
				...baseDecision.evidenceRefs,
				changedArtifacts: ["src/runtime/nested/session.ts"],
			},
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/*.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["src/runtime/nested/session.ts"],
					residualRisk: "No known residual risk.",
				},
			],
		});
		expect(nestedEvidence.ok).toBe(false);
		if (!nestedEvidence.ok) {
			expect(nestedEvidence.message).toContain(
				"not grounded in this declared scope target",
			);
		}

		const wrongExtensionEvidence = recordReviewerDecision(
			started.value.session,
			{
				...baseDecision,
				evidenceRefs: {
					...baseDecision.evidenceRefs,
					changedArtifacts: ["src/runtime/session.md"],
				},
				reviewScopeLedger: [
					{
						scopeId: "file_target:src/runtime/*.ts",
						status: "reviewed_no_findings" as const,
						evidenceRefs: ["src/runtime/session.md"],
						residualRisk: "No known residual risk.",
					},
				],
			},
		);
		expect(wrongExtensionEvidence.ok).toBe(false);
		if (!wrongExtensionEvidence.ok) {
			expect(wrongExtensionEvidence.message).toContain(
				"not grounded in this declared scope target",
			);
		}

		const matchingEvidence = recordReviewerDecision(started.value.session, {
			...baseDecision,
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/*.ts",
					status: "reviewed_no_findings" as const,
					evidenceRefs: ["src/runtime/session.ts"],
					residualRisk: "No known residual risk.",
				},
			],
		});
		expect(matchingEvidence.ok).toBe(true);
	});

	test("broad review-mode final decisions derive behavior risks from declared scope", () => {
		const declaredTargets = [
			"src/shell/sessionPanels.ts",
			"src/game/navigation.ts",
			"src/scenes/PracticeScene.ts",
			"tests/sessionPanelActions.test.ts",
		];
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: declaredTargets,
				},
			],
		};
		const applied = applyPlan(
			createSession("Review soft-focus behavior surface"),
			plan,
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const decision = recordReviewerDecision(started.value.session, {
			scope: "final",
			status: "approved",
			summary: "Final review approved.",
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary:
				"Reviewed the changed shell surface and declared broad review scope.",
			validationAssessment: "Targeted session panel validation was reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/shell/sessionPanels.ts"],
				validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
			},
			integrationChecks: ["Checked declared shell/game/scene review scope."],
			regressionChecks: ["Checked session panel validation evidence."],
			remainingGaps: [],
			reviewScopeLedger: declaredTargets.map((target) => ({
				scopeId: `file_target:${target}`,
				status: "reviewed_no_findings" as const,
				evidenceRefs: [target],
				residualRisk: "No known residual risk for this scope target.",
			})),
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.message).toContain("finalReviewCoverage");
			expect(decision.message).toContain(
				"must account for required behavior risk classes: async_event_ordering, lifecycle_reentrancy, state_commit_rollback, test_oracle_authenticity",
			);
		}
	});

	test("behavior refs do not ground on non-concrete declared scope labels", () => {
		const command = "bun test tests/sessionPanelActions.test.ts";
		expect(
			finalReviewBehaviorCoverageFailureReasons(
				{
					artifactsChanged: [
						{ path: "src/shell/sessionPanels.ts" },
						{ path: "src/game/navigation.ts" },
					],
					validationRun: [{ command }],
				},
				{
					evidenceRefs: { validationCommands: [command] },
					declaredReviewScope: [
						{
							id: "domain:runtime",
							kind: "domain",
							target: "runtime",
						},
					],
					behaviorChecks: [
						{
							riskClass: "async_event_ordering",
							result: "passed",
							invariant: "Latest event ordering wins.",
							entrypointRefs: ["runtime"],
							stateOwnerRefs: [],
							lifecycleOwnerRefs: [],
							failurePath: "Out-of-order completion overwrites newer state.",
							oracleRefs: ["tests/sessionPanelActions.test.ts"],
							validationRefs: [command],
						},
					],
					validationCoverage: [
						{
							command,
							behaviorClasses: ["async_event_ordering"],
							proves: ["Panel action ordering was reviewed."],
							gaps: [],
							oracleRefs: ["tests/sessionPanelActions.test.ts"],
						},
					],
				},
			).some((reason) =>
				reason.includes(
					"behaviorChecks[0].entrypointRefs includes 'runtime', which is not grounded",
				),
			),
		).toBe(true);
	});

	test("implementation-mode approved final reviewer decisions do not require review scope ledger", () => {
		const session = createSession("Implement runtime completion");
		const accepted = recordReviewerDecision(session, {
			scope: "final",
			status: "approved",
			summary: "Final review approved.",
			reviewDepth: "broad",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary: "Reviewed changed files.",
			validationAssessment: "Validation evidence was reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
		});
		expect(accepted.ok).toBe(true);
	});

	test("accepts optional behavior and validation coverage fields and rejects approved needs_fix combinations", () => {
		const withOptionalCoverage = FlowReviewRecordFinalArgsSchema.safeParse({
			scope: "final",
			status: "approved",
			summary: "Final review approved.",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Reviewed changed files.",
			validationAssessment: "Validation pending.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			behaviorChecks: [
				{
					riskClass: "async_event_ordering",
					result: "passed",
					invariant: "Latest event ordering wins.",
					entrypointRefs: ["src/runtime/session.ts"],
					stateOwnerRefs: [],
					lifecycleOwnerRefs: [],
					failurePath: "Out-of-order completion overwrites newer state.",
					oracleRefs: ["tests/runtime/final-review-contracts.test.ts"],
					validationRefs: ["bun test"],
				},
			],
			validationCoverage: [
				{
					command: "bun test",
					behaviorClasses: ["async_event_ordering"],
					proves: ["Targeted runtime behavior remained stable."],
					gaps: [],
					oracleRefs: ["tests/runtime/final-review-contracts.test.ts"],
				},
			],
		});
		expect(withOptionalCoverage.success).toBe(true);
		if (withOptionalCoverage.success) {
			const normalized = normalizeFinalReviewDecision(
				withOptionalCoverage.data,
			);
			expect(normalized.evidenceRefs).toEqual({
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			});
			expect(normalized.behaviorChecks).toEqual(
				withOptionalCoverage.data.behaviorChecks ?? [],
			);
			expect(normalized.validationCoverage).toEqual(
				withOptionalCoverage.data.validationCoverage ?? [],
			);
		}

		const finalDecisionWithNeedsFix = recordReviewerDecision(
			createSession("Behavior check decision validation"),
			{
				scope: "final",
				status: "approved",
				summary: "Final review approved.",
				reviewDepth: "broad",
				reviewedSurfaces: ["changed_files"],
				evidenceSummary: "Reviewed changed files.",
				validationAssessment: "Validation pending.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				behaviorChecks: [
					{
						riskClass: "async_event_ordering",
						result: "needs_fix",
						invariant: "Latest event ordering wins.",
						entrypointRefs: ["src/runtime/session.ts"],
						stateOwnerRefs: [],
						lifecycleOwnerRefs: [],
						failurePath: "Out-of-order completion overwrites newer state.",
						oracleRefs: ["tests/runtime/final-review-contracts.test.ts"],
						validationRefs: ["bun test"],
					},
				],
			},
		);
		expect(finalDecisionWithNeedsFix.ok).toBe(false);
	});

	test("enforces risk-triggered checked-or-gap behavior accounting", () => {
		const session = createSession("Review soft-focus-like lifecycle behavior");
		const worker = {
			artifactsChanged: [
				{ path: "src/shell/sessionPanels.ts" },
				{ path: "src/game/navigation.ts" },
				{ path: "src/scenes/PracticeScene.ts" },
				{ path: "tests/sessionPanelActions.test.ts" },
			],
			validationRun: [
				{
					command: "bun test tests/sessionPanelActions.test.ts",
				},
			],
		};
		const baseReview = {
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
				"tests",
			],
			evidenceSummary:
				"Reviewed session panel, navigation, scene, and test surfaces together.",
			validationAssessment:
				"Targeted session panel validation passed and was reviewed.",
			evidenceRefs: {
				changedArtifacts: [
					"src/shell/sessionPanels.ts",
					"src/game/navigation.ts",
					"src/scenes/PracticeScene.ts",
					"tests/sessionPanelActions.test.ts",
				],
				validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
			},
			integrationChecks: [
				"Checked panel action, navigation, and scene handoff boundaries.",
			],
			regressionChecks: ["Checked the session panel regression test evidence."],
			remainingGaps: [],
		};

		expect(
			describeFinalReviewCoverageFailure(session, worker, baseReview),
		).toContain(
			"must account for required behavior risk classes: async_event_ordering, lifecycle_reentrancy, state_commit_rollback, test_oracle_authenticity",
		);

		const behaviorChecks = [
			{
				riskClass: "async_event_ordering" as const,
				result: "passed" as const,
				invariant: "Latest panel action wins after deferred navigation.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: ["src/game/navigation.ts"],
				lifecycleOwnerRefs: [],
				failurePath:
					"Earlier deferred click overrides the later selected session.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "lifecycle_reentrancy" as const,
				result: "passed" as const,
				invariant: "Scene startup is idempotent across panel re-entry.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: [],
				lifecycleOwnerRefs: ["src/scenes/PracticeScene.ts"],
				failurePath:
					"Repeated panel entry double-registers scene lifecycle callbacks.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "state_commit_rollback" as const,
				result: "passed" as const,
				invariant:
					"Navigation state commits only after scene startup succeeds.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: ["src/game/navigation.ts"],
				lifecycleOwnerRefs: ["src/scenes/PracticeScene.ts"],
				failurePath: "Selected session is committed before scene.start throws.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "test_oracle_authenticity" as const,
				result: "passed" as const,
				invariant: "The test oracle exercises the panel-to-scene failure path.",
				entrypointRefs: ["tests/sessionPanelActions.test.ts"],
				stateOwnerRefs: [],
				lifecycleOwnerRefs: [],
				failurePath:
					"A smoke-only oracle would miss ordering and rollback regressions.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
		];
		const validationCoverage = [
			{
				command: "bun test tests/sessionPanelActions.test.ts",
				behaviorClasses: [
					"async_event_ordering" as const,
					"lifecycle_reentrancy" as const,
					"state_commit_rollback" as const,
					"test_oracle_authenticity" as const,
				],
				proves: [
					"Panel action ordering, scene lifecycle handoff, rollback, and oracle coverage were exercised.",
				],
				gaps: [],
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
			},
		];

		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...baseReview,
				behaviorChecks,
				validationCoverage,
			}),
		).toBeNull();

		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...baseReview,
				behaviorChecks,
				validationCoverage: [
					{
						command: "bun test tests/sessionPanelActions.test.ts",
						behaviorClasses: [],
						proves: [],
						gaps: [],
						oracleRefs: [],
					},
				],
			}),
		).toContain(
			"behaviorChecks[0] (async_event_ordering) passed must map async_event_ordering in validationCoverage",
		);
		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...baseReview,
				behaviorChecks,
				validationCoverage: [],
			}),
		).toContain(
			"must map evidenceRefs.validationCommands in validationCoverage when behavior risks are required",
		);

		const [firstValidationCoverage] = validationCoverage;
		expect(firstValidationCoverage).toBeDefined();
		if (!firstValidationCoverage) return;
		const gapReview = {
			...baseReview,
			remainingGaps: [
				"Concurrent click interleaving remains unproven by providerless tests.",
			],
			suggestedValidation: [
				"Add an interleaving test that races two panel actions.",
			],
			behaviorChecks: behaviorChecks.map((check) => ({
				...check,
				result: "gap_recorded" as const,
				remainingGap:
					"Concurrent click interleaving remains unproven by providerless tests.",
			})),
			validationCoverage: [
				{
					...firstValidationCoverage,
					proves: [],
					gaps: [
						"Concurrent click interleaving remains unproven by providerless tests.",
					],
				},
			],
		};
		expect(
			describeFinalReviewCoverageFailure(session, worker, gapReview),
		).toBeNull();
		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...gapReview,
				remainingGaps: ["An unrelated follow-up remains."],
			}),
		).toContain(
			"gap_recorded remainingGap must match an entry in remainingGaps",
		);
		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...gapReview,
				remainingGaps: [],
			}),
		).toContain("gap_recorded must also list the gap in remainingGaps");
	});

	test("rejects approved final reviewer decisions when behavior coverage would fail", () => {
		const incompleteApproved = recordReviewerDecision(
			createSession("Review source-only behavior-sensitive changes"),
			{
				scope: "final",
				status: "approved",
				summary: "Final review approved without behavior accounting.",
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary: "Reviewed shell and game source changes.",
				validationAssessment: "Targeted behavior validation was reviewed.",
				evidenceRefs: {
					changedArtifacts: [
						"src/shell/sessionPanels.ts",
						"src/game/navigation.ts",
					],
					validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
				},
				integrationChecks: [
					"Checked shell action and game navigation handoff.",
				],
				regressionChecks: ["Checked behavior validation evidence."],
				remainingGaps: [],
			},
		);
		expect(incompleteApproved.ok).toBe(false);
		if (!incompleteApproved.ok) {
			expect(incompleteApproved.message).toContain(
				"Reviewer decision validation failed: finalReviewCoverage",
			);
			expect(incompleteApproved.message).toContain(
				"must account for required behavior risk classes",
			);
		}

		const incompleteNeedsFix = recordReviewerDecision(
			createSession("Record incomplete final review finding"),
			{
				scope: "final",
				status: "needs_fix",
				summary: "Final review found behavior gaps.",
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary: "Reviewed shell and game source changes.",
				validationAssessment: "Behavior accounting still needs fixes.",
				evidenceRefs: {
					changedArtifacts: [
						"src/shell/sessionPanels.ts",
						"src/game/navigation.ts",
					],
					validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
				},
				integrationChecks: [
					"Checked shell action and game navigation handoff.",
				],
				regressionChecks: ["Checked behavior validation evidence."],
				remainingGaps: [],
			},
		);
		expect(incompleteNeedsFix.ok).toBe(true);
	});

	test("requires concrete behavior accounting for source-only multi-domain app changes", () => {
		const session = createSession("Review source-only app behavior changes");
		const worker = {
			artifactsChanged: [
				{ path: "src/shell/sessionPanels.ts" },
				{ path: "src/game/navigation.ts" },
				{ path: "src/scenes/PracticeScene.ts" },
			],
			validationRun: [
				{
					command: "bun test tests/sessionPanelActions.test.ts",
				},
			],
		};
		const baseReview = {
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary: "Reviewed shell, game, scene, and validation evidence.",
			validationAssessment: "Behavior validation was reviewed.",
			evidenceRefs: {
				changedArtifacts: [
					"src/shell/sessionPanels.ts",
					"src/game/navigation.ts",
					"src/scenes/PracticeScene.ts",
				],
				validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
			},
			integrationChecks: [
				"Checked panel action, navigation state, and scene lifecycle integration.",
			],
			regressionChecks: ["Checked the behavior regression oracle."],
			remainingGaps: [],
		};

		expect(
			describeFinalReviewCoverageFailure(session, worker, baseReview),
		).toContain(
			"must account for required behavior risk classes: async_event_ordering, lifecycle_reentrancy, state_commit_rollback, test_oracle_authenticity",
		);

		const behaviorChecks = [
			{
				riskClass: "async_event_ordering" as const,
				result: "passed" as const,
				invariant: "Latest panel action wins after deferred navigation.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: ["src/game/navigation.ts"],
				lifecycleOwnerRefs: [],
				failurePath: "Earlier deferred click overrides later user intent.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "lifecycle_reentrancy" as const,
				result: "passed" as const,
				invariant: "Scene startup is not double-registered on re-entry.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: [],
				lifecycleOwnerRefs: ["src/scenes/PracticeScene.ts"],
				failurePath: "Panel re-entry registers duplicate scene callbacks.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "state_commit_rollback" as const,
				result: "passed" as const,
				invariant: "Navigation state commits after scene startup succeeds.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: ["src/game/navigation.ts"],
				lifecycleOwnerRefs: ["src/scenes/PracticeScene.ts"],
				failurePath: "State commits before scene startup throws.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "test_oracle_authenticity" as const,
				result: "passed" as const,
				invariant: "The test oracle exercises ordering and rollback behavior.",
				entrypointRefs: ["tests/sessionPanelActions.test.ts"],
				stateOwnerRefs: [],
				lifecycleOwnerRefs: [],
				failurePath: "Generic validation would miss stale action ordering.",
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
		];
		const validationCoverage = [
			{
				command: "bun test tests/sessionPanelActions.test.ts",
				behaviorClasses: [
					"async_event_ordering" as const,
					"lifecycle_reentrancy" as const,
					"state_commit_rollback" as const,
					"test_oracle_authenticity" as const,
				],
				proves: ["Panel ordering, lifecycle, rollback, and oracle coverage."],
				gaps: [],
				oracleRefs: ["tests/sessionPanelActions.test.ts"],
			},
		];

		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...baseReview,
				behaviorChecks,
				validationCoverage,
			}),
		).toBeNull();

		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...baseReview,
				behaviorChecks: behaviorChecks.map((check) =>
					check.riskClass === "async_event_ordering"
						? {
								...check,
								oracleRefs: ["tests/unreviewedBehavior.test.ts"],
							}
						: check,
				),
				validationCoverage,
			}),
		).toContain(
			"behaviorChecks[0].oracleRefs includes 'tests/unreviewedBehavior.test.ts', which is not grounded",
		);

		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...baseReview,
				behaviorChecks: behaviorChecks.map((check) =>
					check.riskClass === "lifecycle_reentrancy"
						? {
								...check,
								result: "not_applicable" as const,
							}
						: check,
				),
				validationCoverage,
			}),
		).toContain(
			"behaviorChecks[1] (lifecycle_reentrancy) required behavior risk cannot use not_applicable",
		);
		const [firstBehaviorCheck] = behaviorChecks;
		expect(firstBehaviorCheck).toBeDefined();
		if (!firstBehaviorCheck) return;
		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				...baseReview,
				behaviorChecks: [
					{
						...firstBehaviorCheck,
						entrypointRefs: ["src/unrelated/notChanged.ts"],
					},
					...behaviorChecks.slice(1),
				],
				validationCoverage,
			}),
		).toContain(
			"behaviorChecks[0].entrypointRefs includes 'src/unrelated/notChanged.ts', which is not grounded",
		);
	});

	test("normalizes behavior path refs and rejects unsafe behavior refs", () => {
		const parsed = FlowReviewRecordFinalArgsSchema.safeParse({
			scope: "final",
			status: "approved",
			summary: "Final review approved.",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Reviewed changed files.",
			validationAssessment: "Validation pending.",
			evidenceRefs: {
				changedArtifacts: ["src/shell/sessionPanels.ts"],
				validationCommands: ["bun test"],
			},
			behaviorChecks: [
				{
					riskClass: "async_event_ordering",
					result: "passed",
					invariant: "Latest event ordering wins.",
					entrypointRefs: [" ./src/shell/sessionPanels.ts:10-20 "],
					stateOwnerRefs: [],
					lifecycleOwnerRefs: [],
					failurePath: "Out-of-order completion overwrites newer state.",
					oracleRefs: [" ./tests/runtime/final-review-contracts.test.ts "],
					validationRefs: ["bun test"],
				},
			],
		});
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.behaviorChecks?.[0]?.entrypointRefs).toEqual([
			"src/shell/sessionPanels.ts:10-20",
		]);
		expect(parsed.data.behaviorChecks?.[0]?.oracleRefs).toEqual([
			"tests/runtime/final-review-contracts.test.ts",
		]);

		const [parsedBehaviorCheck] = parsed.data.behaviorChecks ?? [];
		expect(parsedBehaviorCheck).toBeDefined();
		if (!parsedBehaviorCheck) return;
		expect(
			FlowReviewRecordFinalArgsSchema.safeParse({
				...parsed.data,
				behaviorChecks: [
					{
						...parsedBehaviorCheck,
						oracleRefs: ["../escape.test.ts"],
					},
				],
			}).success,
		).toBe(false);
	});

	test("allows non-risk simple final review without behavior accounting", () => {
		const session = createSession("Review runtime-only final completion");
		const worker = {
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [{ command: "bun test" }],
		};

		expect(
			describeFinalReviewCoverageFailure(session, worker, {
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
				validationAssessment:
					"bun test was mapped to the session-completion regression oracle; no unchecked behavior gap remains for this runtime-only fixture.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Checked the session completion entrypoint against the runtime state/finalization boundary.",
				],
				regressionChecks: [
					"Checked bun test covers the session-completion regression path cited by the fixture.",
				],
				remainingGaps: [],
			}),
		).toBeNull();
	});

	test("grounds behavior validation refs and rejects needs_fix coverage", () => {
		const session = createSession(
			"Review soft-focus-like validation grounding",
		);
		const worker = {
			artifactsChanged: [
				{ path: "src/shell/sessionPanels.ts" },
				{ path: "src/game/navigation.ts" },
				{ path: "tests/sessionPanelActions.test.ts" },
			],
			validationRun: [
				{ command: "bun test tests/sessionPanelActions.test.ts" },
			],
		};
		const review = {
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
				"tests",
			],
			evidenceSummary: "Reviewed behavior-sensitive surfaces.",
			validationAssessment: "Validation was reviewed.",
			evidenceRefs: {
				changedArtifacts: [
					"src/shell/sessionPanels.ts",
					"src/game/navigation.ts",
					"tests/sessionPanelActions.test.ts",
				],
				validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
			},
			integrationChecks: ["Checked panel and navigation integration."],
			regressionChecks: ["Checked panel regression coverage."],
			remainingGaps: [],
			behaviorChecks: [
				{
					riskClass: "async_event_ordering" as const,
					result: "needs_fix" as const,
					invariant: "Latest panel action wins.",
					entrypointRefs: ["src/shell/sessionPanels.ts"],
					stateOwnerRefs: ["src/game/navigation.ts"],
					lifecycleOwnerRefs: [],
					failurePath: "Stale deferred action wins.",
					oracleRefs: [],
					validationRefs: ["bun test tests/missing.test.ts"],
				},
				{
					riskClass: "lifecycle_reentrancy" as const,
					result: "not_applicable" as const,
					invariant: "No lifecycle owner changed.",
					entrypointRefs: [],
					stateOwnerRefs: [],
					lifecycleOwnerRefs: [],
					failurePath: "No lifecycle entrypoint exists in this slice.",
					oracleRefs: [],
					validationRefs: [],
				},
				{
					riskClass: "state_commit_rollback" as const,
					result: "passed" as const,
					invariant: "State commits after navigation succeeds.",
					entrypointRefs: ["src/shell/sessionPanels.ts"],
					stateOwnerRefs: ["src/game/navigation.ts"],
					lifecycleOwnerRefs: [],
					failurePath: "State commits before navigation throws.",
					oracleRefs: ["tests/sessionPanelActions.test.ts"],
					validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
				},
				{
					riskClass: "test_oracle_authenticity" as const,
					result: "passed" as const,
					invariant: "Oracle exercises the behavior path.",
					entrypointRefs: ["tests/sessionPanelActions.test.ts"],
					stateOwnerRefs: [],
					lifecycleOwnerRefs: [],
					failurePath: "A generic smoke test would miss stale actions.",
					oracleRefs: ["tests/sessionPanelActions.test.ts"],
					validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
				},
			],
			validationCoverage: [
				{
					command: "bun test tests/missing.test.ts",
					behaviorClasses: ["async_event_ordering" as const],
					proves: ["Invalid command should not ground coverage."],
					gaps: [],
					oracleRefs: ["tests/sessionPanelActions.test.ts"],
				},
			],
		};

		const failure = describeFinalReviewCoverageFailure(session, worker, review);
		expect(failure).toContain("cannot use result needs_fix");
		expect(failure).toContain(
			"behaviorChecks[0].validationRefs includes 'bun test tests/missing.test.ts'",
		);
		expect(failure).toContain(
			"validationCoverage[0].command 'bun test tests/missing.test.ts' was not recorded in validationRun",
		);
		expect(failure).toContain(
			"must map evidenceRefs.validationCommands in validationCoverage",
		);
	});

	test("triggers behavior accounting from grounded state and lifecycle review context", () => {
		const session = createSession("Review runtime state and lifecycle context");
		const reviewContextPack = buildReviewContextPack({
			task: "Review runtime lifecycle ordering",
			changedFiles: ["src/runtime/transitions/execution.ts"],
			includedContext: [
				{
					path: "src/runtime/transitions/execution.ts",
					reason: "state_owner",
					summary: "Owns state transition rollback behavior.",
				},
				{
					path: "src/runtime/transitions/execution.ts",
					reason: "lifecycle_owner",
					summary: "Owns lifecycle re-entry behavior.",
				},
			],
			validationEvidence: [{ command: "bun test tests/runtime.test.ts" }],
		});

		const failure = describeFinalReviewCoverageFailure(
			session,
			{
				artifactsChanged: [{ path: "src/runtime/transitions/execution.ts" }],
				validationRun: [{ command: "bun test tests/runtime.test.ts" }],
			},
			{
				reviewDepth: "broad",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"operator_surfaces",
					"validation_evidence",
				],
				evidenceSummary: "Reviewed runtime state and lifecycle owners.",
				validationAssessment: "Runtime validation was reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/transitions/execution.ts"],
					validationCommands: ["bun test tests/runtime.test.ts"],
				},
				reviewContextPack,
			},
		);

		expect(failure).toContain(
			"must account for required behavior risk classes: lifecycle_reentrancy, state_commit_rollback, test_oracle_authenticity",
		);
	});

	test("trims review context pack schema fields and rejects unsafe paths", () => {
		const parsed = FlowReviewRecordFinalArgsSchema.safeParse({
			scope: "final",
			status: "approved",
			summary: "Final review approved.",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Reviewed changed files.",
			validationAssessment: "Validation pending.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [],
			},
			reviewContextPack: {
				task: "  Review runtime session completion  ",
				compareBase: "  main  ",
				changedFiles: [" ./src/runtime/session.ts "],
				includedContext: [
					{
						path: " ./tests/runtime/final-review-contracts.test.ts ",
						reason: "test_oracle",
						summary: "  Runtime final-review contract coverage.  ",
					},
				],
				relationships: [
					{
						from: " ./tests/runtime/final-review-contracts.test.ts ",
						to: " ./src/runtime/session.ts ",
						kind: "  validates  ",
						summary: "  Contract test validates runtime review.  ",
					},
				],
				validationEvidence: [
					{
						command:
							"  bun test tests/runtime/final-review-contracts.test.ts  ",
						status: "  passed  ",
						summary: "  Targeted validation passed.  ",
					},
				],
				suggestedValidation: [
					"  bun test tests/runtime/final-review-contracts.test.ts  ",
				],
				coverageGaps: ["  Broader prompt integration remains later.  "],
			},
		});

		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.reviewContextPack?.task).toBe(
			"Review runtime session completion",
		);
		expect(parsed.data.reviewContextPack?.compareBase).toBe("main");
		expect(parsed.data.reviewContextPack?.changedFiles).toEqual([
			"src/runtime/session.ts",
		]);
		expect(parsed.data.reviewContextPack?.includedContext[0]?.path).toBe(
			"tests/runtime/final-review-contracts.test.ts",
		);
		expect(parsed.data.reviewContextPack?.relationships[0]).toEqual({
			from: "tests/runtime/final-review-contracts.test.ts",
			to: "src/runtime/session.ts",
			kind: "validates",
			summary: "Contract test validates runtime review.",
		});
		expect(parsed.data.reviewContextPack?.validationEvidence[0]).toEqual({
			command: "bun test tests/runtime/final-review-contracts.test.ts",
			status: "passed",
			summary: "Targeted validation passed.",
		});
		expect(parsed.data.reviewContextPack?.suggestedValidation).toEqual([
			"bun test tests/runtime/final-review-contracts.test.ts",
		]);
		expect(parsed.data.reviewContextPack?.coverageGaps).toEqual([
			"Broader prompt integration remains later.",
		]);

		for (const unsafePath of [
			"../escape.ts",
			"/tmp/escape.ts",
			"C:/tmp/escape.ts",
			"src//runtime/session.ts",
		]) {
			const unsafe = FlowReviewRecordFinalArgsSchema.safeParse({
				scope: "final",
				status: "approved",
				summary: "Final review approved.",
				reviewDepth: "broad",
				reviewedSurfaces: ["changed_files"],
				evidenceSummary: "Reviewed changed files.",
				validationAssessment: "Validation pending.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: [],
				},
				reviewContextPack: {
					task: "Review runtime session completion",
					changedFiles: [unsafePath],
					includedContext: [
						{
							path: "src/runtime/session.ts",
							reason: "changed_file",
						},
					],
					relationships: [
						{
							from: "src/runtime/session.ts",
							to: unsafePath,
							kind: "touches",
							summary: "Unsafe endpoint should be rejected.",
						},
					],
				},
			});
			expect(unsafe.success).toBe(false);
		}
	});

	test("allows final completion when broad validation and final review both pass", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary:
				"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
			validationAssessment:
				"bun test was mapped to the session-completion regression oracle; no unchecked behavior gap remains for this runtime-only fixture.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: [
				"Checked the session completion entrypoint against the runtime state/finalization boundary.",
			],
			regressionChecks: [
				"Checked bun test covers the session-completion regression path cited by the fixture.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review checked the runtime path and validation oracle.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
			finalReview: {
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
				validationAssessment:
					"bun test was mapped to the session-completion regression oracle; no unchecked behavior gap remains for this runtime-only fixture.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Checked the session completion entrypoint against the runtime state/finalization boundary.",
				],
				regressionChecks: [
					"Checked bun test covers the session-completion regression path cited by the fixture.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Repo-wide validation is clean.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		expect(completed.value.status).toBe("completed");
	});

	test("defaults missing evidenceRefs when parsing persisted final review records", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary:
				"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
			validationAssessment:
				"bun test was mapped to the session-completion regression oracle; no unchecked behavior gap remains for this runtime-only fixture.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: [
				"Checked the session completion entrypoint against the runtime state/finalization boundary.",
			],
			regressionChecks: [
				"Checked bun test covers the session-completion regression path cited by the fixture.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review checked the runtime path and validation oracle.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
			finalReview: {
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
				validationAssessment:
					"bun test was mapped to the session-completion regression oracle; no unchecked behavior gap remains for this runtime-only fixture.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Checked the session completion entrypoint against the runtime state/finalization boundary.",
				],
				regressionChecks: [
					"Checked bun test covers the session-completion regression path cited by the fixture.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Final review checked the runtime path and validation oracle.",
				blockingFindings: [],
			},
		});
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		const sessionMissingEvidenceRefs = JSON.parse(
			JSON.stringify(completed.value),
		);
		sessionMissingEvidenceRefs.execution.lastReviewerDecision.evidenceRefs =
			undefined;
		sessionMissingEvidenceRefs.execution.history.at(
			-1,
		).reviewerDecision.evidenceRefs = undefined;
		sessionMissingEvidenceRefs.execution.history.at(
			-1,
		).finalReview.evidenceRefs = undefined;

		const parsed = SessionSchema.safeParse(sessionMissingEvidenceRefs);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.execution.lastReviewerDecision?.scope).toBe("final");
		if (parsed.data.execution.lastReviewerDecision?.scope === "final") {
			expect(parsed.data.execution.lastReviewerDecision.evidenceRefs).toEqual({
				changedArtifacts: [],
				validationCommands: [],
			});
		}
		expect(
			parsed.data.execution.history.at(-1)?.finalReview?.evidenceRefs,
		).toEqual({
			changedArtifacts: [],
			validationCommands: [],
		});
	});

	test("rejects lite-lane final completion without a separately recorded final reviewer decision", () => {
		const session = createSession("Ship a tiny fix");
		const liteFeature = samplePlan().features[0];
		if (!liteFeature) {
			throw new Error("Missing lite feature fixture.");
		}
		const plan = {
			...samplePlan(),
			features: [liteFeature],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const completed = completeRun(started.value.session, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed tiny fix.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Tiny fix tests passed.",
				},
			],
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: liteFeature.id,
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
			finalReview: {
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
				validationAssessment:
					"bun test was mapped to the session-completion regression oracle; no unchecked behavior gap remains for this runtime-only fixture.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Checked the session completion entrypoint against the runtime state/finalization boundary.",
				],
				regressionChecks: [
					"Checked bun test covers the session-completion regression path cited by the fixture.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Final review checked the runtime path and validation oracle.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe(
			"missing_final_reviewer_decision",
		);
		expect(completed.recovery?.prerequisite).toBe("reviewer_result_required");
		expect(completed.recovery?.requiredArtifact).toBe(
			"final_reviewer_decision",
		);
	});
});
