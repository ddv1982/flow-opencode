import type {
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
	Session,
} from "../schema";
import { recordReviewerDecision } from "../transitions";
import { okWithSession } from "./session-action-responses";
import type { SessionMutationAction } from "./session-engine";
import {
	normalizeFeatureReviewDecision,
	normalizeFinalReviewDecision,
} from "./session-review-decision-normalization";

export function createFeatureReviewerDecisionAction(
	decision: FlowReviewRecordFeatureArgs,
): SessionMutationAction<Session> {
	return {
		name: "record_feature_review",
		run: (session) =>
			recordReviewerDecision(session, normalizeFeatureReviewDecision(decision)),
		getSession: (value) => value,
		onSuccess: (saved) => okWithSession(saved, "Reviewer decision recorded."),
	};
}

export function createFinalReviewerDecisionAction(
	decision: FlowReviewRecordFinalArgs,
): SessionMutationAction<Session> {
	return {
		name: "record_final_review",
		run: (session) =>
			recordReviewerDecision(session, normalizeFinalReviewDecision(decision)),
		getSession: (value) => value,
		onSuccess: (saved) => okWithSession(saved, "Reviewer decision recorded."),
	};
}
