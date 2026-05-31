import {
	buildFinalReviewerReviewScopeRecoveryDetails,
	buildReviewScopeRecoveryDetails,
	closedReviewFindingRefsForCompletion,
	describeReviewFindingClosureLedgerFailure,
	describeReviewScopeLedgerFailure,
} from "../domain";
import type { Session, WorkerResultArgs } from "../schema";
import {
	type NormalizedWorkerResult,
	normalizeWorkerResult,
} from "./execution-completion-normalization";
import {
	finalReviewerDecisionFailureMessage,
	finalReviewFailureMessage,
	isReviewPassing,
} from "./execution-completion-review-gates";
import {
	buildCompletionRecovery,
	type CompletionRecoveryKind,
} from "./recovery";
import { fail, succeed, type TransitionResult } from "./shared";

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
	details?: Record<string, unknown>,
): TransitionResult<void> {
	return fail(
		message,
		buildCompletionRecovery(featureId, wasFinalFeature, kind, details),
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

	if (session.plan?.goalMode === "review_and_fix") {
		const closureFailure = describeReviewFindingClosureLedgerFailure(
			normalizedWorker.reviewFindingClosures,
			{
				plannedFindingRefs: session.planning.reviewFindings.map((finding) =>
					finding.findingRef.trim(),
				),
				closedFindingRefsForCompletion: closedReviewFindingRefsForCompletion(
					session,
					normalizedWorker,
				),
				validationCommands: normalizedWorker.validationRun.map(
					(item) => item.command,
				),
				requireEveryPlannedFinding: wasFinalFeature,
			},
		);
		if (closureFailure) {
			return failCompletion(
				featureId,
				wasFinalFeature,
				closureFailure,
				"missing_review_closure",
			);
		}
	}

	const reviewScopeFailure = describeReviewScopeLedgerFailure(
		session,
		normalizedWorker,
		featureId,
		wasFinalFeature,
	);
	if (reviewScopeFailure) {
		return failCompletion(
			featureId,
			wasFinalFeature,
			`Worker result cannot complete because ${reviewScopeFailure}`,
			"missing_review_scope_accounting",
			{
				reviewScopeLedger: buildReviewScopeRecoveryDetails(
					session,
					normalizedWorker,
					featureId,
					wasFinalFeature,
				),
			},
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
			return failCompletion(
				featureId,
				false,
				reviewerDecisionFailure.message,
				"missing_reviewer_decision",
			);
		}
		if (normalizedWorker.validationScope !== "targeted") {
			return failCompletion(
				featureId,
				false,
				"Worker result cannot complete the feature without targeted validation.",
				"missing_validation_scope",
			);
		}
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
			wasFinalFeature,
			"Worker result cannot complete the session without a finalReview.",
			"missing_final_review",
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
			const recoveryKind =
				reviewerDecisionFailure.kind === "review_scope_accounting"
					? "missing_final_reviewer_review_scope_accounting"
					: "missing_reviewer_decision";
			const decision = session.execution.lastReviewerDecision;
			return failCompletion(
				featureId,
				true,
				reviewerDecisionFailure.message,
				recoveryKind,
				reviewerDecisionFailure.kind === "review_scope_accounting" &&
					decision?.scope === "final"
					? {
							reviewScopeLedger: buildFinalReviewerReviewScopeRecoveryDetails(
								session,
								decision,
								{
									closedFindingRefs: closedReviewFindingRefsForCompletion(
										session,
										normalizedWorker,
									),
								},
							),
						}
					: undefined,
			);
		}
	}

	return succeed(undefined);
}
