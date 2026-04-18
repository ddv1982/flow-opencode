import { featureWouldReachCompletion } from "../domain";
import type { Session, WorkerResult, WorkerResultArgs } from "../schema";
import { nowIso } from "../time";
import { validateSuccessfulCompletion } from "./execution-completion-guards";
import { recordWorkerResult } from "./execution-completion-recording";
import {
	completionThresholdReached,
	markSessionCompleted,
	projectCompletedFeatures,
} from "./execution-state";
import { cloneSession, fail, succeed, type TransitionResult } from "./shared";

type WorkerOutcomeKind = NonNullable<WorkerResult["outcome"]>["kind"];

function finalizeSuccessfulCompletion(
	next: Session,
	featureId: string,
	summary: string,
): TransitionResult<Session> {
	const plan = next.plan;
	if (!plan) {
		return fail("There is no active plan to complete.");
	}
	plan.features = projectCompletedFeatures(plan.features, featureId);
	next.execution.activeFeatureId = null;

	if (completionThresholdReached(plan.features, plan)) {
		return succeed(markSessionCompleted(next, summary));
	}

	next.status = "ready";
	return succeed(next);
}

function finalizeIncompleteCompletion(
	next: Session,
	featureId: string,
	outcomeKind: WorkerOutcomeKind,
): Session {
	const plan = next.plan;
	if (!plan) {
		return next;
	}
	next.execution.activeFeatureId = null;

	if (outcomeKind === "replan_required") {
		next.plan = null;
		next.status = "planning";
		next.approval = "pending";
		next.timestamps.approvedAt = null;
		return next;
	}

	plan.features = plan.features.map((feature) =>
		feature.id === featureId ? { ...feature, status: "blocked" } : feature,
	);
	next.status = "blocked";
	return next;
}

export function completeRun(
	session: Session,
	worker: WorkerResultArgs | WorkerResult | Record<string, unknown>,
): TransitionResult<Session> {
	const typedWorker = worker as WorkerResult;
	if (!session.plan) {
		return fail("There is no active plan to apply the worker result to.");
	}
	if (!session.execution.activeFeatureId) {
		return fail("There is no active feature to complete.");
	}
	if (
		typedWorker.featureResult.featureId !== session.execution.activeFeatureId
	) {
		return fail(
			`Worker result feature '${typedWorker.featureResult.featureId}' does not match active feature '${session.execution.activeFeatureId}'.`,
		);
	}

	const next = cloneSession(session);
	const plan = next.plan;
	if (!plan) {
		return fail("There is no active plan to apply the worker result to.");
	}
	const featureId = session.execution.activeFeatureId;
	const recordedAt = nowIso();
	const wasFinalFeature = featureWouldReachCompletion(plan, featureId);

	recordWorkerResult(next, featureId, typedWorker, recordedAt);

	if (typedWorker.status === "ok") {
		const validation = validateSuccessfulCompletion(
			session,
			typedWorker,
			featureId,
			wasFinalFeature,
		);
		if (!validation.ok) {
			return fail(validation.message, validation.recovery, next);
		}

		return finalizeSuccessfulCompletion(next, featureId, typedWorker.summary);
	}

	return succeed(
		finalizeIncompleteCompletion(next, featureId, typedWorker.outcome.kind),
	);
}
