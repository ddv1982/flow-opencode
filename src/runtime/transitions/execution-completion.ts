/**
 * Flow runtime transition owner: completion gating and recovery prerequisites
 * remain normative here.
 *
 * Protected subsystem:
 * - completion gate order
 * - lite-lane completion/retry behavior
 * - replan vs blocked vs ready transition semantics
 * - recovery metadata linkage
 *
 * If this file changes, run:
 * `bun run check:completion-lane`
 */

import {
	featureWouldReachCompletion,
	sessionCompletionReached,
} from "../domain";
import type { Feature, Session, WorkerResultArgs } from "../schema";
import { deriveExecutionLane } from "../session-operator-state";
import { nowIso } from "../util";
import type { CompletionRecoveryKind } from "./recovery";
import { buildCompletionRecovery } from "./recovery";
import { fail, succeed, type TransitionResult } from "./shared";

type NormalizedReview = Omit<
	NonNullable<WorkerResultArgs["featureReview"]>,
	"blockingFindings"
> & {
	blockingFindings: NonNullable<
		NonNullable<WorkerResultArgs["featureReview"]>["blockingFindings"]
	>;
};

type NormalizedWorkerResultBase = Omit<
	WorkerResultArgs,
	| "artifactsChanged"
	| "validationRun"
	| "decisions"
	| "featureReview"
	| "finalReview"
> & {
	artifactsChanged: NonNullable<WorkerResultArgs["artifactsChanged"]>;
	validationRun: NonNullable<WorkerResultArgs["validationRun"]>;
	decisions: NonNullable<WorkerResultArgs["decisions"]>;
	featureReview: NormalizedReview;
	finalReview: NormalizedReview | undefined;
};

type NormalizedWorkerResultOk = NormalizedWorkerResultBase & {
	status: "ok";
};

type NormalizedWorkerResultNeedsInput = NormalizedWorkerResultBase & {
	status: "needs_input";
	outcome: NonNullable<
		Extract<WorkerResultArgs, { status: "needs_input" }>["outcome"]
	>;
};

type NormalizedWorkerResult =
	| NormalizedWorkerResultOk
	| NormalizedWorkerResultNeedsInput;

function normalizeReview(
	review: NonNullable<WorkerResultArgs["featureReview"]>,
): NormalizedReview {
	return {
		...review,
		blockingFindings: review.blockingFindings ?? [],
	};
}

function normalizeWorkerResult(
	worker: WorkerResultArgs,
): NormalizedWorkerResult {
	return {
		...worker,
		artifactsChanged: worker.artifactsChanged ?? [],
		validationRun: worker.validationRun ?? [],
		decisions: worker.decisions ?? [],
		featureReview: normalizeReview(worker.featureReview),
		finalReview: worker.finalReview
			? normalizeReview(worker.finalReview)
			: undefined,
	};
}

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

export type WorkerOutcomeKind = NonNullable<
	WorkerResultArgs["outcome"]
>["kind"];

function hasApprovedReviewerDecision(
	session: Session,
	worker: NormalizedWorkerResult,
	featureId: string,
	wasFinalFeature: boolean,
): boolean {
	const inlineLiteReviewSatisfied =
		deriveExecutionLane(session).lane === "lite" &&
		(wasFinalFeature
			? worker.validationScope === "broad" &&
				isReviewPassing(worker.finalReview)
			: isReviewPassing(worker.featureReview));
	if (inlineLiteReviewSatisfied) {
		return true;
	}

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

function isValidationPassing(
	validationRun: NormalizedWorkerResult["validationRun"],
): boolean {
	return (
		validationRun.length > 0 &&
		validationRun.every((item) => item.status === "passed")
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

function validateNormalizedSuccessfulCompletion(
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

	const completionChecks: Array<{
		kind: CompletionRecoveryKind;
		message: string;
		failing: () => boolean;
	}> = [
		{
			kind: "missing_validation",
			message:
				"Worker result cannot complete the feature without recorded validation evidence.",
			failing: () => normalizedWorker.validationRun.length === 0,
		},
		{
			kind: "failing_validation",
			message:
				"Worker result cannot complete the feature because validation did not fully pass.",
			failing: () => !isValidationPassing(normalizedWorker.validationRun),
		},
		{
			kind: "missing_reviewer_decision",
			message:
				"Worker result cannot complete without a recorded approved reviewer decision.",
			failing: () =>
				!hasApprovedReviewerDecision(
					session,
					normalizedWorker,
					featureId,
					wasFinalFeature,
				),
		},
		{
			kind: "missing_validation_scope",
			message:
				"Worker result cannot complete the feature without targeted validation.",
			failing: () =>
				!wasFinalFeature && normalizedWorker.validationScope !== "targeted",
		},
		{
			kind: "failing_feature_review",
			message:
				"Worker result cannot complete the feature because featureReview is not passing.",
			failing: () => !isReviewPassing(normalizedWorker.featureReview),
		},
		{
			kind: "failing_final_review",
			message:
				"Worker result cannot complete the feature because finalReview is not passing.",
			failing: () =>
				Boolean(
					normalizedWorker.finalReview &&
						!isReviewPassing(normalizedWorker.finalReview),
				),
		},
		{
			kind: "missing_validation_scope",
			message:
				"Worker result cannot complete the session without broad final validation.",
			failing: () =>
				wasFinalFeature && normalizedWorker.validationScope !== "broad",
		},
		{
			kind: "missing_final_review",
			message:
				"Worker result cannot complete the session without a finalReview.",
			failing: () => wasFinalFeature && !normalizedWorker.finalReview,
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
	worker: NormalizedWorkerResult,
): WorkerOutcomeKind | "completed" | "needs_input" {
	return (
		worker.outcome?.kind ??
		(worker.status === "ok" ? "completed" : "needs_input")
	);
}

function recordWorkerResult(
	session: Session,
	featureId: string,
	worker: NormalizedWorkerResult,
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
	worker: NormalizedWorkerResult,
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
