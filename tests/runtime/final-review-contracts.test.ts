// Owns final-review payload and lite-lane final approval coverage previously
// grouped in tests/runtime-completion-contracts.test.ts.
import { describe, expect, test } from "bun:test";
import {
	buildReviewContextPack,
	describeFinalReviewCoverageFailure,
	describeReviewContextPackGroundingFailure,
	reviewContextPackHasSurfaceEvidence,
} from "../../src/runtime/domain";
import {
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
				"Checked final cross-feature integration and validation evidence.",
			validationAssessment:
				"Validation coverage and cross-feature interactions were reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
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
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
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
				"Checked final cross-feature integration and validation evidence.",
			validationAssessment:
				"Validation coverage and cross-feature interactions were reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
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
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Final review looks good.",
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
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Final review looks good.",
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
