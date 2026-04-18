import type { Session, WorkerResult } from "../schema";
import {
	buildCompletionRecovery,
	type CompletionRecoveryKind,
} from "./execution-recovery";
import { fail, succeed, type TransitionResult } from "./shared";

function hasApprovedReviewerDecision(
	session: Session,
	featureId: string,
	wasFinalFeature: boolean,
): boolean {
	const decision = session.execution.lastReviewerDecision;
	if (!decision || decision.status !== "approved") {
		return false;
	}

	if (wasFinalFeature) {
		return decision.scope === "final";
	}

	return decision.scope === "feature" && decision.featureId === featureId;
}

function isReviewPassing(
	review:
		| WorkerResult["featureReview"]
		| WorkerResult["finalReview"]
		| undefined,
): boolean {
	if (!review) {
		return false;
	}

	return review.status === "passed" && review.blockingFindings.length === 0;
}

function isValidationPassing(
	validationRun: WorkerResult["validationRun"],
): boolean {
	return (
		validationRun.length > 0 &&
		validationRun.every((item) => item.status === "passed")
	);
}

export function validateSuccessfulCompletion(
	session: Session,
	worker: WorkerResult,
	featureId: string,
	wasFinalFeature: boolean,
): TransitionResult<void> {
	if (worker.outcome?.kind && worker.outcome.kind !== "completed") {
		return fail(
			`Worker result validation failed: outcome.kind: expected "completed", received "${worker.outcome.kind}"`,
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
			failing: () => worker.validationRun.length === 0,
		},
		{
			kind: "failing_validation",
			message:
				"Worker result cannot complete the feature because validation did not fully pass.",
			failing: () => !isValidationPassing(worker.validationRun),
		},
		{
			kind: "missing_reviewer_decision",
			message:
				"Worker result cannot complete without a recorded approved reviewer decision.",
			failing: () =>
				!hasApprovedReviewerDecision(session, featureId, wasFinalFeature),
		},
		{
			kind: "missing_validation_scope",
			message:
				"Worker result cannot complete the feature without targeted validation.",
			failing: () => !wasFinalFeature && worker.validationScope !== "targeted",
		},
		{
			kind: "failing_feature_review",
			message:
				"Worker result cannot complete the feature because featureReview is not passing.",
			failing: () => !isReviewPassing(worker.featureReview),
		},
		{
			kind: "failing_final_review",
			message:
				"Worker result cannot complete the feature because finalReview is not passing.",
			failing: () =>
				Boolean(worker.finalReview && !isReviewPassing(worker.finalReview)),
		},
		{
			kind: "missing_validation_scope",
			message:
				"Worker result cannot complete the session without broad final validation.",
			failing: () => wasFinalFeature && worker.validationScope !== "broad",
		},
		{
			kind: "missing_final_review",
			message:
				"Worker result cannot complete the session without a finalReview.",
			failing: () => wasFinalFeature && !worker.finalReview,
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
