import { errorResponse } from "../errors";
import {
	activateSession,
	closeSession,
	listSessionHistory,
	loadSession,
	loadStoredSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../lifecycle";
import type { Session } from "../schema";
import type { TransitionResult } from "../transitions";
import {
	type RuntimeToolResponse as EngineRuntimeToolResponse,
	type SessionReadAction as RuntimeSessionReadAction,
	type SessionReadResult as RuntimeSessionReadResult,
	type SessionWorkspaceAction as RuntimeSessionWorkspaceAction,
	type SessionWorkspaceResult as RuntimeSessionWorkspaceResult,
	runRuntimeActionAtRoot,
} from "./session-engine-action-runner";
import {
	type FailedAttemptClearPolicy,
	finalizeNoopMutationAtRoot,
	finalizeTransitionAtRoot,
	type SessionMutationResult,
} from "./session-mutation-finalization";

export type {
	FailedAttemptClearPolicy,
	SessionMutationResult,
} from "./session-mutation-finalization";

export type RuntimeToolResponse = EngineRuntimeToolResponse;

export interface SessionRuntimePort {
	loadSession: (worktree: string) => Promise<Session | null>;
	saveSessionState: (worktree: string, session: Session) => Promise<Session>;
	syncSessionArtifacts: (worktree: string, session: Session) => Promise<void>;
}

export interface SessionReadRuntimePort {
	loadSession: (worktree: string) => Promise<Session | null>;
	listSessionHistory: typeof listSessionHistory;
	loadStoredSession: typeof loadStoredSession;
}

export interface SessionWorkspaceRuntimePort extends SessionRuntimePort {
	activateSession: typeof activateSession;
	closeSession: typeof closeSession;
}

export type SessionMutationAction<T, Name extends string = string> = {
	name: Name;
	run: (session: Session) => TransitionResult<T>;
	getSession: (value: T) => Session;
	onSuccess: (saved: Session, value: T) => RuntimeToolResponse;
	isNoopSuccess?: (value: T, originalSession: Session) => boolean;
	onNoopSuccess?: (saved: Session, value: T) => RuntimeToolResponse;
	missingResponse?: RuntimeToolResponse;
	onError?: (
		result: Extract<TransitionResult<T>, { ok: false }>,
	) => RuntimeToolResponse;
	recordFailure?: (
		session: Session,
		result: Extract<TransitionResult<T>, { ok: false }>,
	) => Session | null;
	clearFailedAttemptOnSuccess?: FailedAttemptClearPolicy;
	syncArtifacts?: boolean;
};

export type SessionReadAction<
	T,
	Name extends string = string,
> = RuntimeSessionReadAction<T, Name, SessionReadRuntimePort>;

export type SessionReadResult<
	T,
	Name extends string = string,
> = RuntimeSessionReadResult<T, Name>;

export type SessionWorkspaceAction<
	T,
	Name extends string = string,
> = RuntimeSessionWorkspaceAction<T, Name, SessionWorkspaceRuntimePort>;

export type SessionWorkspaceResult<
	T,
	Name extends string = string,
> = RuntimeSessionWorkspaceResult<T, Name>;

export const DEFAULT_SESSION_RUNTIME_PORT: SessionRuntimePort = {
	loadSession,
	saveSessionState,
	syncSessionArtifacts,
};

export const DEFAULT_SESSION_READ_RUNTIME_PORT: SessionReadRuntimePort = {
	loadSession,
	listSessionHistory,
	loadStoredSession,
};

export const DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT: SessionWorkspaceRuntimePort =
	{
		loadSession,
		saveSessionState,
		syncSessionArtifacts,
		activateSession,
		closeSession,
	};

export async function executeSessionReadActionAtRoot<T, Name extends string>(
	worktree: string,
	action: SessionReadAction<T, Name>,
	runtime: SessionReadRuntimePort = DEFAULT_SESSION_READ_RUNTIME_PORT,
): Promise<RuntimeToolResponse> {
	return (await runSessionReadActionAtRoot(worktree, action, runtime)).response;
}

export async function runSessionReadActionAtRoot<T, Name extends string>(
	worktree: string,
	action: SessionReadAction<T, Name>,
	runtime: SessionReadRuntimePort = DEFAULT_SESSION_READ_RUNTIME_PORT,
): Promise<SessionReadResult<T, Name>> {
	return runRuntimeActionAtRoot(worktree, action, runtime);
}

export async function executeSessionWorkspaceActionAtRoot<
	T,
	Name extends string,
>(
	worktree: string,
	action: SessionWorkspaceAction<T, Name>,
	runtime: SessionWorkspaceRuntimePort = DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
): Promise<RuntimeToolResponse> {
	return (await runSessionWorkspaceActionAtRoot(worktree, action, runtime))
		.response;
}

export async function runSessionWorkspaceActionAtRoot<T, Name extends string>(
	worktree: string,
	action: SessionWorkspaceAction<T, Name>,
	runtime: SessionWorkspaceRuntimePort = DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
): Promise<SessionWorkspaceResult<T, Name>> {
	return runRuntimeActionAtRoot(worktree, action, runtime);
}

export async function executeTransitionAtRoot<T, Name extends string>(
	actionName: Name,
	worktree: string,
	result: TransitionResult<T>,
	getSession: (value: T) => Session,
	onSuccess: (saved: Session, value: T) => RuntimeToolResponse,
	onError: (
		result: Extract<TransitionResult<T>, { ok: false }>,
	) => RuntimeToolResponse = (failure) => errorResponse(failure.message),
	options: {
		syncArtifacts?: boolean;
		clearFailedAttemptOnSuccess?: FailedAttemptClearPolicy;
	} = { syncArtifacts: true },
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<SessionMutationResult<T, Name>> {
	return finalizeTransitionAtRoot(
		actionName,
		worktree,
		result,
		getSession,
		onSuccess,
		onError,
		options,
		runtime,
	);
}

export async function executeSessionMutationAtRoot<T, Name extends string>(
	worktree: string,
	action: SessionMutationAction<T, Name>,
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<RuntimeToolResponse> {
	return (await runSessionMutationActionAtRoot(worktree, action, runtime))
		.response;
}

export async function runSessionMutationActionAtRoot<T, Name extends string>(
	worktree: string,
	action: SessionMutationAction<T, Name>,
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<SessionMutationResult<T, Name>> {
	const session = await runtime.loadSession(worktree);
	if (!session) {
		return {
			kind: "missing",
			actionName: action.name,
			response: action.missingResponse ?? {
				status: "missing_session",
				summary: "No active Flow session exists.",
			},
		};
	}

	const result = action.run(session);
	let resultWithFailureProjection: TransitionResult<T> = result;
	if (!result.ok && action.recordFailure) {
		const failureSession = action.recordFailure(
			result.session ?? session,
			result,
		);
		resultWithFailureProjection = failureSession
			? { ...result, session: failureSession }
			: result;
	}
	if (
		resultWithFailureProjection.ok &&
		action.onNoopSuccess &&
		action.isNoopSuccess?.(resultWithFailureProjection.value, session) === true
	) {
		return finalizeNoopMutationAtRoot(
			action.name,
			worktree,
			session,
			resultWithFailureProjection.value,
			action.onNoopSuccess,
			action.syncArtifacts ?? true,
			runtime,
		);
	}

	return executeTransitionAtRoot(
		action.name,
		worktree,
		resultWithFailureProjection,
		action.getSession,
		action.onSuccess,
		action.onError,
		{
			syncArtifacts: action.syncArtifacts ?? true,
			...(action.clearFailedAttemptOnSuccess !== undefined
				? {
						clearFailedAttemptOnSuccess: action.clearFailedAttemptOnSuccess,
					}
				: {}),
		},
		runtime,
	);
}
