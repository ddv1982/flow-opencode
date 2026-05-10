import { errorResponse } from "../errors";
import type { LatestFailedFlowAttempt, Session } from "../schema";
import {
	activateSession,
	closeSession,
	listSessionHistory,
	loadSession,
	loadStoredSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../session";
import type { TransitionResult } from "../transitions";

export type RuntimeToolResponse = Record<string, unknown>;

type FailedAttemptClearPolicy =
	| true
	| { tool: LatestFailedFlowAttempt["tool"] };

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

export type SessionMutationResult<T, Name extends string = string> =
	| { kind: "missing"; actionName: Name; response: RuntimeToolResponse }
	| {
			kind: "success";
			actionName: Name;
			value: T;
			savedSession: Session;
			response: RuntimeToolResponse;
	  }
	| {
			kind: "failure";
			actionName: Name;
			response: RuntimeToolResponse;
			transition: Extract<TransitionResult<T>, { ok: false }>;
			savedSession?: Session;
	  };

export type SessionReadAction<T, Name extends string = string> = {
	name: Name;
	run: (worktree: string, runtime: SessionReadRuntimePort) => Promise<T>;
	onSuccess: (value: T) => RuntimeToolResponse;
};

export type SessionReadResult<T, Name extends string = string> = {
	actionName: Name;
	value: T;
	response: RuntimeToolResponse;
};

export type SessionWorkspaceAction<T, Name extends string = string> = {
	name: Name;
	run: (worktree: string, runtime: SessionWorkspaceRuntimePort) => Promise<T>;
	onSuccess: (value: T) => RuntimeToolResponse;
};

export type SessionWorkspaceResult<T, Name extends string = string> = {
	actionName: Name;
	value: T;
	response: RuntimeToolResponse;
};

type RuntimeAction<Name extends string, T, Port> = {
	name: Name;
	run: (worktree: string, runtime: Port) => Promise<T>;
	onSuccess: (value: T) => RuntimeToolResponse;
};

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

function actionSuccessResult<T, Name extends string>(
	actionName: Name,
	value: T,
	response: RuntimeToolResponse,
) {
	return { actionName, value, response };
}

function applyFailedAttemptClearPolicy(
	session: Session,
	policy: FailedAttemptClearPolicy | undefined,
): Session {
	if (!policy) {
		return session;
	}
	const shouldClear =
		policy === true ||
		session.execution.lastFailedMutation?.tool === policy.tool;
	if (!shouldClear) {
		return session;
	}
	return {
		...session,
		execution: {
			...session.execution,
			lastFailedMutation: null,
		},
	};
}

async function runRuntimeActionAtRoot<T, Name extends string, Port>(
	worktree: string,
	action: RuntimeAction<Name, T, Port>,
	runtime: Port,
) {
	const value = await action.run(worktree, runtime);
	return actionSuccessResult(action.name, value, action.onSuccess(value));
}

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

export async function persistTransitionAtRoot<T, Name extends string>(
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
): Promise<RuntimeToolResponse> {
	return (
		await executeTransitionAtRoot(
			actionName,
			worktree,
			result,
			getSession,
			onSuccess,
			onError,
			options,
			runtime,
		)
	).response;
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
	if (!result.ok) {
		if (result.session) {
			const saved = await runtime.saveSessionState(worktree, result.session);
			if (options.syncArtifacts)
				await runtime.syncSessionArtifacts(worktree, saved);
			return {
				kind: "failure",
				actionName,
				response: onError(result),
				transition: result,
				savedSession: saved,
			};
		}
		return {
			kind: "failure",
			actionName,
			response: onError(result),
			transition: result,
		};
	}

	const resultSession = getSession(result.value);
	const nextSession = applyFailedAttemptClearPolicy(
		resultSession,
		options.clearFailedAttemptOnSuccess,
	);
	const saved = await runtime.saveSessionState(worktree, nextSession);
	const responseValue =
		result.value === resultSession ? (saved as T) : result.value;
	if (options.syncArtifacts)
		await runtime.syncSessionArtifacts(worktree, saved);
	return {
		kind: "success",
		actionName,
		value: responseValue,
		savedSession: saved,
		response: onSuccess(saved, responseValue),
	};
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
		if (action.syncArtifacts ?? true) {
			await runtime.syncSessionArtifacts(worktree, session);
		}
		return {
			kind: "success",
			actionName: action.name,
			value: resultWithFailureProjection.value,
			savedSession: session,
			response: action.onNoopSuccess(
				session,
				resultWithFailureProjection.value,
			),
		};
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
