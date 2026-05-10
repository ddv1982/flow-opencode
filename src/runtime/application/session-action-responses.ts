import { FLOW_PLAN_WITH_GOAL_COMMAND } from "../constants";
import type { Feature, LatestFailedFlowAttempt, Session } from "../schema";
import { summarizeSession } from "../summary";
import type { TransitionRecovery } from "../transitions/shared";
import { nowIso } from "../util";

export const MISSING_PLANNING_SESSION_RESPONSE = {
	status: "missing_session",
	summary: "No active Flow planning session exists.",
	nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
} as const;

export const MISSING_SESSION_RESPONSE = {
	status: "missing_session",
	summary: "No active Flow session exists.",
	nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
} as const;

type FailedMutationActionName =
	| "complete_run"
	| "record_feature_review"
	| "record_final_review";

type FailedMutationDescriptor = Pick<LatestFailedFlowAttempt, "tool" | "phase">;

type FailedMutationResult = {
	message: string;
	recovery?: TransitionRecovery;
};

const FAILED_MUTATION_DESCRIPTORS: Record<
	FailedMutationActionName,
	FailedMutationDescriptor
> = {
	complete_run: {
		tool: "flow_run_complete_feature",
		phase: "execution",
	},
	record_feature_review: {
		tool: "flow_review_record_feature",
		phase: "review",
	},
	record_final_review: {
		tool: "flow_review_record_final",
		phase: "final_review",
	},
};

export function buildLatestFailedMutation(
	actionName: FailedMutationActionName,
	session: Session,
	failure: FailedMutationResult,
): LatestFailedFlowAttempt {
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
		...descriptor,
		status: "error",
		failureCategory,
		summary: failure.message,
		...(failure.recovery?.resolutionHint
			? { recoveryHint: failure.recovery.resolutionHint }
			: {}),
		occurredAt: nowIso(),
		...(sameCategoryFailureCount > 1 ? { sameCategoryFailureCount } : {}),
	};
}

export function withLatestFailedMutation(
	actionName: FailedMutationActionName,
	session: Session,
	failure: FailedMutationResult,
): Session {
	return {
		...session,
		execution: {
			...session.execution,
			lastFailedMutation: buildLatestFailedMutation(
				actionName,
				session,
				failure,
			),
		},
		timestamps: {
			...session.timestamps,
			updatedAt: nowIso(),
		},
	};
}

export function summarizedSession(saved: Session) {
	return summarizeSession(saved).session;
}

export function okWithSession(saved: Session, summary: string) {
	return {
		status: "ok" as const,
		summary,
		session: summarizedSession(saved),
	};
}

export function startRunSuccess(
	saved: Session,
	value: { session: Session; feature: Feature | null; reason?: string },
) {
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
}

export function completeRunSuccess(saved: Session) {
	const summary = summarizeSession(saved);
	return {
		status: "ok" as const,
		summary: summary.summary,
		session: summary.session,
	};
}
