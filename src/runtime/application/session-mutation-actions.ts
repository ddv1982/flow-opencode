import { FLOW_PLAN_WITH_GOAL_COMMAND } from "../constants";
import { describeReviewFindingsMutationFailure } from "../domain";
import { mergePlanningContext } from "../domain/planning-context";
import { errorResponse } from "../errors";
import type {
	Feature,
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
	LatestFailedFlowAttempt,
	PlanArgs,
	Session,
	WorkerResultArgs,
} from "../schema";
import { summarizeSession } from "../summary";
import {
	applyPlan,
	approvePlan,
	completeRun,
	isPlanApprovalAlreadyApplied,
	isReviewerDecisionAlreadyRecorded,
	isRunStartAlreadyActive,
	recordReviewerDecision,
	resetFeature,
	selectPlanFeatures,
	startRun,
} from "../transitions";
import { fail, succeed, type TransitionRecovery } from "../transitions/shared";
import { nowIso } from "../util";
import type { SessionMutationAction } from "./action-engine";
import {
	normalizeFeatureReviewDecision,
	normalizeFinalReviewDecision,
} from "./session-review-decision-normalization";

const MISSING_PLANNING_SESSION_RESPONSE = {
	status: "missing_session",
	summary: "No active Flow planning session exists.",
	nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
} as const;

const MISSING_SESSION_RESPONSE = {
	status: "missing_session",
	summary: "No active Flow session exists.",
	nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
} as const;

type FailedMutationActionName =
	| "complete_run"
	| "record_feature_review"
	| "record_final_review";

const FAILED_MUTATION_DESCRIPTORS: Record<
	FailedMutationActionName,
	Pick<LatestFailedFlowAttempt, "tool" | "phase">
> = {
	complete_run: { tool: "flow_feature_complete", phase: "execution" },
	record_feature_review: { tool: "flow_review_record", phase: "review" },
	record_final_review: { tool: "flow_review_record", phase: "final_review" },
};

type FailedMutationResult = {
	message: string;
	recovery?: TransitionRecovery;
};

function withLatestFailedMutation(
	actionName: FailedMutationActionName,
	session: Session,
	failure: FailedMutationResult,
): Session {
	const descriptor = FAILED_MUTATION_DESCRIPTORS[actionName];
	const failureCategory =
		failure.recovery?.errorCode ?? "transition_validation_failed";
	const previous = session.execution.lastFailedMutation;
	const sameCategoryFailureCount =
		previous?.tool === descriptor.tool &&
		previous.failureCategory === failureCategory
			? (previous.sameCategoryFailureCount ?? 1) + 1
			: 1;
	return {
		...session,
		execution: {
			...session.execution,
			lastFailedMutation: {
				...descriptor,
				status: "error",
				failureCategory,
				summary: failure.message,
				...(failure.recovery?.resolutionHint
					? { recoveryHint: failure.recovery.resolutionHint }
					: {}),
				occurredAt: nowIso(),
				...(sameCategoryFailureCount > 1 ? { sameCategoryFailureCount } : {}),
			},
		},
		timestamps: {
			...session.timestamps,
			updatedAt: nowIso(),
		},
	};
}

function summarizedSession(saved: Session) {
	return summarizeSession(saved).session;
}

function okWithSession(saved: Session, summary: string) {
	return {
		status: "ok" as const,
		summary,
		session: summarizedSession(saved),
	};
}

export const SESSION_MUTATION_ACTION_NAMES = [
	"record_planning_context",
	"apply_plan",
	"approve_plan",
	"auto_approve_lite_plan",
	"select_plan_features",
	"start_run",
	"complete_run",
	"reset_feature",
	"record_feature_review",
	"record_final_review",
] as const;

export type SessionMutationActionName =
	(typeof SESSION_MUTATION_ACTION_NAMES)[number];

export type SessionMutationPayloadMap = {
	record_planning_context: Partial<Session["planning"]>;
	apply_plan: {
		plan: PlanArgs;
		planning?: Partial<Session["planning"]>;
	};
	approve_plan: {
		featureIds: string[];
	};
	auto_approve_lite_plan: undefined;
	select_plan_features: {
		featureIds: string[];
	};
	start_run: {
		featureId?: string;
	};
	complete_run: {
		worker: WorkerResultArgs;
	};
	reset_feature: {
		featureId: string;
	};
	record_feature_review: {
		decision: FlowReviewRecordFeatureArgs;
	};
	record_final_review: {
		decision: FlowReviewRecordFinalArgs;
	};
};

export type SessionMutationValueMap = {
	record_planning_context: Session;
	apply_plan: {
		session: Session;
		autoApproved: boolean;
	};
	approve_plan: Session;
	auto_approve_lite_plan: Session;
	select_plan_features: Session;
	start_run: {
		session: Session;
		feature: Feature | null;
		reason?: string;
	};
	complete_run: Session;
	reset_feature: Session;
	record_feature_review: Session;
	record_final_review: Session;
};

type SessionMutationActionHandlerMap = {
	[Name in SessionMutationActionName]: (
		payload: SessionMutationPayloadMap[Name],
	) => SessionMutationAction<SessionMutationValueMap[Name]>;
};

function reviewDecisionErrorResponse(failure: {
	message: string;
	recovery?: unknown;
	session?: Session;
}) {
	return errorResponse(failure.message, {
		...(failure.recovery ? { recovery: failure.recovery } : {}),
		...(failure.session?.execution.lastFailedMutation
			? { latestFailedAttempt: failure.session.execution.lastFailedMutation }
			: {}),
	});
}

function reviewerDecisionAction(
	name: "record_feature_review" | "record_final_review",
	normalizedDecision: ReturnType<typeof normalizeFeatureReviewDecision>,
): SessionMutationAction<Session> {
	return {
		name,
		run: (session) => recordReviewerDecision(session, normalizedDecision),
		getSession: (value) => value,
		onSuccess: (saved) => okWithSession(saved, "Reviewer decision recorded."),
		isNoopSuccess: (value, originalSession) =>
			value === originalSession &&
			isReviewerDecisionAlreadyRecorded(originalSession, normalizedDecision),
		onNoopSuccess: (saved) =>
			okWithSession(
				saved,
				"Reviewer decision already recorded; no state change.",
			),
		onError: reviewDecisionErrorResponse,
		recordFailure: (session, failure) =>
			withLatestFailedMutation(name, session, failure),
		clearFailedAttemptOnSuccess: {
			tool: "flow_review_record",
		},
	};
}

const MUTATION_ACTION_HANDLERS: SessionMutationActionHandlerMap = {
	record_planning_context(nextPlanning) {
		return {
			name: "record_planning_context",
			run: (session) => {
				const failure = describeReviewFindingsMutationFailure(
					session,
					nextPlanning,
				);
				if (failure) {
					return fail(failure);
				}
				const updated: Session = {
					...session,
					planning: mergePlanningContext(session.planning, nextPlanning),
				};
				return succeed(updated);
			},
			getSession: (value) => value,
			onSuccess: (saved) => okWithSession(saved, "Planning context recorded."),
		};
	},

	apply_plan({ plan, planning }) {
		return {
			name: "apply_plan",
			run: (session) => {
				const applied = applyPlan(session, { ...plan }, planning);
				if (!applied.ok) return applied;
				const lane = summarizeSession(applied.value).session?.operator.lane;
				if (lane === "lite") {
					const approved = approvePlan(applied.value);
					if (!approved.ok) return approved;
					return succeed({ session: approved.value, autoApproved: true });
				}
				return succeed({ session: applied.value, autoApproved: false });
			},
			getSession: (value) => value.session,
			onSuccess: (saved, value) => ({
				status: "ok",
				summary: value.autoApproved
					? "Lite draft plan saved and auto-approved so execution can start immediately."
					: "Draft plan saved.",
				autoApproved: value.autoApproved,
				session: summarizedSession(saved),
			}),
			missingResponse: MISSING_PLANNING_SESSION_RESPONSE,
		};
	},

	auto_approve_lite_plan(_payload) {
		return {
			name: "auto_approve_lite_plan",
			run: (session) => approvePlan(session),
			getSession: (value) => value,
			onSuccess: (saved) => ({
				status: "ok",
				summary:
					"Lite draft plan saved and auto-approved so execution can start immediately.",
				autoApproved: true,
				session: summarizedSession(saved),
			}),
			missingResponse: MISSING_PLANNING_SESSION_RESPONSE,
		};
	},

	approve_plan({ featureIds }) {
		return {
			name: "approve_plan",
			run: (session) => approvePlan(session, featureIds),
			getSession: (value) => value,
			onSuccess: (saved) => okWithSession(saved, "Plan approved."),
			isNoopSuccess: (value, originalSession) =>
				value === originalSession &&
				isPlanApprovalAlreadyApplied(originalSession, featureIds),
			onNoopSuccess: (saved) =>
				okWithSession(
					saved,
					"Plan approval already recorded; no state change.",
				),
		};
	},

	select_plan_features({ featureIds }) {
		return {
			name: "select_plan_features",
			run: (session) => selectPlanFeatures(session, featureIds),
			getSession: (value) => value,
			onSuccess: (saved) => okWithSession(saved, "Draft plan narrowed."),
		};
	},

	start_run({ featureId }) {
		return {
			name: "start_run",
			run: (session) => startRun(session, featureId),
			getSession: (value) => value.session,
			onSuccess: (saved, value) => {
				const summary = summarizeSession(saved);
				return {
					status:
						value.reason === "complete"
							? "complete"
							: value.feature
								? "ok"
								: "blocked",
					summary: summary.summary,
					session: summary.session,
					feature: value.feature,
					reason: value.reason,
				};
			},
			isNoopSuccess: (value, originalSession) =>
				value.session === originalSession &&
				isRunStartAlreadyActive(originalSession, featureId),
			onNoopSuccess: (saved, value) =>
				okWithSession(
					saved,
					`Feature '${value.feature?.id ?? featureId}' is already running; no state change.`,
				),
			missingResponse: MISSING_SESSION_RESPONSE,
		};
	},

	complete_run({ worker }) {
		return {
			name: "complete_run",
			run: (session) => completeRun(session, worker),
			getSession: (value) => value,
			onSuccess: (saved) => {
				const summary = summarizeSession(saved);
				return {
					status: "ok" as const,
					summary: summary.summary,
					session: summary.session,
				};
			},
			onError: (failure) => ({
				status: "error",
				summary: failure.message,
				recovery: failure.recovery,
				...(failure.session?.execution.lastFailedMutation
					? {
							latestFailedAttempt: failure.session.execution.lastFailedMutation,
						}
					: {}),
			}),
			recordFailure: (session, failure) =>
				withLatestFailedMutation("complete_run", session, failure),
			clearFailedAttemptOnSuccess: {
				tool: "flow_feature_complete",
			},
		};
	},

	reset_feature({ featureId }) {
		return {
			name: "reset_feature",
			run: (session) => resetFeature(session, featureId),
			getSession: (value) => value,
			onSuccess: (saved) =>
				okWithSession(saved, `Reset feature '${featureId}'.`),
			clearFailedAttemptOnSuccess: true,
		};
	},

	record_feature_review({ decision }) {
		return reviewerDecisionAction(
			"record_feature_review",
			normalizeFeatureReviewDecision(decision),
		);
	},

	record_final_review({ decision }) {
		return reviewerDecisionAction(
			"record_final_review",
			normalizeFinalReviewDecision(decision),
		);
	},
};

export function buildMutationAction<Name extends SessionMutationActionName>(
	name: Name,
	payload: SessionMutationPayloadMap[Name],
): SessionMutationAction<SessionMutationValueMap[Name]> {
	return MUTATION_ACTION_HANDLERS[name](payload);
}
