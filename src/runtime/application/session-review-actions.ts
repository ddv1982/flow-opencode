import { errorResponse } from "../errors";
import type {
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
	Session,
} from "../schema";
import {
	isReviewerDecisionAlreadyRecorded,
	recordReviewerDecision,
} from "../transitions";
import {
	okWithSession,
	withLatestFailedMutation,
} from "./session-action-responses";
import type { SessionMutationAction } from "./session-engine";
import {
	normalizeFeatureReviewDecision,
	normalizeFinalReviewDecision,
} from "./session-review-decision-normalization";

function reviewDecisionErrorResponse(failure: {
	message: string;
	recovery?: unknown;
	session?: Session;
}) {
	return errorResponse(failure.message, {
		...(failure.recovery ? { recovery: failure.recovery } : {}),
		...(failure.session?.execution.lastFailedMutation
			? { latestFailedAttempt: failure.session.execution.lastFailedMutation }
			: {}),
	});
}

function reviewerDecisionNoopSuccess(saved: Session) {
	return okWithSession(
		saved,
		"Reviewer decision already recorded; no state change.",
	);
}

export function createFeatureReviewerDecisionAction(
	decision: FlowReviewRecordFeatureArgs,
): SessionMutationAction<Session> {
	const normalizedDecision = normalizeFeatureReviewDecision(decision);
	return {
		name: "record_feature_review",
		run: (session) => recordReviewerDecision(session, normalizedDecision),
		getSession: (value) => value,
		onSuccess: (saved) => okWithSession(saved, "Reviewer decision recorded."),
		isNoopSuccess: (value, originalSession) =>
			value === originalSession &&
			isReviewerDecisionAlreadyRecorded(originalSession, normalizedDecision),
		onNoopSuccess: reviewerDecisionNoopSuccess,
		onError: reviewDecisionErrorResponse,
		recordFailure: (session, failure) =>
			withLatestFailedMutation("record_feature_review", session, failure),
		clearFailedAttemptOnSuccess: {
			tool: "flow_review_record_feature",
		},
	};
}

export function createFinalReviewerDecisionAction(
	decision: FlowReviewRecordFinalArgs,
): SessionMutationAction<Session> {
	const normalizedDecision = normalizeFinalReviewDecision(decision);
	return {
		name: "record_final_review",
		run: (session) => recordReviewerDecision(session, normalizedDecision),
		getSession: (value) => value,
		onSuccess: (saved) => okWithSession(saved, "Reviewer decision recorded."),
		isNoopSuccess: (value, originalSession) =>
			value === originalSession &&
			isReviewerDecisionAlreadyRecorded(originalSession, normalizedDecision),
		onNoopSuccess: reviewerDecisionNoopSuccess,
		onError: reviewDecisionErrorResponse,
		recordFailure: (session, failure) =>
			withLatestFailedMutation("record_final_review", session, failure),
		clearFailedAttemptOnSuccess: {
			tool: "flow_review_record_final",
		},
	};
}
