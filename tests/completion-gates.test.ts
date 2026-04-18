import { describe, expect, test } from "bun:test";
import type { Session, WorkerResult } from "../src/runtime/schema";
import { createSession } from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import { validateSuccessfulCompletion } from "../src/runtime/transitions/execution-completion-guards";
import { samplePlan } from "./runtime-test-helpers";

function createStartedSession(options?: {
	finalFeature?: boolean;
	reviewerDecision?: Session["execution"]["lastReviewerDecision"];
	requireFinalReview?: boolean;
}): {
	session: Session;
	featureId: string;
	wasFinalFeature: boolean;
	requireFinalReview: boolean;
} {
	const finalFeature = options?.finalFeature ?? false;
	const requireFinalReview = options?.requireFinalReview ?? false;
	const basePlan = samplePlan();
	const plan = finalFeature
		? {
				...basePlan,
				completionPolicy: {
					minCompletedFeatures: 1,
					...(requireFinalReview ? { requireFinalReview: true } : {}),
				},
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
		requireFinalReview,
	};
}

function approvedFeatureDecision(
	featureId = "setup-runtime",
): NonNullable<Session["execution"]["lastReviewerDecision"]> {
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

function approvedFinalDecision(): NonNullable<
	Session["execution"]["lastReviewerDecision"]
> {
	return {
		scope: "final",
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
		artifactsChanged: [],
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
					requireFinalReview: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationScope: "broad",
					finalReview: {
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
	])("returns $expectedErrorCode for $name", ({
		setup,
		worker,
		expectedErrorCode,
		expectedNextCommand,
	}) => {
		const { session, featureId, wasFinalFeature, requireFinalReview } = setup();
		const result = validateSuccessfulCompletion(
			session,
			worker(featureId),
			featureId,
			wasFinalFeature,
			requireFinalReview,
		);

		expect(result.ok).toBe(false);
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
		const { session, featureId, wasFinalFeature, requireFinalReview } =
			createStartedSession({
				finalFeature: true,
				reviewerDecision,
			});
		const result = validateSuccessfulCompletion(
			session,
			createWorkerResult(featureId, {
				validationScope: "broad",
				finalReview: {
					status: "passed",
					summary: "Repo-wide validation is clean.",
					blockingFindings: [],
				},
			}),
			featureId,
			wasFinalFeature,
			requireFinalReview,
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
