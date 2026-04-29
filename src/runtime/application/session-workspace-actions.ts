import { FLOW_PLAN_WITH_GOAL_COMMAND, FLOW_STATUS_COMMAND } from "../constants";
import type { PlanningContext, Session } from "../schema";
import { type closeSession, createSession } from "../session";
import { deriveSessionOperatorState } from "../session-operator-state";
import { summarizeSession } from "../summary";
import { detectPackageManager } from "./package-manager";
import {
	DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
	executeSessionWorkspaceActionAtRoot,
	runSessionWorkspaceActionAtRoot,
	type SessionWorkspaceAction,
	type SessionWorkspaceResult,
	type SessionWorkspaceRuntimePort,
} from "./session-engine";
import {
	resolveMutableSessionRoot,
	type WorkspaceContext,
} from "./workspace-runtime";

type ClosedSessionResult = Awaited<ReturnType<typeof closeSession>>;

type PlannedSessionResult =
	| {
			status: "missing_goal";
			nextCommand: string;
	  }
	| {
			status: "ok";
			session: Session;
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
		planning: {
			...existing.planning,
			repoProfile: planning?.repoProfile ?? existing.planning.repoProfile,
			packageManager:
				planning?.packageManager ?? existing.planning.packageManager,
			packageManagerAmbiguous:
				planning?.packageManagerAmbiguous ??
				existing.planning.packageManagerAmbiguous,
		},
	};
}

export const SESSION_WORKSPACE_ACTION_NAMES = [
	"plan_start",
	"activate_session",
	"close_session",
] as const;

export type SessionWorkspaceActionName =
	(typeof SESSION_WORKSPACE_ACTION_NAMES)[number];

export type SessionWorkspacePayloadMap = {
	plan_start: {
		goal?: string;
		repoProfile?: string[];
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
	plan_start: PlannedSessionResult;
	activate_session: Session | null;
	close_session: ClosedSessionResult;
};

type SessionWorkspaceActionHandlerMap = {
	[Name in SessionWorkspaceActionName]: (
		payload: SessionWorkspacePayloadMap[Name],
	) => SessionWorkspaceAction<SessionWorkspaceValueMap[Name], Name>;
};

export const SESSION_WORKSPACE_ACTION_HANDLERS: SessionWorkspaceActionHandlerMap =
	{
		plan_start({ goal, repoProfile, directory, missingGoalNextCommand }) {
			return {
				name: "plan_start",
				run: async (worktree, runtime) => {
					const existing = await runtime.loadSession(worktree);
					const packageManagerDetection = await detectPackageManager(
						worktree,
						directory,
					);
					if (!goal && !existing) {
						return {
							status: "missing_goal",
							nextCommand:
								missingGoalNextCommand ?? FLOW_PLAN_WITH_GOAL_COMMAND,
						};
					}

					const resolvedGoal = goal ?? existing?.goal;
					if (!resolvedGoal) {
						return {
							status: "missing_goal",
							nextCommand:
								missingGoalNextCommand ?? FLOW_PLAN_WITH_GOAL_COMMAND,
						};
					}

					const session = await runtime.saveSessionState(
						worktree,
						buildPlannedSession(existing, resolvedGoal, {
							...(repoProfile ? { repoProfile } : {}),
							...(packageManagerDetection.packageManager
								? {
										packageManager: packageManagerDetection.packageManager,
									}
								: {}),
							packageManagerAmbiguous: packageManagerDetection.ambiguous,
						}),
					);
					await runtime.syncSessionArtifacts(worktree, session);
					return { status: "ok", session };
				},
				onSuccess: (value) =>
					value.status === "missing_goal"
						? {
								status: "missing_goal",
								summary: "Provide a goal to create a new Flow plan.",
								nextCommand: value.nextCommand,
							}
						: {
								status: "ok",
								summary: `Planning session ready for goal: ${value.session.goal}`,
								session: summarizeSession(value.session).session,
							},
			};
		},

		activate_session({ sessionId, nextCommand, missingNextCommand }) {
			return {
				name: "activate_session",
				run: (worktree, runtime) =>
					runtime.activateSession(worktree, sessionId),
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
				run: (worktree, runtime) =>
					runtime.closeSession(worktree, kind, summary),
				onSuccess: (completed) => {
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

export function buildSessionWorkspaceAction<
	Name extends SessionWorkspaceActionName,
>(
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
): SessionWorkspaceAction<SessionWorkspaceValueMap[Name], Name> {
	return SESSION_WORKSPACE_ACTION_HANDLERS[name](payload);
}

export function dispatchSessionWorkspaceAction<
	Name extends SessionWorkspaceActionName,
>(
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
): SessionWorkspaceAction<SessionWorkspaceValueMap[Name], Name> {
	return buildSessionWorkspaceAction(name, payload);
}

export async function executeDispatchedSessionWorkspaceAction<
	Name extends SessionWorkspaceActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
	runtime: SessionWorkspaceRuntimePort = DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
): Promise<string> {
	const response = await executeSessionWorkspaceActionAtRoot(
		resolveMutableSessionRoot(context).root,
		dispatchSessionWorkspaceAction(name, payload),
		runtime,
	);
	return JSON.stringify(response, null, 2);
}

export async function runDispatchedSessionWorkspaceAction<
	Name extends SessionWorkspaceActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
	runtime: SessionWorkspaceRuntimePort = DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
): Promise<SessionWorkspaceResult<SessionWorkspaceValueMap[Name], Name>> {
	return runSessionWorkspaceActionAtRoot(
		resolveMutableSessionRoot(context).root,
		dispatchSessionWorkspaceAction(name, payload),
		runtime,
	);
}
