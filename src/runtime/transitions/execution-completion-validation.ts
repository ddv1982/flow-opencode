import type { Session, WorkerResultArgs } from "../schema";
import { deriveExecutionLane } from "../session-operator-state";
import {
	type NormalizedWorkerResult,
	normalizeWorkerResult,
} from "./execution-completion-normalization";
import type { CompletionRecoveryKind } from "./recovery";
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
	const inlineLiteReviewSatisfied =
		deriveExecutionLane(session).lane === "lite" &&
		(wasFinalFeature
			? worker.validationScope === "broad" &&
				isReviewPassing(worker.finalReview)
			: isReviewPassing(worker.featureReview));
	if (inlineLiteReviewSatisfied) {
		return true;
	}

	const decision = session.execution.lastReviewerDecision;
	if (!decision || decision.status !== "approved") {
		return false;
	}

	return wasFinalFeature
		? decision.scope === "final"
		: decision.scope === "feature" && decision.featureId === featureId;
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

	const completionChecks: Array<{
		kind: CompletionRecoveryKind;
		message: string;
		failing: () => boolean;
	}> = [
		{
			kind: "missing_validation",
			message:
				"Worker result cannot complete the feature without recorded validation evidence.",
			failing: () => normalizedWorker.validationRun.length === 0,
		},
		{
			kind: "failing_validation",
			message:
				"Worker result cannot complete the feature because validation did not fully pass.",
			failing: () => !isValidationPassing(normalizedWorker.validationRun),
		},
		{
			kind: "missing_reviewer_decision",
			message:
				"Worker result cannot complete without a recorded approved reviewer decision.",
			failing: () =>
				!hasApprovedReviewerDecision(
					session,
					normalizedWorker,
					featureId,
					wasFinalFeature,
				),
		},
		{
			kind: "missing_validation_scope",
			message:
				"Worker result cannot complete the feature without targeted validation.",
			failing: () =>
				!wasFinalFeature && normalizedWorker.validationScope !== "targeted",
		},
		{
			kind: "failing_feature_review",
			message:
				"Worker result cannot complete the feature because featureReview is not passing.",
			failing: () => !isReviewPassing(normalizedWorker.featureReview),
		},
		{
			kind: "failing_final_review",
			message:
				"Worker result cannot complete the feature because finalReview is not passing.",
			failing: () =>
				Boolean(
					normalizedWorker.finalReview &&
						!isReviewPassing(normalizedWorker.finalReview),
				),
		},
		{
			kind: "missing_validation_scope",
			message:
				"Worker result cannot complete the session without broad final validation.",
			failing: () =>
				wasFinalFeature && normalizedWorker.validationScope !== "broad",
		},
		{
			kind: "missing_final_review",
			message:
				"Worker result cannot complete the session without a finalReview.",
			failing: () => wasFinalFeature && !normalizedWorker.finalReview,
		},
	];

	for (const check of completionChecks) {
		if (check.failing()) {
			return fail(
				check.message,
				buildCompletionRecovery(featureId, wasFinalFeature, check.kind),
			);
		}
	}

	return succeed(undefined);
}
