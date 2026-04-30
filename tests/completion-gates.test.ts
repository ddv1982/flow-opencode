import { describe, expect, test } from "bun:test";
import type { Session, WorkerResult } from "../src/runtime/schema";
import { createSession } from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import { validateSuccessfulCompletion } from "../src/runtime/transitions/shared";
import { samplePlan } from "./runtime-test-helpers";

function createStartedSession(options?: {
	finalFeature?: boolean;
	finalReviewPolicy?: "broad" | "detailed";
	reviewerDecision?: Session["execution"]["lastReviewerDecision"];
}): {
	session: Session;
	featureId: string;
	wasFinalFeature: boolean;
} {
	const finalFeature = options?.finalFeature ?? false;
	const basePlan = samplePlan();
	const plan = finalFeature
		? {
				...basePlan,
				completionPolicy: {
					minCompletedFeatures: 1,
				},
				deliveryPolicy: options?.finalReviewPolicy
					? { finalReviewPolicy: options.finalReviewPolicy }
					: undefined,
				features: [basePlan.features[0]],
			}
		: basePlan;

	const applied = applyPlan(createSession("Build a workflow plugin"), plan);
	expect(applied.ok).toBe(true);
	if (!applied.ok) {
		throw new Error("Expected plan apply to succeed in test setup.");
	}

	const approved = approvePlan(applied.value);
	expect(approved.ok).toBe(true);
	if (!approved.ok) {
		throw new Error("Expected plan approval to succeed in test setup.");
	}

	const started = startRun(approved.value);
	expect(started.ok).toBe(true);
	if (!started.ok) {
		throw new Error("Expected run start to succeed in test setup.");
	}

	const featureId = started.value.session.execution.activeFeatureId;
	if (!featureId) {
		throw new Error("Expected an active feature in test setup.");
	}

	const session = options?.reviewerDecision
		? (() => {
				const reviewed = recordReviewerDecision(
					started.value.session,
					options.reviewerDecision,
				);
				expect(reviewed.ok).toBe(true);
				if (!reviewed.ok) {
					throw new Error(
						"Expected reviewer decision to record successfully in test setup.",
					);
				}
				return reviewed.value;
			})()
		: started.value.session;

	return {
		session,
		featureId,
		wasFinalFeature: finalFeature,
	};
}

function approvedFeatureDecision(
	featureId = "setup-runtime",
): Extract<
	NonNullable<Session["execution"]["lastReviewerDecision"]>,
	{ scope: "feature" }
> {
	return {
		scope: "feature",
		featureId,
		status: "approved",
		summary: "Looks good.",
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function approvedFinalDecision(): Extract<
	NonNullable<Session["execution"]["lastReviewerDecision"]>,
	{ scope: "final" }
> {
	return {
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
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function createWorkerResult(
	featureId: string,
	overrides: Partial<WorkerResult> = {},
): WorkerResult {
	const result = {
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
		validationScope: "targeted",
		reviewIterations: 1,
		decisions: [],
		nextStep: "Run the next feature.",
		outcome: { kind: "completed" },
		featureResult: {
			featureId,
			verificationStatus: "passed",
		},
		featureReview: {
			status: "passed",
			summary: "Looks good.",
			blockingFindings: [],
		},
		...overrides,
	} as WorkerResult;

	return result;
}

describe("completion gates", () => {
	test.each([
		{
			name: "missing validation evidence",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, { validationRun: [] }),
			expectedErrorCode: "missing_validation_evidence",
		},
		{
			name: "failing validation",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationRun: [
						{
							command: "bun test",
							status: "failed",
							summary: "Runtime tests failed.",
						},
					],
				}),
			expectedErrorCode: "failing_validation",
		},
		{
			name: "missing reviewer decision",
			setup: () => createStartedSession(),
			worker: (featureId: string) => createWorkerResult(featureId),
			expectedErrorCode: "missing_feature_reviewer_decision",
		},
		{
			name: "lite lane can use in-band final review instead of a separate reviewer decision",
			setup: () => {
				const basePlan = samplePlan();
				const liteFeature = basePlan.features[0];
				if (!liteFeature) {
					throw new Error("Missing lite feature fixture.");
				}

				const applied = applyPlan(createSession("Ship a tiny fix"), {
					...basePlan,
					features: [liteFeature],
				});
				expect(applied.ok).toBe(true);
				if (!applied.ok) {
					throw new Error("Expected plan apply to succeed in test setup.");
				}

				const approved = approvePlan(applied.value);
				expect(approved.ok).toBe(true);
				if (!approved.ok) {
					throw new Error("Expected plan approval to succeed in test setup.");
				}

				const started = startRun(approved.value);
				expect(started.ok).toBe(true);
				if (!started.ok) {
					throw new Error("Expected run start to succeed in test setup.");
				}

				const featureId = started.value.session.execution.activeFeatureId;
				if (!featureId) {
					throw new Error("Expected an active feature in test setup.");
				}

				return {
					session: started.value.session,
					featureId,
					wasFinalFeature: true,
				};
			},
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationScope: "broad",
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
				}),
			expectedOk: true,
		},
		{
			name: "missing targeted validation scope on non-final feature",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, { validationScope: "broad" }),
			expectedErrorCode: "missing_targeted_validation",
		},
		{
			name: "failing feature review",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					featureReview: {
						status: "failed",
						summary: "Blocking issues remain.",
						blockingFindings: [{ summary: "A blocking issue remains." }],
					},
				}),
			expectedErrorCode: "failing_feature_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "failing optional final review on non-final feature",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
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
						status: "failed",
						summary: "Repo validation failed.",
						blockingFindings: [{ summary: "Repo-wide issue remains." }],
					},
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "missing broad scope on final feature",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) => createWorkerResult(featureId),
			expectedErrorCode: "missing_broad_validation",
		},
		{
			name: "missing final review on final feature",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, { validationScope: "broad" }),
			expectedErrorCode: "missing_final_review_payload",
		},
		{
			name: "required final review not passing",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationScope: "broad",
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
						status: "failed",
						summary: "Repo-wide validation is blocked.",
						blockingFindings: [
							{ summary: "A blocking repo-wide issue remains." },
						],
					},
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "final review depth must match delivery policy",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					finalReviewPolicy: "broad",
					reviewerDecision: {
						...approvedFinalDecision(),
						reviewDepth: "broad",
					},
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationScope: "broad",
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
						summary: "Detailed final review looks good.",
						blockingFindings: [],
					},
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "final reviewer decision must cover derived docs and prompt surfaces",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					artifactsChanged: [{ path: "./docs/development.md" }],
					validationScope: "broad",
					finalReview: {
						reviewDepth: "detailed",
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
							"docs_and_prompts",
						],
						evidenceSummary:
							"Reviewed changed docs and prompt surfaces together with validation evidence.",
						validationAssessment:
							"Validation coverage and changed docs/prompt surfaces were reviewed.",
						evidenceRefs: {
							changedArtifacts: ["docs/development.md"],
							validationCommands: ["bun test"],
						},
						integrationChecks: [
							"Checked that prompt-facing guidance still matches runtime behavior.",
						],
						regressionChecks: [
							"Checked that the docs surface stays aligned with runtime review policy.",
						],
						remainingGaps: [],
						status: "passed",
						summary: "Final review looks good.",
						blockingFindings: [],
					},
				}),
			expectedErrorCode: "missing_final_reviewer_decision",
		},
		{
			name: "final review payload must cover derived docs and prompt surfaces",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: {
						...approvedFinalDecision(),
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
							"docs_and_prompts",
						],
						evidenceRefs: {
							changedArtifacts: ["docs/development.md"],
							validationCommands: ["bun test"],
						},
					},
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					artifactsChanged: [{ path: "./docs/development.md" }],
					validationScope: "broad",
					finalReview: {
						reviewDepth: "detailed",
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
						],
						evidenceSummary:
							"Reviewed final runtime state and validation evidence.",
						validationAssessment:
							"Validation coverage and cross-feature interactions were reviewed.",
						evidenceRefs: {
							changedArtifacts: ["src/runtime/session.ts"],
							validationCommands: ["bun test"],
						},
						integrationChecks: [
							"Checked that prompt-facing guidance still matches runtime behavior.",
						],
						regressionChecks: [
							"Checked that the runtime change does not regress existing review behavior.",
						],
						remainingGaps: [],
						status: "passed",
						summary: "Final review looks good.",
						blockingFindings: [],
					},
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "final review payload must cover derived colocated test surfaces",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: {
						...approvedFinalDecision(),
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
							"tests",
						],
					},
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					artifactsChanged: [{ path: "src/runtime/session.test.ts" }],
					validationScope: "broad",
					finalReview: {
						reviewDepth: "detailed",
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
						],
						evidenceSummary:
							"Reviewed runtime changes and validation evidence.",
						validationAssessment:
							"Validation coverage and cross-feature interactions were reviewed.",
						evidenceRefs: {
							changedArtifacts: ["src/runtime/session.ts"],
							validationCommands: ["bun test"],
						},
						integrationChecks: [
							"Checked that final runtime behavior stays coherent.",
						],
						regressionChecks: [
							"Checked that the runtime change does not regress existing review behavior.",
						],
						remainingGaps: [],
						status: "passed",
						summary: "Final review looks good.",
						blockingFindings: [],
					},
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
	])("validates $name", ({
		setup,
		worker,
		expectedErrorCode,
		expectedNextCommand,
		expectedOk,
	}) => {
		const { session, featureId, wasFinalFeature } = setup();
		const result = validateSuccessfulCompletion(
			session,
			worker(featureId),
			featureId,
			wasFinalFeature,
		);

		expect(result.ok).toBe(expectedOk ?? false);
		if (result.ok) {
			return;
		}

		expect(result.recovery?.errorCode).toBe(expectedErrorCode);
		if (expectedNextCommand) {
			expect(result.recovery?.nextCommand).toBe(expectedNextCommand);
		}
	});

	test.each([
		{
			name: "feature-scope reviewer decision does not satisfy final-feature gate",
			reviewerDecision: {
				...approvedFeatureDecision(),
				summary: "Feature looks good.",
			},
			expectedOk: false,
		},
		{
			name: "final-scope reviewer decision satisfies final-feature gate",
			reviewerDecision: {
				...approvedFinalDecision(),
				summary: "Final review looks good.",
			},
			expectedOk: true,
		},
	])("$name", ({ reviewerDecision, expectedOk }) => {
		const { session, featureId, wasFinalFeature } = createStartedSession({
			finalFeature: true,
			reviewerDecision,
		});
		const result = validateSuccessfulCompletion(
			session,
			createWorkerResult(featureId, {
				validationScope: "broad",
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
			}),
			featureId,
			wasFinalFeature,
		);

		expect(result.ok).toBe(expectedOk);
		if (!expectedOk) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.recovery?.errorCode).toBe(
					"missing_final_reviewer_decision",
				);
			}
		}
	});
});
