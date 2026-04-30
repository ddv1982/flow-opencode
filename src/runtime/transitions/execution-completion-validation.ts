import {
	describeFinalReviewCoverageFailure,
	finalReviewDepthMatchesPolicy,
} from "../domain";
import type { Session, WorkerResultArgs } from "../schema";
import { deriveExecutionLane } from "../session-operator-state";
import {
	type NormalizedWorkerResult,
	normalizeWorkerResult,
} from "./execution-completion-normalization";
import { buildCompletionRecovery } from "./recovery";
import { fail, succeed, type TransitionResult } from "./shared";

function isReviewPassing(
	review:
		| NormalizedWorkerResult["featureReview"]
		| NormalizedWorkerResult["finalReview"]
		| undefined,
): boolean {
	return Boolean(
		review &&
			review.status === "passed" &&
			review.blockingFindings.length === 0,
	);
}

function isValidationPassing(
	validationRun: NormalizedWorkerResult["validationRun"],
): boolean {
	return (
		validationRun.length > 0 &&
		validationRun.every((item) => item.status === "passed")
	);
}

function hasApprovedReviewerDecision(
	session: Session,
	worker: NormalizedWorkerResult,
	featureId: string,
	wasFinalFeature: boolean,
): boolean {
	const executionLane = deriveExecutionLane(session).lane;
	if (executionLane === "lite" && !wasFinalFeature) {
		return isReviewPassing(worker.featureReview);
	}
	if (executionLane === "lite" && wasFinalFeature && worker.finalReview) {
		return true;
	}

	const decision = session.execution.lastReviewerDecision;
	if (!decision || decision.status !== "approved") {
		return false;
	}

	return wasFinalFeature
		? decision.scope === "final" &&
				finalReviewDepthMatchesPolicy(session, decision.reviewDepth) &&
				describeFinalReviewCoverageFailure(session, worker, decision) === null
		: decision.scope === "feature" && decision.featureId === featureId;
}

function finalReviewerDecisionFailureMessage(
	session: Session,
	worker: NormalizedWorkerResult,
	featureId: string,
	wasFinalFeature: boolean,
): string | null {
	if (!wasFinalFeature) {
		return hasApprovedReviewerDecision(session, worker, featureId, false)
			? null
			: "Worker result cannot complete without a recorded approved reviewer decision.";
	}

	const executionLane = deriveExecutionLane(session).lane;
	if (executionLane === "lite" && worker.finalReview) {
		return null;
	}

	const decision = session.execution.lastReviewerDecision;
	if (!decision || decision.status !== "approved") {
		return "Worker result cannot complete without a recorded approved reviewer decision.";
	}
	if (decision.scope !== "final") {
		return "Worker result cannot complete the session without a final-scope approved reviewer decision.";
	}
	if (!finalReviewDepthMatchesPolicy(session, decision.reviewDepth)) {
		return "Worker result cannot complete the session because the recorded final reviewer decision does not match deliveryPolicy.finalReviewPolicy.";
	}
	const coverageFailure = describeFinalReviewCoverageFailure(
		session,
		worker,
		decision,
	);
	return coverageFailure
		? `Worker result cannot complete the session because the recorded final reviewer decision ${coverageFailure}.`
		: null;
}

function finalReviewFailureMessage(
	session: Session,
	worker: NormalizedWorkerResult,
): string | null {
	if (!worker.finalReview) {
		return null;
	}
	if (!isReviewPassing(worker.finalReview)) {
		return "Worker result cannot complete the feature because finalReview is not passing.";
	}
	if (!finalReviewDepthMatchesPolicy(session, worker.finalReview.reviewDepth)) {
		return "Worker result cannot complete the feature because finalReview does not match deliveryPolicy.finalReviewPolicy.";
	}
	const coverageFailure = describeFinalReviewCoverageFailure(
		session,
		worker,
		worker.finalReview,
	);
	return coverageFailure
		? `Worker result cannot complete the feature because finalReview ${coverageFailure}.`
		: null;
}

export function validateSuccessfulCompletion(
	session: Session,
	worker: WorkerResultArgs,
	featureId: string,
	wasFinalFeature: boolean,
): TransitionResult<void> {
	return validateNormalizedSuccessfulCompletion(
		session,
		normalizeWorkerResult(worker),
		featureId,
		wasFinalFeature,
	);
}

export function validateNormalizedSuccessfulCompletion(
	session: Session,
	normalizedWorker: NormalizedWorkerResult,
	featureId: string,
	wasFinalFeature: boolean,
): TransitionResult<void> {
	if (
		normalizedWorker.outcome?.kind &&
		normalizedWorker.outcome.kind !== "completed"
	) {
		return fail(
			`Worker result validation failed: outcome.kind: expected "completed", received "${normalizedWorker.outcome.kind}"`,
		);
	}

	if (normalizedWorker.validationRun.length === 0) {
		return fail(
			"Worker result cannot complete the feature without recorded validation evidence.",
			buildCompletionRecovery(featureId, wasFinalFeature, "missing_validation"),
		);
	}
	if (!isValidationPassing(normalizedWorker.validationRun)) {
		return fail(
			"Worker result cannot complete the feature because validation did not fully pass.",
			buildCompletionRecovery(featureId, wasFinalFeature, "failing_validation"),
		);
	}

	if (!wasFinalFeature) {
		const reviewerDecisionFailure = finalReviewerDecisionFailureMessage(
			session,
			normalizedWorker,
			featureId,
			false,
		);
		if (reviewerDecisionFailure) {
			return fail(
				reviewerDecisionFailure,
				buildCompletionRecovery(featureId, false, "missing_reviewer_decision"),
			);
		}
		if (normalizedWorker.validationScope !== "targeted") {
			return fail(
				"Worker result cannot complete the feature without targeted validation.",
				buildCompletionRecovery(featureId, false, "missing_validation_scope"),
			);
		}
	}
	if (wasFinalFeature && normalizedWorker.validationScope !== "broad") {
		return fail(
			"Worker result cannot complete the session without broad final validation.",
			buildCompletionRecovery(featureId, true, "missing_validation_scope"),
		);
	}
	if (!isReviewPassing(normalizedWorker.featureReview)) {
		return fail(
			"Worker result cannot complete the feature because featureReview is not passing.",
			buildCompletionRecovery(
				featureId,
				wasFinalFeature,
				"failing_feature_review",
			),
		);
	}

	const finalReviewFailure = finalReviewFailureMessage(
		session,
		normalizedWorker,
	);
	if (finalReviewFailure) {
		return fail(
			finalReviewFailure,
			buildCompletionRecovery(
				featureId,
				wasFinalFeature,
				"failing_final_review",
			),
		);
	}
	if (wasFinalFeature && !normalizedWorker.finalReview) {
		return fail(
			"Worker result cannot complete the session without a finalReview.",
			buildCompletionRecovery(
				featureId,
				wasFinalFeature,
				"missing_final_review",
			),
		);
	}

	if (wasFinalFeature) {
		const reviewerDecisionFailure = finalReviewerDecisionFailureMessage(
			session,
			normalizedWorker,
			featureId,
			true,
		);
		if (reviewerDecisionFailure) {
			return fail(
				reviewerDecisionFailure,
				buildCompletionRecovery(featureId, true, "missing_reviewer_decision"),
			);
		}
	}

	return succeed(undefined);
}
