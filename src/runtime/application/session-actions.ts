import {
	FLOW_PLAN_WITH_GOAL_COMMAND,
	flowResetFeatureCommand,
} from "../constants";
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
	recordReviewerDecision,
	resetFeature,
	selectPlanFeatures,
	startRun,
} from "../transitions";
import { succeed } from "../transitions/shared";
import {
	DEFAULT_SESSION_RUNTIME_PORT,
	executeSessionMutationAtRoot,
	runSessionMutationActionAtRoot,
	type SessionMutationAction,
	type SessionMutationResult,
	type SessionRuntimePort,
} from "./session-engine";
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

const MISSING_PLANNING_SESSION_RESPONSE = {
	status: "missing_session",
	summary: "No active Flow planning session exists.",
	nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
} as const;

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

export const SESSION_MUTATION_ACTION_HANDLERS: SessionMutationActionHandlerMap =
	{
		record_planning_context(nextPlanning) {
			return {
				name: "record_planning_context",
				run: (session) => {
					const updated: Session = {
						...session,
						planning: {
							repoProfile:
								nextPlanning.repoProfile ?? session.planning.repoProfile,
							packageManager:
								nextPlanning.packageManager ?? session.planning.packageManager,
							packageManagerAmbiguous:
								nextPlanning.packageManagerAmbiguous ??
								session.planning.packageManagerAmbiguous,
							research: nextPlanning.research ?? session.planning.research,
							implementationApproach:
								nextPlanning.implementationApproach ??
								session.planning.implementationApproach,
							decisionLog:
								nextPlanning.decisionLog ?? session.planning.decisionLog,
							replanLog: nextPlanning.replanLog ?? session.planning.replanLog,
						},
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
				missingResponse: {
					status: "missing_session",
					summary: "No active Flow session exists.",
					nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
				},
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
				}),
			};
		},

		reset_feature({ featureId }) {
			return {
				name: "reset_feature",
				run: (session) => resetFeature(session, featureId),
				getSession: (value) => value,
				onSuccess: (saved) =>
					okWithSession(saved, `Reset feature '${featureId}'.`),
			};
		},

		record_feature_review({ decision }) {
			const normalized = {
				scope: "feature" as const,
				featureId: decision.featureId,
				status: decision.status,
				summary: decision.summary,
				blockingFindings: decision.blockingFindings ?? [],
				followUps: decision.followUps ?? [],
				suggestedValidation: decision.suggestedValidation ?? [],
				...(decision.reviewPurpose
					? { reviewPurpose: decision.reviewPurpose }
					: {}),
			};
			return {
				name: "record_feature_review",
				run: (session) => recordReviewerDecision(session, normalized),
				getSession: (value) => value,
				onSuccess: (saved) =>
					okWithSession(saved, "Reviewer decision recorded."),
			};
		},

		record_final_review({ decision }) {
			const normalized = {
				scope: "final" as const,
				status: decision.status,
				summary: decision.summary,
				blockingFindings: decision.blockingFindings ?? [],
				followUps: decision.followUps ?? [],
				suggestedValidation: decision.suggestedValidation ?? [],
				...(decision.reviewPurpose
					? { reviewPurpose: decision.reviewPurpose }
					: {}),
			};
			return {
				name: "record_final_review",
				run: (session) => recordReviewerDecision(session, normalized),
				getSession: (value) => value,
				onSuccess: (saved) =>
					okWithSession(saved, "Reviewer decision recorded."),
			};
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

export function resetFeatureRecoveryCommand(featureId: string) {
	return flowResetFeatureCommand(featureId);
}
