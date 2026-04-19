// Flow runtime transition owner: completion gating and recovery prerequisites remain normative here.

import {
	featureWouldReachCompletion,
	sessionCompletionReached,
} from "../domain";
import type { Feature, Session, WorkerResult } from "../schema";
import { nowIso } from "../util";
import type { CompletionRecoveryKind } from "./recovery";
import { buildCompletionRecovery } from "./recovery";
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

export type WorkerOutcomeKind = NonNullable<WorkerResult["outcome"]>["kind"];

function hasApprovedReviewerDecision(
	session: Session,
	featureId: string,
	wasFinalFeature: boolean,
): boolean {
	const decision = session.execution.lastReviewerDecision;
	if (!decision || decision.status !== "approved") {
		return false;
	}

	return wasFinalFeature
		? decision.scope === "final"
		: decision.scope === "feature" && decision.featureId === featureId;
}

function isReviewPassing(
	review:
		| WorkerResult["featureReview"]
		| WorkerResult["finalReview"]
		| undefined,
): boolean {
	return Boolean(
		review &&
			review.status === "passed" &&
			review.blockingFindings.length === 0,
	);
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

function inferWorkerOutcomeKind(
	worker: WorkerResult,
): WorkerOutcomeKind | "completed" | "needs_input" {
	return (
		worker.outcome?.kind ??
		(worker.status === "ok" ? "completed" : "needs_input")
	);
}

function recordWorkerResult(
	session: Session,
	featureId: string,
	worker: WorkerResult,
	recordedAt: string,
): Session {
	const outcomeKind = inferWorkerOutcomeKind(worker);
	const replanRecord = buildReplanRecord(featureId, worker, recordedAt);

	return {
		...session,
		artifacts: worker.artifactsChanged,
		notes: worker.decisions.map((decision) => decision.summary),
		execution: {
			...session.execution,
			lastValidationRun: worker.validationRun,
			lastFeatureId: featureId,
			lastSummary: worker.summary,
			lastOutcomeKind: outcomeKind,
			lastOutcome: worker.outcome ?? null,
			lastNextStep: worker.nextStep,
			lastFeatureResult: worker.featureResult,
			history: [
				...session.execution.history,
				{
					featureId,
					status: worker.status,
					summary: worker.summary,
					recordedAt,
					outcomeKind,
					outcome: worker.outcome ?? null,
					nextStep: worker.nextStep,
					validationRun: worker.validationRun,
					artifactsChanged: worker.artifactsChanged,
					decisions: worker.decisions,
					featureResult: worker.featureResult,
					replanRecord: replanRecord ?? undefined,
					reviewerDecision: session.execution.lastReviewerDecision,
					featureReview: worker.featureReview,
					finalReview: worker.finalReview,
				},
			],
		},
	};
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

function buildReplanRecord(
	featureId: string,
	worker: WorkerResult,
	recordedAt: string,
) {
	if (worker.outcome?.kind !== "replan_required") {
		return null;
	}
	if (
		!worker.outcome.replanReason ||
		!worker.outcome.failedAssumption ||
		!worker.outcome.recommendedAdjustment
	) {
		return null;
	}

	return {
		featureId,
		reason: worker.outcome.replanReason,
		summary: worker.outcome.summary ?? worker.summary,
		failedAssumption: worker.outcome.failedAssumption,
		recommendedAdjustment: worker.outcome.recommendedAdjustment,
		recordedAt,
	};
}

function finalizeIncompleteCompletion(
	next: Session,
	featureId: string,
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

	return {
		...next,
		status: "blocked",
		plan: {
			...plan,
			features: plan.features.map((feature) =>
				feature.id === featureId ? { ...feature, status: "blocked" } : feature,
			),
		},
		execution: {
			...next.execution,
			activeFeatureId: null,
		},
	};
}

export function completeExecutionRun(
	session: Session,
	featureId: string,
	worker: WorkerResult,
): TransitionResult<Session> {
	if (!session.plan) {
		return fail("There is no active plan to apply the worker result to.");
	}

	const recordedAt = nowIso();
	if (worker.status === "ok") {
		const next = recordWorkerResult(session, featureId, worker, recordedAt);
		const wasFinalFeature = featureWouldReachCompletion(
			session.plan,
			featureId,
		);
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

	const replanRecord = buildReplanRecord(featureId, worker, recordedAt);
	return succeed(
		finalizeIncompleteCompletion(
			recordWorkerResult(session, featureId, worker, recordedAt),
			featureId,
			worker.outcome.kind,
			replanRecord,
		),
	);
}
