import {
	featureWouldReachCompletion,
	sessionCompletionReached,
} from "../domain";
import type { Feature, Session, WorkerResultArgs } from "../schema";
import { deriveExecutionLane } from "../session-operator-state";
import { nowIso } from "../util";
import {
	buildReplanRecord,
	type NormalizedWorkerResult,
	normalizeWorkerResult,
	recordWorkerResult,
	type WorkerOutcomeKind,
} from "./execution-completion-normalization";
import { validateNormalizedSuccessfulCompletion } from "./execution-completion-validation";
import { fail, succeed, type TransitionResult } from "./shared";

export function markSessionCompleted(
	session: Session,
	summary: string,
): Session {
	const recordedAt = nowIso();
	return {
		...session,
		status: "completed",
		closure: {
			kind: "completed",
			summary,
			recordedAt,
		},
		execution: {
			...session.execution,
			activeFeatureId: null,
			lastSummary: summary,
			lastOutcomeKind: "completed",
		},
		timestamps: {
			...session.timestamps,
			completedAt: recordedAt,
		},
	};
}

function projectCompletedFeatures(
	features: Feature[],
	featureId: string,
): Feature[] {
	return features.map((feature) =>
		feature.id === featureId ? { ...feature, status: "completed" } : feature,
	);
}

function projectFeatureStatus(
	features: Feature[],
	featureId: string,
	status: Feature["status"],
): Feature[] {
	return features.map((feature) =>
		feature.id === featureId ? { ...feature, status } : feature,
	);
}

function finalizeSuccessfulCompletion(
	next: Session,
	featureId: string,
	summary: string,
): TransitionResult<Session> {
	const plan = next.plan;
	if (!plan) {
		return fail("There is no active plan to complete.");
	}

	const nextPlan = {
		...plan,
		features: projectCompletedFeatures(plan.features, featureId),
	};
	const nextSession = {
		...next,
		plan: nextPlan,
		execution: {
			...next.execution,
			activeFeatureId: null,
		},
	};

	return succeed(
		sessionCompletionReached(nextPlan, nextPlan.features)
			? markSessionCompleted(nextSession, summary)
			: { ...nextSession, status: "ready" },
	);
}

function withInactiveFeature(session: Session, plan: Session["plan"]): Session {
	return {
		...session,
		plan,
		execution: {
			...session.execution,
			activeFeatureId: null,
		},
	};
}

function finalizeFeatureStatusTransition(
	next: Session,
	plan: NonNullable<Session["plan"]>,
	featureId: string,
	sessionStatus: Session["status"],
	featureStatus: Feature["status"],
): Session {
	return {
		...withInactiveFeature(next, {
			...plan,
			features: projectFeatureStatus(plan.features, featureId, featureStatus),
		}),
		status: sessionStatus,
	};
}

function finalizeIncompleteCompletion(
	next: Session,
	featureId: string,
	worker: NormalizedWorkerResult,
	outcomeKind: WorkerOutcomeKind,
	replanRecord: Session["planning"]["replanLog"][number] | null,
): Session {
	const plan = next.plan;
	if (!plan) {
		return next;
	}

	if (outcomeKind === "replan_required") {
		return {
			...next,
			plan: null,
			status: "planning",
			approval: "pending",
			planning: {
				...next.planning,
				replanLog: replanRecord
					? [...next.planning.replanLog, replanRecord]
					: next.planning.replanLog,
			},
			execution: {
				...next.execution,
				activeFeatureId: null,
			},
			timestamps: {
				...next.timestamps,
				approvedAt: null,
			},
		};
	}

	const liteRetryReady =
		deriveExecutionLane(next).lane === "lite" &&
		!worker.outcome?.needsHuman &&
		(worker.outcome?.retryable || worker.outcome?.autoResolvable);
	if (liteRetryReady) {
		return finalizeFeatureStatusTransition(
			next,
			plan,
			featureId,
			"ready",
			"pending",
		);
	}

	return finalizeFeatureStatusTransition(
		next,
		plan,
		featureId,
		"blocked",
		"blocked",
	);
}

export function completeExecutionRun(
	session: Session,
	featureId: string,
	worker: WorkerResultArgs,
): TransitionResult<Session> {
	if (!session.plan) {
		return fail("There is no active plan to apply the worker result to.");
	}

	const recordedAt = nowIso();
	const normalizedWorker = normalizeWorkerResult(worker);
	if (normalizedWorker.status === "ok") {
		const next = recordWorkerResult(
			session,
			featureId,
			normalizedWorker,
			recordedAt,
		);
		const wasFinalFeature = featureWouldReachCompletion(
			session.plan,
			featureId,
		);
		const validation = validateNormalizedSuccessfulCompletion(
			session,
			normalizedWorker,
			featureId,
			wasFinalFeature,
		);
		if (!validation.ok) {
			return fail(validation.message, validation.recovery, next);
		}

		return finalizeSuccessfulCompletion(next, featureId, worker.summary);
	}

	const replanRecord = buildReplanRecord(
		featureId,
		normalizedWorker,
		recordedAt,
	);
	return succeed(
		finalizeIncompleteCompletion(
			recordWorkerResult(session, featureId, normalizedWorker, recordedAt),
			featureId,
			normalizedWorker,
			normalizedWorker.outcome.kind,
			replanRecord,
		),
	);
}
