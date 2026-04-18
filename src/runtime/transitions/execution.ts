import { featureWouldReachCompletion } from "../domain";
import type { Feature, Session, WorkerResult } from "../schema";
import { nowIso } from "../time";
import type { CompletionRecoveryKind } from "./recovery";
import { buildCompletionRecovery } from "./recovery";
import { fail, succeed, type TransitionResult } from "./shared";

function completionThresholdReached(
	features: Feature[],
	plan: NonNullable<Session["plan"]>,
): boolean {
	const completedCount = features.filter(
		(feature) => feature.status === "completed",
	).length;
	const minimum = plan.completionPolicy?.minCompletedFeatures;

	return minimum !== undefined
		? completedCount >= minimum
		: completedCount === features.length;
}

function markSessionCompleted(session: Session, summary: string): Session {
	return {
		...session,
		status: "completed",
		execution: {
			...session.execution,
			activeFeatureId: null,
			lastSummary: summary,
			lastOutcomeKind: "completed",
		},
		timestamps: {
			...session.timestamps,
			completedAt: nowIso(),
		},
	};
}

function isFeatureRunnable(feature: Feature, completed: Set<string>): boolean {
	const dependsOn = feature.dependsOn ?? [];
	const blockedBy = feature.blockedBy ?? [];
	return (
		dependsOn.every((id) => completed.has(id)) &&
		blockedBy.every((id) => completed.has(id))
	);
}

type RunnableFeatureResult =
	| { ok: true; value: Feature }
	| { ok: false; message: string; reason: "invalid_request" | "blocked" };

function firstRunnableFeature(
	features: Feature[],
	requestedId?: string,
): RunnableFeatureResult {
	const byId = new Map(features.map((feature) => [feature.id, feature]));
	const completed = new Set(
		features
			.filter((feature) => feature.status === "completed")
			.map((feature) => feature.id),
	);

	if (requestedId) {
		const feature = byId.get(requestedId);
		if (!feature) {
			return {
				ok: false,
				message: `Feature '${requestedId}' was not found in the approved plan.`,
				reason: "invalid_request",
			};
		}
		if (feature.status === "completed") {
			return {
				ok: false,
				message: `Feature '${requestedId}' is already completed.`,
				reason: "invalid_request",
			};
		}
		if (!isFeatureRunnable(feature, completed)) {
			return {
				ok: false,
				message: `Feature '${requestedId}' is not runnable because its prerequisites are not complete.`,
				reason: "invalid_request",
			};
		}

		return { ok: true, value: feature };
	}

	const runnable = features.find(
		(feature) =>
			feature.status !== "completed" && isFeatureRunnable(feature, completed),
	);
	if (!runnable) {
		return {
			ok: false,
			message: "No runnable feature is available in the approved plan.",
			reason: "blocked",
		};
	}

	return { ok: true, value: runnable };
}

function markFeatureInProgress(
	features: Feature[],
	featureId: string,
): Feature[] {
	return features.map((feature) => {
		if (feature.id !== featureId) {
			return feature.status === "in_progress"
				? { ...feature, status: "pending" }
				: feature;
		}

		return { ...feature, status: "in_progress" };
	});
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
		completionThresholdReached(nextPlan.features, nextPlan)
			? markSessionCompleted(nextSession, summary)
			: { ...nextSession, status: "ready" },
	);
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

	if (outcomeKind === "replan_required") {
		return {
			...next,
			plan: null,
			status: "planning",
			approval: "pending",
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

function completeExecutionRun(
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

	return succeed(
		finalizeIncompleteCompletion(
			recordWorkerResult(session, featureId, worker, recordedAt),
			featureId,
			worker.outcome.kind,
		),
	);
}

function blockRun(
	session: Session,
	message: string,
): { session: Session; feature: null; reason: string } {
	return {
		session: {
			...session,
			status: "blocked",
			execution: {
				...session.execution,
				activeFeatureId: null,
				lastSummary: message,
				lastOutcomeKind: "blocked",
			},
		},
		feature: null,
		reason: message,
	};
}

function startFeatureRun(
	session: Session,
	featureId: string,
): TransitionResult<{
	session: Session;
	feature: Feature | null;
	reason?: string;
}> {
	const plan = session.plan;
	if (!plan) {
		return fail("There is no approved plan to run.");
	}

	const nextPlan = {
		...plan,
		features: markFeatureInProgress(plan.features, featureId),
	};
	const nextSession: Session = {
		...session,
		plan: nextPlan,
		status: "running",
		execution: {
			...session.execution,
			activeFeatureId: featureId,
			lastFeatureId: featureId,
			lastSummary: `Running feature '${featureId}'.`,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
		},
	};

	return succeed({
		session: nextSession,
		feature:
			nextPlan.features.find((feature) => feature.id === featureId) ?? null,
	});
}

export function startRun(
	session: Session,
	requestedId?: string,
): TransitionResult<{
	session: Session;
	feature: Feature | null;
	reason?: string;
}> {
	if (session.status === "completed") {
		return fail(
			"This Flow session is already completed. Start a new plan to continue.",
		);
	}
	if (!session.plan || session.approval !== "approved") {
		return fail("There is no approved plan to run.");
	}
	if (session.execution.activeFeatureId) {
		return fail(
			`Feature '${session.execution.activeFeatureId}' is already in progress.`,
		);
	}

	if (
		session.plan.features.every((feature) => feature.status === "completed")
	) {
		return succeed({
			session: markSessionCompleted(
				session,
				"All planned features are complete.",
			),
			feature: null,
			reason: "complete",
		});
	}

	const targetResult = firstRunnableFeature(session.plan.features, requestedId);
	if (!targetResult.ok) {
		return targetResult.reason === "invalid_request"
			? fail(targetResult.message)
			: succeed(blockRun(session, targetResult.message));
	}

	return startFeatureRun(session, targetResult.value.id);
}

export function completeRun(
	session: Session,
	worker: WorkerResult,
): TransitionResult<Session> {
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

	const featureId = session.execution.activeFeatureId;

	return completeExecutionRun(session, featureId, worker);
}
