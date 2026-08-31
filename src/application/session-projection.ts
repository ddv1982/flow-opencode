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
	unsatisfiedEvidence,
} from "../domain/validation.js";
import {
	digestReportLines,
	type FindingsDigest,
	findingsDigest,
} from "./findings-digest.js";
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

type RoutedStatusProjection = Exclude<StatusProjection, ReviewerProjection>;

function actionGuidance(projection: RoutedStatusProjection): string {
	const action = projection.nextAction;
	switch (action) {
		case "flow_plan_save":
			return "Action guidance: inspect the repository and save one draft plan with flow_plan_save.";
		case "flow_plan_approve":
			return "Action guidance: review the draft and approve it only with explicit or prior implementation authority.";
		case "flow_run_start":
			return projection.status === "ready"
				? "Action guidance: start one exact dependency-ready feature with flow_run_start."
				: "Action guidance: refresh status before starting another feature.";
		case "flow_feature_reset":
			return projection.status === "blocked"
				? "Action guidance: reset the failed feature and select the exact authorized retry or independent feature with flow_feature_reset."
				: "Action guidance: reset the source-stale active feature; do not redispatch its reviewer.";
		case "await-user-direction":
			if (projection.status === "ready")
				return "Action guidance: choose the exact failed feature to retry with flow_run_start; do not use default selection.";
			if (projection.status === "blocked")
				return "Action guidance: choose an exact retry or dependency-independent feature through flow_feature_reset with nextFeatureId.";
			return "Action guidance: supply the missing declared evidence or explicitly choose deferred or abandoned closure.";
		case "flow_session_close":
			return "archiveRetry" in projection && projection.archiveRetry
				? "Action guidance: replay the projected flow_session_close request byte-for-byte before any other recovery action."
				: "Action guidance: close the completed session with flow_session_close.";
		case "flow_status":
			return "Action guidance: refresh Flow status before another lifecycle action.";
		case "dispatch-flow-reviewer":
			return "Action guidance: dispatch the existing pending assignment to flow-reviewer.";
		case "flow_validation_start":
			return "Action guidance: arm the exact next validation command with flow_validation_start.";
		case "flow_review_start":
			return "Action guidance: create one independent review assignment with flow_review_start.";
		default: {
			const exhaustive: never = action;
			return exhaustive;
		}
	}
}

function compactReport(
	projection: CompactProjection | DetailProjection | ExecutionProjection,
): string[] {
	return [
		`View: ${projection.view}`,
		`Session: ${projection.sessionId}`,
		`Status: ${projection.status}`,
		`Approval: ${projection.approval}`,
		`Revision: ${projection.revision}`,
		`Goal: ${projection.goal}`,
		`Progress: ${projection.progress.completed} of ${projection.progress.total} features complete; ${projection.progress.remaining} remaining`,
		`Active feature: ${projection.activeFeatureId ?? "none"}`,
		`Active run: ${projection.activeRunId ?? "none"}`,
		...(projection.blockedFeature
			? [
					`Blocked feature: ${projection.blockedFeature.featureId}`,
					`Blocked attempt: ${projection.blockedFeature.attempt}`,
					`Failed review count: ${projection.blockedFeature.failedReviewCount}`,
					`Scope blocker: ${projection.blockedFeature.scopeBlocker ? "yes" : "no"}`,
				]
			: []),
		`Next action: ${projection.nextAction}`,
		`Archive retry: ${projection.archiveRetry ? "yes" : "no"}`,
		actionGuidance(projection),
		...digestReportLines(projection.findingsDigest),
	];
}

function retryRequiredFeatureIds(projection: DetailProjection): string[] {
	return (projection.plan?.features ?? []).flatMap((feature) => {
		const run = projection.runs.findLast(
			(candidate) => candidate.featureId === feature.id,
		);
		const reviewed = run?.reviews.findLast((review) => review.result !== null);
		return reviewed?.result?.verdict === "failed" ? [feature.id] : [];
	});
}

export function statusReport(projection: StatusProjection): readonly string[] {
	if (!("sessionId" in projection)) {
		return [
			`View: ${projection.view}`,
			"Status: idle",
			"Revision: 0",
			"Next action: flow_plan_save",
			"No active Flow session.",
			actionGuidance(projection),
			...digestReportLines(projection.findingsDigest),
		];
	}
	if (projection.view === "reviewer") {
		return [
			"View: reviewer",
			`Session: ${projection.sessionId}`,
			`Revision: ${projection.revision}`,
			`Goal: ${projection.goal}`,
			`Feature: ${projection.feature ? `${projection.feature.id} - ${projection.feature.title}` : "unavailable"}`,
			`Reviewer assignment: ${projection.assignment.id}`,
			`Assignment kind: ${projection.assignment.kind}`,
			`Review feature: ${projection.assignment.featureId}`,
			`Risk lenses: ${projection.assignment.packet.riskLenses.join(", ") || "none"}`,
			`Artifacts changed: ${projection.artifactsChanged.length}`,
			`Validations: ${projection.validations.length}`,
			`Completed features: ${projection.completedFeatureIds.length}`,
			`Prior findings: ${projection.priorFindings.length}`,
			`Next finding id prefix: ${projection.nextFindingIdPrefix}`,
		];
	}
	const common = compactReport(projection);
	if (projection.view === "execution") {
		return [
			...common,
			`Feature: ${projection.feature ? `${projection.feature.id} - ${projection.feature.title}` : "none"}`,
			`Run: ${projection.run ? `${projection.run.id}; state ${projection.run.state}` : "none"}`,
		];
	}
	if (projection.view === "detail") {
		const retryRequired = retryRequiredFeatureIds(projection);
		const validations = projection.runs.reduce(
			(total, run) => total + run.validations.length,
			0,
		);
		const artifacts = new Set(
			projection.runs.flatMap((run) =>
				run.artifactsChanged.map((artifact) => artifact.path),
			),
		);
		return [
			...common,
			`Plan features: ${projection.plan?.features.length ?? 0}`,
			`Runs: ${projection.runs.length}`,
			`Retry-required features: ${retryRequired.join(", ") || "none"}`,
			`Validation observations: ${validations}`,
			`Flow-reported artifacts: ${[...artifacts].sort().join(", ") || "none"}`,
			`Closure: ${projection.closure ? `${projection.closure.kind} - ${projection.closure.summary || "none"}` : "none"}`,
			`Operations recorded: ${projection.operations.length}`,
		];
	}
	return common;
}

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
		// A scope blocker or second failure requires user direction.
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
	const passingValidation = run.validations.findLast(
		(validation) =>
			isValidationEligible(validation) &&
			isValidationFresh(session, run, validation) &&
			(!finalRun || validation.scope === "broad"),
	);
	if (!passingValidation) return "flow_validation_start";
	if (unresolvedVetoedCommands(session, run).length > 0) {
		return "flow_validation_start";
	}
	if (
		finalRun &&
		unsatisfiedEvidence(session, passingValidation.sourceDigest).length > 0
	)
		return "await-user-direction";
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
