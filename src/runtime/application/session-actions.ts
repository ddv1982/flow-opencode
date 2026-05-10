import { describeReviewFindingsMutationFailure } from "../domain";
import type {
	Feature,
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
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
	isRunStartAlreadyActive,
	resetFeature,
	selectPlanFeatures,
	startRun,
} from "../transitions";
import { fail, succeed } from "../transitions/shared";
import {
	completeRunSuccess,
	MISSING_PLANNING_SESSION_RESPONSE,
	MISSING_SESSION_RESPONSE,
	okWithSession,
	startRunSuccess,
	summarizedSession,
	withLatestFailedMutation,
} from "./session-action-responses";
import {
	DEFAULT_SESSION_RUNTIME_PORT,
	executeSessionMutationAtRoot,
	runSessionMutationActionAtRoot,
	type SessionMutationAction,
	type SessionMutationResult,
	type SessionRuntimePort,
} from "./session-engine";
import { mergePlanningContext } from "./session-planning-context";
import {
	createFeatureReviewerDecisionAction,
	createFinalReviewerDecisionAction,
} from "./session-review-actions";
import {
	resolveMutableSessionRoot,
	type WorkspaceContext,
} from "./workspace-runtime";

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

export const SESSION_MUTATION_ACTION_HANDLERS: SessionMutationActionHandlerMap =
	{
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
				onSuccess: (saved) =>
					okWithSession(saved, "Planning context recorded."),
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
				onSuccess: startRunSuccess,
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
				onSuccess: completeRunSuccess,
				onError: (failure) => ({
					status: "error",
					summary: failure.message,
					recovery: failure.recovery,
					...(failure.session?.execution.lastFailedMutation
						? {
								latestFailedAttempt:
									failure.session.execution.lastFailedMutation,
							}
						: {}),
				}),
				recordFailure: (session, failure) =>
					withLatestFailedMutation("complete_run", session, failure),
				clearFailedAttemptOnSuccess: {
					tool: "flow_run_complete_feature",
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
			return createFeatureReviewerDecisionAction(decision);
		},

		record_final_review({ decision }) {
			return createFinalReviewerDecisionAction(decision);
		},
	};

export function buildSessionMutationAction<
	Name extends SessionMutationActionName,
>(
	name: Name,
	payload: SessionMutationPayloadMap[Name],
): SessionMutationAction<SessionMutationValueMap[Name]> {
	return SESSION_MUTATION_ACTION_HANDLERS[name](payload);
}

export function dispatchSessionMutationAction<
	Name extends SessionMutationActionName,
>(
	name: Name,
	payload: SessionMutationPayloadMap[Name],
): SessionMutationAction<SessionMutationValueMap[Name]> {
	return buildSessionMutationAction(name, payload);
}

export async function executeDispatchedSessionMutation<
	Name extends SessionMutationActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<string> {
	const response = await executeSessionMutationAtRoot(
		resolveMutableSessionRoot(context).root,
		dispatchSessionMutationAction(name, payload),
		runtime,
	);
	return JSON.stringify(response, null, 2);
}

export async function runDispatchedSessionMutationAction<
	Name extends SessionMutationActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<SessionMutationResult<SessionMutationValueMap[Name]>> {
	return runSessionMutationActionAtRoot(
		resolveMutableSessionRoot(context).root,
		dispatchSessionMutationAction(name, payload),
		runtime,
	) as Promise<SessionMutationResult<SessionMutationValueMap[Name]>>;
}
