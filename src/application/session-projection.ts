import {
	type ClosureRetryRequest,
	closureRetryRequest,
} from "../domain/operation.js";
import {
	findingIdPrefix,
	type LivePriorFinding,
	livePriorFindings,
} from "../domain/review-findings.js";
import type {
	FeatureRun,
	OperationRecord,
	Plan,
	PlanFeature,
	ReviewAssignment,
	Session,
	SessionClosure,
	SessionStatus,
	ValidationObservation,
} from "../domain/session.js";
import { firstBlockedRun } from "../domain/session.js";
import {
	activeRun,
	isFeatureComplete,
	nextRunnableFeature,
	sessionStatus,
} from "../domain/transitions.js";
import {
	isValidationEligible,
	isValidationFresh,
	unresolvedVetoedCommands,
} from "../domain/validation.js";
import { type FindingsDigest, findingsDigest } from "./findings-digest.js";
import type { StatusRequest } from "./schema.js";

type FlowNextAction =
	| "flow_plan_save"
	| "flow_plan_approve"
	| "flow_run_start"
	| "flow_feature_reset"
	| "await-user-direction"
	| "flow_session_close"
	| "flow_status"
	| "dispatch-flow-reviewer"
	| "flow_validation_start"
	| "flow_review_start";

type FeatureProgress = Readonly<{
	completed: number;
	total: number;
	remaining: number;
}>;

type BlockedFeatureProjection = Readonly<{
	featureId: string;
	attempt: number;
	failedReviewCount: number;
	/**
	 * True when any failed review of this feature raised a scope blocker, which
	 * makes the feature ineligible for automatic retry regardless of the count.
	 */
	scopeBlocker: boolean;
}>;

type ArchiveRetryProjection = Readonly<{
	request: ClosureRetryRequest;
}>;

export type CompactProjection = Readonly<{
	view: "compact";
	sessionId: string;
	revision: number;
	goal: string;
	status: SessionStatus;
	approval: Session["approval"];
	activeFeatureId: string | null;
	activeRunId: string | null;
	blockedFeature: BlockedFeatureProjection | null;
	progress: FeatureProgress;
	nextAction: FlowNextAction;
	archiveRetry: ArchiveRetryProjection | null;
	findingsDigest: FindingsDigest;
}>;

export type ArchivedProjection = Readonly<
	Omit<CompactProjection, "nextAction" | "archiveRetry"> & {
		nextAction: null;
		archiveRetry: null;
		archived: true;
	}
>;

export type ExecutionProjection = Readonly<
	Omit<CompactProjection, "view"> & {
		view: "execution";
		feature: PlanFeature | null;
		run: FeatureRun | null;
	}
>;

type DetailProjection = Readonly<
	Omit<CompactProjection, "view"> & {
		view: "detail";
		plan: Plan | null;
		runs: FeatureRun[];
		closure: SessionClosure | null;
		operations: OperationRecord[];
	}
>;

export type ReviewerProjection = Readonly<{
	view: "reviewer";
	sessionId: string;
	revision: number;
	goal: string;
	planContext: Plan | null;
	feature: PlanFeature | null;
	assignment: ReviewAssignment;
	artifactsChanged: FeatureRun["artifactsChanged"];
	validations: ValidationObservation[];
	completedFeatureIds: string[];
	/**
	 * Prior findings this review must still account for, carrying the text the
	 * reviewer has to re-check, computed from durable state rather than recovered
	 * from the manager's packet prose.
	 */
	priorFindings: ReadonlyArray<LivePriorFinding>;
	/** Prefix the runtime uses when it numbers a new finding of this assignment. */
	nextFindingIdPrefix: string;
}>;

type IdleProjection = Readonly<{
	view: StatusRequest["view"];
	status: "idle";
	revision: 0;
	nextAction: "flow_plan_save";
	findingsDigest: FindingsDigest;
}>;

export type ActiveSessionProjection =
	| CompactProjection
	| DetailProjection
	| ExecutionProjection
	| ReviewerProjection;

export type StatusProjection = ActiveSessionProjection | IdleProjection;

function featureProgress(session: Session): FeatureProgress {
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

function blockedFeatureProjection(
	session: Session,
): BlockedFeatureProjection | null {
	const blockedRun = firstBlockedRun(session);
	if (!blockedRun) return null;
	const featureRuns = session.runs.filter(
		(run) => run.featureId === blockedRun.featureId,
	);
	return {
		featureId: blockedRun.featureId,
		attempt: blockedRun.attempt,
		failedReviewCount: featureRuns.filter((run) =>
			run.reviews.some((review) => review.result?.verdict === "failed"),
		).length,
		scopeBlocker: featureRuns.some((run) =>
			run.reviews.some(
				(review) =>
					review.result?.verdict === "failed" &&
					review.result.findings.some((finding) => finding.scopeBlocker),
			),
		),
	};
}

function nextAction(
	session: Session,
	pendingReviewSourceStale = false,
	blockedFeature = blockedFeatureProjection(session),
): FlowNextAction {
	const status = sessionStatus(session);
	if (status === "planning") {
		return session.plan ? "flow_plan_approve" : "flow_plan_save";
	}
	if (status === "ready" && !nextRunnableFeature(session))
		return "await-user-direction";
	if (status === "ready") return "flow_run_start";
	if (status === "blocked") {
		// A scope blocker or a second failure means the user decides, not the loop.
		// Both halves of this rule are now enforced here; the scope-blocker half
		// used to rely on the manager noticing a marker in free-text prose.
		return (blockedFeature?.failedReviewCount ?? 0) >= 2 ||
			blockedFeature?.scopeBlocker === true
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
			isValidationEligible(validation) &&
			isValidationFresh(session, run, validation) &&
			(!finalRun || validation.scope === "broad"),
	);
	if (!hasPassingValidation) return "flow_validation_start";
	if (unresolvedVetoedCommands(session, run).length > 0) {
		return "flow_validation_start";
	}
	return "flow_review_start";
}

export function compactProjection(
	session: Session,
	pendingReviewSourceStale = false,
): CompactProjection {
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
		findingsDigest: findingsDigest(session),
	};
}

export function archivedProjection(session: Session): ArchivedProjection {
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
): ExecutionProjection {
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
): ReviewerProjection {
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
					...(plan.evidence === undefined
						? {}
						: {
								evidence: plan.evidence.map((entry) => ({
									...entry,
								})),
							}),
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
		priorFindings: livePriorFindings(session, assignment.featureId),
		nextFindingIdPrefix: findingIdPrefix(
			assignment.featureId,
			assignment.createdRevision,
		),
	};
}

function detailProjection(
	session: Session,
	pendingReviewSourceStale = false,
): DetailProjection {
	return {
		...compactProjection(session, pendingReviewSourceStale),
		view: "detail",
		plan: session.plan,
		runs: session.runs,
		closure: session.closure,
		operations: session.operations,
	};
}

export function idleProjection(view: StatusRequest["view"]): IdleProjection {
	return {
		view,
		status: "idle",
		revision: 0,
		nextAction: "flow_plan_save",
		findingsDigest: [],
	};
}

export function project(
	session: Session,
	request: StatusRequest,
	pendingReviewSourceStale = false,
): ActiveSessionProjection {
	switch (request.view) {
		case "compact":
			return compactProjection(session, pendingReviewSourceStale);
		case "detail":
			return detailProjection(session, pendingReviewSourceStale);
		case "execution":
			return executionProjection(session, pendingReviewSourceStale);
		case "reviewer":
			return reviewerProjection(session, request.assignmentId);
	}
}
