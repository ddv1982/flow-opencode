import { closureRetryRequest } from "../domain/operation.js";
import type {
	FeatureRun,
	ReviewAssignment,
	Session,
} from "../domain/session.js";
import {
	activeRun,
	isFeatureComplete,
	sessionStatus,
} from "../domain/transitions.js";
import { unresolvedKnownFailedPlanCommands } from "../domain/validation.js";
import type { StatusRequest } from "./schema.js";

function featureProgress(session: Session): {
	completed: number;
	total: number;
	remaining: number;
} {
	const total = session.plan?.features.length ?? 0;
	const completed =
		session.plan?.features.filter((feature) =>
			isFeatureComplete(session, feature.id),
		).length ?? 0;
	return { completed, total, remaining: total - completed };
}

export function activePendingReview(session: Session): ReviewAssignment | null {
	return (
		activeRun(session)?.reviews.find((review) => review.result === null) ?? null
	);
}

type BlockedFeatureProjection = Readonly<{
	featureId: string;
	attempt: number;
	failedReviewCount: number;
}>;

function blockedFeatureProjection(
	session: Session,
): BlockedFeatureProjection | null {
	const blockedRun = [...session.runs]
		.reverse()
		.find((run) => run.state === "blocked");
	if (!blockedRun) return null;
	return {
		featureId: blockedRun.featureId,
		attempt: blockedRun.attempt,
		failedReviewCount: session.runs.filter(
			(run) =>
				run.featureId === blockedRun.featureId &&
				run.reviews.some((review) => review.result?.verdict === "failed"),
		).length,
	};
}

function nextAction(
	session: Session,
	pendingReviewSourceStale = false,
	blockedFeature = blockedFeatureProjection(session),
): string {
	const status = sessionStatus(session);
	if (status === "planning") {
		return session.plan ? "flow_plan_approve" : "flow_plan_save";
	}
	if (status === "ready") return "flow_run_start";
	if (status === "blocked") {
		return (blockedFeature?.failedReviewCount ?? 0) >= 2
			? "await-user-direction"
			: "flow_feature_reset";
	}
	if (status === "completed") return "flow_session_close";
	if (status === "closed") return "flow_session_close";
	const run = activeRun(session);
	if (!run) return "flow_status";
	if (activePendingReview(session)) {
		return pendingReviewSourceStale
			? "flow_feature_reset"
			: "dispatch-flow-reviewer";
	}
	const finalRun =
		session.plan?.features.every(
			(feature) =>
				feature.id === run.featureId || isFeatureComplete(session, feature.id),
		) ?? false;
	const hasPassingValidation = run.validations.some(
		(validation) =>
			validation.exitCode === 0 &&
			validation.outputComplete &&
			(!finalRun || validation.scope === "broad"),
	);
	if (!hasPassingValidation) return "flow_validation_start";
	if (unresolvedKnownFailedPlanCommands(session, run).length > 0) {
		return "flow_validation_start";
	}
	return "flow_review_start";
}

export function compactProjection(
	session: Session,
	pendingReviewSourceStale = false,
): Record<string, unknown> {
	const run = activeRun(session);
	const blockedFeature = blockedFeatureProjection(session);
	const retryRequest = closureRetryRequest(session);
	if (session.closure && !retryRequest) {
		throw new Error("Session closure is not bound to a valid close operation.");
	}
	return {
		view: "compact",
		sessionId: session.id,
		revision: session.revision,
		goal: session.goal,
		status: sessionStatus(session),
		approval: session.approval,
		activeFeatureId: run?.featureId ?? null,
		activeRunId: run?.id ?? null,
		blockedFeature,
		progress: featureProgress(session),
		nextAction: nextAction(session, pendingReviewSourceStale, blockedFeature),
		archiveRetry: retryRequest ? { request: retryRequest } : null,
	};
}

export function archivedProjection(session: Session): Record<string, unknown> {
	return {
		...compactProjection(session),
		nextAction: null,
		archiveRetry: null,
		archived: true,
	};
}

export function executionProjection(
	session: Session,
	pendingReviewSourceStale = false,
): Record<string, unknown> {
	const run = activeRun(session);
	const feature = session.plan?.features.find(
		(item) => item.id === run?.featureId,
	);
	return {
		...compactProjection(session, pendingReviewSourceStale),
		view: "execution",
		feature: feature ?? null,
		run: run ?? null,
	};
}

export function reviewerProjection(
	session: Session,
	assignmentId: string,
): Record<string, unknown> {
	let assignment: ReviewAssignment | null = null;
	let run: FeatureRun | null = null;
	for (const candidate of session.runs) {
		const found = candidate.reviews.find(
			(review) => review.id === assignmentId,
		);
		if (found) {
			assignment = found;
			run = candidate;
			break;
		}
	}
	if (!assignment || !run) throw new Error("Unknown review assignment.");
	if (activeRun(session)?.id !== run.id || assignment.result !== null) {
		throw new Error(
			"Review assignment is no longer pending on the active feature run.",
		);
	}
	const feature = session.plan?.features.find(
		(item) => item.id === assignment?.featureId,
	);
	const plan = session.plan;
	const assignedValidationIds = new Set(assignment.validationIds);
	return {
		view: "reviewer",
		sessionId: session.id,
		revision: session.revision,
		goal: session.goal,
		planContext: plan
			? {
					summary: plan.summary,
					overview: plan.overview,
					requirements: [...plan.requirements],
					decisions: [...plan.decisions],
					features: plan.features.map((candidate) => ({
						id: candidate.id,
						title: candidate.title,
						summary: candidate.summary,
						targets: [...candidate.targets],
						validation: [...candidate.validation],
						dependsOn: [...candidate.dependsOn],
					})),
				}
			: null,
		feature: feature ?? null,
		assignment,
		artifactsChanged: run.artifactsChanged,
		validations: run.validations.filter((validation) =>
			assignedValidationIds.has(validation.id),
		),
		completedFeatureIds:
			plan?.features
				.filter((candidate) => isFeatureComplete(session, candidate.id))
				.map((candidate) => candidate.id) ?? [],
	};
}

export function project(
	session: Session,
	request: StatusRequest,
	pendingReviewSourceStale = false,
): Record<string, unknown> {
	if (request.view === "compact") {
		return compactProjection(session, pendingReviewSourceStale);
	}
	if (request.view === "execution") {
		return executionProjection(session, pendingReviewSourceStale);
	}
	if (request.view === "reviewer") {
		return reviewerProjection(session, request.assignmentId);
	}
	return {
		...compactProjection(session, pendingReviewSourceStale),
		view: "detail",
		plan: session.plan,
		runs: session.runs,
		closure: session.closure,
		operations: session.operations,
	};
}
