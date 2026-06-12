/**
 * Flow action registry: one handler per session action, grouped into three
 * registries (mutations, workspace lifecycle, reads) plus the public
 * dispatch API (`runFlowCoreCommand` / `runFlowCoreQuery` and their
 * JSON-rendering `execute*` variants). The shared load -> mutate ->
 * validate -> persist -> render pipeline lives in `action-engine.ts`.
 */
import { FLOW_PLAN_WITH_GOAL_COMMAND, FLOW_STATUS_COMMAND } from "../constants";
import { describeReviewFindingsMutationFailure } from "../domain";
import { mergePlanningContext } from "../domain/planning-context";
import { errorResponse } from "../errors";
import {
	type closeSession,
	createSession,
	type listSessionHistory,
	type loadStoredSession,
} from "../lifecycle";
import type {
	Feature,
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
	LatestFailedFlowAttempt,
	PlanArgs,
	PlanningContext,
	Session,
	WorkerResultArgs,
} from "../schema";
import { deriveSessionOperatorState } from "../session-operator-state";
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
import type { SessionArtifactSyncFailure } from "./action-engine";
import {
	DEFAULT_SESSION_READ_RUNTIME_PORT,
	DEFAULT_SESSION_RUNTIME_PORT,
	DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
	type RuntimeToolResponse,
	runMutationActionAtRoot,
	runRuntimeActionAtRoot,
	type SessionMutationAction,
	type SessionMutationResult,
	type SessionReadAction,
	type SessionReadResult,
	type SessionReadRuntimePort,
	type SessionRuntimePort,
	type SessionWorkspaceAction,
	type SessionWorkspaceResult,
	type SessionWorkspaceRuntimePort,
} from "./action-engine";
import { detectPackageManager } from "./package-manager";
import {
	normalizeFeatureReviewDecision,
	normalizeFinalReviewDecision,
} from "./session-review-decision-normalization";
import {
	resolveMutableSessionRoot,
	resolveReadableSessionRoot,
	type WorkspaceContext,
} from "./workspace-runtime";

// ---------------------------------------------------------------------------
// Shared response helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mutation actions (load -> transition -> persist -> sync -> respond)
// ---------------------------------------------------------------------------

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

type SessionMutationValueMap = {
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

// ---------------------------------------------------------------------------
// Workspace lifecycle actions (create/activate/close at the workspace root)
// ---------------------------------------------------------------------------

type ClosedSessionResult = Awaited<ReturnType<typeof closeSession>>;

type PlannedSessionResult =
	| {
			status: "missing_goal";
			nextCommand: string;
	  }
	| {
			status: "ok";
			session: Session;
			artifactSync?: SessionArtifactSyncFailure;
	  };

function buildPlannedSession(
	existing: Session | null,
	goal: string,
	planning?: Partial<PlanningContext>,
) {
	const isNewGoal = Boolean(existing && goal !== existing.goal);

	if (!existing || existing.status === "completed" || isNewGoal) {
		return createSession(goal, planning);
	}

	return {
		...existing,
		planning: mergePlanningContext(existing.planning, planning ?? {}),
	};
}

export const SESSION_WORKSPACE_ACTION_NAMES = [
	"plan_save",
	"activate_session",
	"close_session",
] as const;

export type SessionWorkspaceActionName =
	(typeof SESSION_WORKSPACE_ACTION_NAMES)[number];

export type SessionWorkspacePayloadMap = {
	plan_save: {
		goal?: string;
		planning?: Partial<PlanningContext>;
		directory?: string;
		missingGoalNextCommand?: string;
	};
	activate_session: {
		sessionId: string;
		nextCommand?: string;
		missingNextCommand?: string;
	};
	close_session: {
		kind: NonNullable<Session["closure"]>["kind"];
		summary?: string;
		nextCommand?: string;
	};
};

export type SessionWorkspaceValueMap = {
	plan_save: PlannedSessionResult;
	activate_session: Session | null;
	close_session: ClosedSessionResult;
};

type SessionWorkspaceActionHandlerMap = {
	[Name in SessionWorkspaceActionName]: (
		payload: SessionWorkspacePayloadMap[Name],
	) => SessionWorkspaceAction<SessionWorkspaceValueMap[Name], Name>;
};

const WORKSPACE_ACTION_HANDLERS: SessionWorkspaceActionHandlerMap = {
	plan_save({ goal, planning, directory, missingGoalNextCommand }) {
		return {
			name: "plan_save",
			run: async (worktree, runtime) => {
				const existing = await runtime.loadSession(worktree);
				const resolvedGoal = goal ?? existing?.goal;
				if (!resolvedGoal) {
					return {
						status: "missing_goal",
						nextCommand: missingGoalNextCommand ?? FLOW_PLAN_WITH_GOAL_COMMAND,
					};
				}

				const packageManagerDetection = await detectPackageManager(
					worktree,
					directory,
				);

				const session = await runtime.saveSessionState(
					worktree,
					buildPlannedSession(existing, resolvedGoal, {
						...(planning ?? {}),
						...(packageManagerDetection.packageManager
							? {
									packageManager: packageManagerDetection.packageManager,
								}
							: {}),
						packageManagerAmbiguous: packageManagerDetection.ambiguous,
					}),
				);
				try {
					await runtime.syncSessionArtifacts(worktree, session);
					return { status: "ok", session };
				} catch (error) {
					return {
						status: "ok",
						session,
						artifactSync: {
							status: "failed",
							error:
								error instanceof Error && error.message
									? error.message
									: String(error),
						},
					};
				}
			},
			onSuccess: (value) =>
				value.status === "missing_goal"
					? {
							status: "missing_goal",
							summary: "Provide a goal to create a new Flow plan.",
							nextCommand: value.nextCommand,
						}
					: {
							status: value.artifactSync ? "partial_success" : "ok",
							summary: `Planning session ready for goal: ${value.session.goal}`,
							...(value.artifactSync
								? {
										persistedMutation: true,
										artifactSync: value.artifactSync,
									}
								: {}),
							session: summarizeSession(value.session).session,
						},
		};
	},

	activate_session({ sessionId, nextCommand, missingNextCommand }) {
		return {
			name: "activate_session",
			run: (worktree, runtime) => runtime.activateSession(worktree, sessionId),
			onSuccess: (session) => {
				if (!session) {
					const operator = deriveSessionOperatorState(null);
					return {
						status: "missing_session",
						summary: `No stored Flow session exists for id '${sessionId}'.`,
						operator,
						phase: operator.phase,
						lane: operator.lane,
						blocker: operator.blocker,
						reason: operator.reason,
						nextCommand: missingNextCommand ?? FLOW_PLAN_WITH_GOAL_COMMAND,
					};
				}

				return {
					status: "ok",
					summary: `Activated Flow session: ${session.goal}`,
					phase: "idle",
					lane: "lite",
					blocker: null,
					reason:
						"Activation finished, so Flow is ready for the operator to inspect or continue the session.",
					session: summarizeSession(session).session,
					nextCommand: nextCommand ?? FLOW_STATUS_COMMAND,
				};
			},
		};
	},

	close_session({ kind, summary, nextCommand }) {
		return {
			name: "close_session",
			run: (worktree, runtime) => runtime.closeSession(worktree, kind, summary),
			onSuccess: (completed) => {
				if (completed && "blocked" in completed) {
					return errorResponse(completed.summary, {
						blocker: "unfinished_features",
						unfinishedFeatureIds: completed.unfinishedFeatureIds,
						sessionId: completed.sessionId,
						nextCommand: FLOW_STATUS_COMMAND,
					});
				}
				const operator = deriveSessionOperatorState(null);
				return {
					status: "ok",
					summary: completed
						? `Closed the active Flow session as ${completed.closureKind}.`
						: "No active Flow session existed.",
					operator,
					phase: operator.phase,
					lane: operator.lane,
					blocker: operator.blocker,
					reason: operator.reason,
					completedSessionId: completed?.sessionId ?? null,
					completedTo: completed?.completedTo ?? null,
					closureKind: completed?.closureKind ?? null,
					nextCommand: nextCommand ?? FLOW_PLAN_WITH_GOAL_COMMAND,
				};
			},
		};
	},
};

// ---------------------------------------------------------------------------
// Read actions
// ---------------------------------------------------------------------------

export const SESSION_READ_ACTION_NAMES = [
	"load_status_session",
	"list_session_history",
	"load_history_session",
] as const;

export type SessionReadActionName = (typeof SESSION_READ_ACTION_NAMES)[number];

export type SessionReadPayloadMap = {
	load_status_session: undefined;
	list_session_history: undefined;
	load_history_session: { sessionId: string };
};

export type SessionReadValueMap = {
	load_status_session: Session | null;
	list_session_history: Awaited<ReturnType<typeof listSessionHistory>>;
	load_history_session: Awaited<ReturnType<typeof loadStoredSession>>;
};

type SessionReadActionHandlerMap = {
	[Name in SessionReadActionName]: (
		payload: SessionReadPayloadMap[Name],
	) => SessionReadAction<SessionReadValueMap[Name], Name>;
};

const READ_ACTION_HANDLERS: SessionReadActionHandlerMap = {
	load_status_session() {
		return {
			name: "load_status_session",
			run: (worktree, runtime) => runtime.loadSession(worktree),
			onSuccess: (session) => ({
				status: session ? "ok" : "missing_session",
				session,
			}),
		};
	},
	list_session_history() {
		return {
			name: "list_session_history",
			run: (worktree, runtime) => runtime.listSessionHistory(worktree),
			onSuccess: (history) => ({ status: "ok", history }),
		};
	},
	load_history_session({ sessionId }) {
		return {
			name: "load_history_session",
			run: (worktree, runtime) =>
				runtime.loadStoredSession(worktree, sessionId),
			onSuccess: (session) => ({
				status: session ? "ok" : "missing_session",
				session,
			}),
		};
	},
};

// ---------------------------------------------------------------------------
// Dispatch API
// ---------------------------------------------------------------------------

type FlowCoreCommandName =
	| SessionWorkspaceActionName
	| SessionMutationActionName;

const WORKSPACE_COMMAND_NAME_SET = new Set<string>(
	SESSION_WORKSPACE_ACTION_NAMES,
);
const MUTATION_COMMAND_NAME_SET = new Set<string>(
	SESSION_MUTATION_ACTION_NAMES,
);

function isWorkspaceCommandName(
	name: string,
): name is SessionWorkspaceActionName {
	return WORKSPACE_COMMAND_NAME_SET.has(name);
}

function isMutationCommandName(
	name: string,
): name is SessionMutationActionName {
	return MUTATION_COMMAND_NAME_SET.has(name);
}

function buildMutationAction<Name extends SessionMutationActionName>(
	name: Name,
	payload: SessionMutationPayloadMap[Name],
): SessionMutationAction<SessionMutationValueMap[Name]> {
	return MUTATION_ACTION_HANDLERS[name](payload);
}

function buildWorkspaceAction<Name extends SessionWorkspaceActionName>(
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
): SessionWorkspaceAction<SessionWorkspaceValueMap[Name], Name> {
	return WORKSPACE_ACTION_HANDLERS[name](payload);
}

async function runCommand(
	context: WorkspaceContext,
	name: FlowCoreCommandName,
	payload: unknown,
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<
	| SessionWorkspaceResult<
			SessionWorkspaceValueMap[SessionWorkspaceActionName],
			SessionWorkspaceActionName
	  >
	| SessionMutationResult<
			SessionMutationValueMap[SessionMutationActionName],
			SessionMutationActionName
	  >
> {
	const root = resolveMutableSessionRoot(context).root;
	if (isWorkspaceCommandName(name)) {
		return runRuntimeActionAtRoot(
			root,
			buildWorkspaceAction(
				name,
				payload as SessionWorkspacePayloadMap[typeof name],
			),
			(runtime as SessionWorkspaceRuntimePort | undefined) ??
				DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
		);
	}
	if (!isMutationCommandName(name)) {
		throw new Error(`Unknown Flow Core command '${name}'.`);
	}
	return runMutationActionAtRoot(
		root,
		buildMutationAction(
			name,
			payload as SessionMutationPayloadMap[typeof name],
		),
		(runtime as SessionRuntimePort | undefined) ?? DEFAULT_SESSION_RUNTIME_PORT,
	) as Promise<
		SessionMutationResult<
			SessionMutationValueMap[SessionMutationActionName],
			SessionMutationActionName
		>
	>;
}

export function runFlowCoreCommand<Name extends SessionWorkspaceActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
	runtime?: SessionWorkspaceRuntimePort,
): Promise<SessionWorkspaceResult<SessionWorkspaceValueMap[Name], Name>>;
export function runFlowCoreCommand<Name extends SessionMutationActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
	runtime?: SessionRuntimePort,
): Promise<SessionMutationResult<SessionMutationValueMap[Name], Name>>;
export async function runFlowCoreCommand(
	context: WorkspaceContext,
	name: FlowCoreCommandName,
	payload: unknown,
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<unknown> {
	return runCommand(context, name, payload, runtime);
}

export function executeFlowCoreCommand<Name extends SessionWorkspaceActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
	runtime?: SessionWorkspaceRuntimePort,
): Promise<string>;
export function executeFlowCoreCommand<Name extends SessionMutationActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
	runtime?: SessionRuntimePort,
): Promise<string>;
export async function executeFlowCoreCommand(
	context: WorkspaceContext,
	name: FlowCoreCommandName,
	payload: unknown,
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<string> {
	const result = await runCommand(context, name, payload, runtime);
	return JSON.stringify(result.response, null, 2);
}

export async function runFlowCoreQuery<Name extends SessionReadActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
	runtime: SessionReadRuntimePort = DEFAULT_SESSION_READ_RUNTIME_PORT,
): Promise<SessionReadResult<SessionReadValueMap[Name], Name>> {
	return runRuntimeActionAtRoot(
		resolveReadableSessionRoot(context).root,
		READ_ACTION_HANDLERS[name](payload),
		runtime,
	);
}

export async function executeFlowCoreQuery<Name extends SessionReadActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
	runtime?: SessionReadRuntimePort,
): Promise<RuntimeToolResponse> {
	return (await runFlowCoreQuery(context, name, payload, runtime)).response;
}
