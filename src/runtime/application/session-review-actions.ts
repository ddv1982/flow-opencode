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
import { okWithSession } from "./session-action-responses";
import type { SessionMutationAction } from "./session-engine";
import {
	normalizeFeatureReviewDecision,
	normalizeFinalReviewDecision,
} from "./session-review-decision-normalization";

function reviewDecisionErrorResponse(failure: {
	message: string;
	recovery?: unknown;
}) {
	return errorResponse(failure.message, {
		...(failure.recovery ? { recovery: failure.recovery } : {}),
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
	};
}
