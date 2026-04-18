import { featureWouldReachCompletion } from "../domain";
import { type Session, type WorkerResult, WorkerResultSchema } from "../schema";
import { nowIso } from "../time";
import { validateSuccessfulCompletion } from "./execution-completion-guards";
import { recordWorkerResult } from "./execution-completion-recording";
import {
	completionThresholdReached,
	markSessionCompleted,
	projectCompletedFeatures,
} from "./execution-state";
import {
	cloneSession,
	fail,
	formatValidationError,
	succeed,
	type TransitionResult,
} from "./shared";

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
	workerInput: unknown,
): TransitionResult<Session> {
	let worker: WorkerResult;
	try {
		worker = WorkerResultSchema.parse(workerInput);
	} catch (error) {
		return fail(
			`Worker result validation failed: ${formatValidationError(error)}`,
		);
	}

	if (!session.plan) {
		return fail("There is no active plan to apply the worker result to.");
	}
	if (!session.execution.activeFeatureId) {
		return fail("There is no active feature to complete.");
	}
	if (worker.featureResult.featureId !== session.execution.activeFeatureId) {
		return fail(
			`Worker result feature '${worker.featureResult.featureId}' does not match active feature '${session.execution.activeFeatureId}'.`,
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

	recordWorkerResult(next, featureId, worker, recordedAt);

	if (worker.status === "ok") {
		const validation = validateSuccessfulCompletion(
			session,
			worker,
			featureId,
			wasFinalFeature,
		);
		if (!validation.ok) {
			return fail(validation.message, validation.recovery, next);
		}

		return finalizeSuccessfulCompletion(next, featureId, worker.summary);
	}

	return succeed(
		finalizeIncompleteCompletion(next, featureId, worker.outcome.kind),
	);
}
