/**
 * Hard completion invariants. Everything judgment-shaped (coverage
 * proportionality, scope accounting, evidence quality) moved to the
 * flow-review skill rubric in v3; what remains here is binary and cheap:
 *
 * 1. A feature cannot complete without recorded, passing validation evidence
 *    with the scope the completion path requires (targeted vs broad).
 * 2. A feature cannot complete without a passing featureReview payload; the
 *    final completion path additionally requires a passing finalReview whose
 *    depth matches deliveryPolicy.finalReviewPolicy.
 * 3. Strict review governance (goalMode review/review_and_fix or
 *    deliveryPolicy.strictReview) requires a recorded approved reviewer
 *    decision whose scope matches the completion path.
 */
import {
	finalReviewPolicyForPlan,
	strictReviewGovernanceRequiredForPlan,
} from "../domain";
import type { Session, WorkerResultArgs } from "../schema";
import {
	type NormalizedWorkerResult,
	normalizeWorkerResult,
} from "./execution-completion-normalization";
import {
	buildCompletionRecovery,
	type CompletionRecoveryKind,
} from "./recovery";
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

function reviewerDecisionFailureMessage(
	session: Session,
	featureId: string,
	wasFinalFeature: boolean,
): string | null {
	if (!strictReviewGovernanceRequiredForPlan(session.plan)) {
		return null;
	}

	const decision = session.execution.lastReviewerDecision;
	if (!decision || decision.status !== "approved") {
		return "Worker result cannot complete without a recorded approved reviewer decision.";
	}
	if (!wasFinalFeature) {
		return decision.scope === "feature" && decision.featureId === featureId
			? null
			: "Worker result cannot complete without a recorded approved reviewer decision.";
	}
	if (decision.scope !== "final") {
		return "Worker result cannot complete the session without a final-scope approved reviewer decision.";
	}
	if (decision.reviewDepth !== finalReviewPolicyForPlan(session.plan)) {
		return "Worker result cannot complete the session because the recorded final reviewer decision does not match deliveryPolicy.finalReviewPolicy.";
	}
	return null;
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
	if (
		worker.finalReview.reviewDepth !== finalReviewPolicyForPlan(session.plan)
	) {
		return "Worker result cannot complete the feature because finalReview does not match deliveryPolicy.finalReviewPolicy.";
	}
	return null;
}

function isValidationPassing(
	validationRun: NormalizedWorkerResult["validationRun"],
): boolean {
	return (
		validationRun.length > 0 &&
		validationRun.every((item) => item.status === "passed")
	);
}

function failCompletion(
	featureId: string,
	wasFinalFeature: boolean,
	message: string,
	kind: CompletionRecoveryKind,
): TransitionResult<void> {
	return fail(
		message,
		buildCompletionRecovery(featureId, wasFinalFeature, kind),
	);
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
		return failCompletion(
			featureId,
			wasFinalFeature,
			"Worker result cannot complete the feature without recorded validation evidence.",
			"missing_validation",
		);
	}
	if (!isValidationPassing(normalizedWorker.validationRun)) {
		return failCompletion(
			featureId,
			wasFinalFeature,
			"Worker result cannot complete the feature because validation did not fully pass.",
			"failing_validation",
		);
	}

	const reviewerDecisionFailure = reviewerDecisionFailureMessage(
		session,
		featureId,
		wasFinalFeature,
	);
	if (reviewerDecisionFailure) {
		return failCompletion(
			featureId,
			wasFinalFeature,
			reviewerDecisionFailure,
			"missing_reviewer_decision",
		);
	}

	if (!wasFinalFeature && normalizedWorker.validationScope !== "targeted") {
		return failCompletion(
			featureId,
			false,
			"Worker result cannot complete the feature without targeted validation.",
			"missing_validation_scope",
		);
	}
	if (wasFinalFeature && normalizedWorker.validationScope !== "broad") {
		return failCompletion(
			featureId,
			true,
			"Worker result cannot complete the session without broad final validation.",
			"missing_validation_scope",
		);
	}

	if (!isReviewPassing(normalizedWorker.featureReview)) {
		return failCompletion(
			featureId,
			wasFinalFeature,
			"Worker result cannot complete the feature because featureReview is not passing.",
			"failing_feature_review",
		);
	}

	const finalReviewFailure = finalReviewFailureMessage(
		session,
		normalizedWorker,
	);
	if (finalReviewFailure) {
		return failCompletion(
			featureId,
			wasFinalFeature,
			finalReviewFailure,
			"failing_final_review",
		);
	}
	if (wasFinalFeature && !normalizedWorker.finalReview) {
		return failCompletion(
			featureId,
			true,
			"Worker result cannot complete the session without a finalReview.",
			"missing_final_review",
		);
	}

	return succeed(undefined);
}
