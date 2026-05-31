import {
	closedReviewFindingRefsForCompletion,
	describeFinalReviewCoverageFailure,
	describeFinalReviewerReviewScopeFailure,
	finalReviewDepthMatchesPolicy,
} from "../domain";
import type { Session } from "../schema";
import { deriveExecutionLane } from "../session-operator-state";
import type { NormalizedWorkerResult } from "./execution-completion-normalization";

type FinalReviewerDecisionFailure = {
	kind: "missing_or_invalid_reviewer_decision" | "review_scope_accounting";
	message: string;
};

export function isReviewPassing(
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

export function finalReviewerDecisionFailureMessage(
	session: Session,
	worker: NormalizedWorkerResult,
	featureId: string,
	wasFinalFeature: boolean,
): FinalReviewerDecisionFailure | null {
	if (!wasFinalFeature) {
		if (deriveExecutionLane(session).lane === "lite") {
			return isReviewPassing(worker.featureReview)
				? null
				: {
						kind: "missing_or_invalid_reviewer_decision",
						message:
							"Worker result cannot complete without a recorded approved reviewer decision.",
					};
		}

		const decision = session.execution.lastReviewerDecision;
		return decision?.status === "approved" &&
			decision.scope === "feature" &&
			decision.featureId === featureId
			? null
			: {
					kind: "missing_or_invalid_reviewer_decision",
					message:
						"Worker result cannot complete without a recorded approved reviewer decision.",
				};
	}

	const decision = session.execution.lastReviewerDecision;
	if (!decision || decision.status !== "approved") {
		return {
			kind: "missing_or_invalid_reviewer_decision",
			message:
				"Worker result cannot complete without a recorded approved reviewer decision.",
		};
	}
	if (decision.scope !== "final") {
		return {
			kind: "missing_or_invalid_reviewer_decision",
			message:
				"Worker result cannot complete the session without a final-scope approved reviewer decision.",
		};
	}
	if (!finalReviewDepthMatchesPolicy(session, decision.reviewDepth)) {
		return {
			kind: "missing_or_invalid_reviewer_decision",
			message:
				"Worker result cannot complete the session because the recorded final reviewer decision does not match deliveryPolicy.finalReviewPolicy.",
		};
	}
	const coverageFailure = describeFinalReviewCoverageFailure(
		session,
		worker,
		decision,
	);
	if (coverageFailure) {
		return {
			kind: "missing_or_invalid_reviewer_decision",
			message: `Worker result cannot complete the session because the recorded final reviewer decision ${coverageFailure}.`,
		};
	}
	const reviewScopeFailure = describeFinalReviewerReviewScopeFailure(
		session,
		decision,
		{
			closedFindingRefs: closedReviewFindingRefsForCompletion(session, worker),
			requireClosedFindingMatch: session.plan?.goalMode === "review_and_fix",
		},
	);
	return reviewScopeFailure
		? {
				kind: "review_scope_accounting",
				message: `Worker result cannot complete the session because the recorded final reviewer decision ${reviewScopeFailure}`,
			}
		: null;
}

export function finalReviewFailureMessage(
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
