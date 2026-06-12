/**
 * Flow action engine: the single load -> mutate -> validate -> persist ->
 * render pipeline shared by every session action. Handlers live in
 * `actions.ts`; this module owns runtime ports, result shapes, and
 * finalization (persistence + artifact sync + response shaping).
 */
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
import type { LatestFailedFlowAttempt, Session } from "../schema";
import type { TransitionResult } from "../transitions";

export type RuntimeToolResponse = Record<string, unknown>;

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

export type FailedAttemptClearPolicy =
	| true
	| { tool: LatestFailedFlowAttempt["tool"] };

export type SessionArtifactSyncFailure = {
	status: "failed";
	error: string;
};

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
			kind: "success_artifact_sync_failed";
			actionName: Name;
			value: T;
			savedSession: Session;
			response: RuntimeToolResponse;
			artifactSync: SessionArtifactSyncFailure;
	  }
	| {
			kind: "failure";
			actionName: Name;
			response: RuntimeToolResponse;
			transition: Extract<TransitionResult<T>, { ok: false }>;
			savedSession?: Session;
			artifactSync?: SessionArtifactSyncFailure;
	  };

export type RuntimeAction<T, Name extends string, Port> = {
	name: Name;
	run: (worktree: string, runtime: Port) => Promise<T>;
	onSuccess: (value: T) => RuntimeToolResponse;
};

export type RuntimeActionResult<T, Name extends string = string> = {
	actionName: Name;
	value: T;
	response: RuntimeToolResponse;
};

export type SessionReadAction<T, Name extends string = string> = RuntimeAction<
	T,
	Name,
	SessionReadRuntimePort
>;

export type SessionReadResult<
	T,
	Name extends string = string,
> = RuntimeActionResult<T, Name>;

export type SessionWorkspaceAction<
	T,
	Name extends string = string,
> = RuntimeAction<T, Name, SessionWorkspaceRuntimePort>;

export type SessionWorkspaceResult<
	T,
	Name extends string = string,
> = RuntimeActionResult<T, Name>;

export async function runRuntimeActionAtRoot<T, Name extends string, Port>(
	worktree: string,
	action: RuntimeAction<T, Name, Port>,
	runtime: Port,
): Promise<RuntimeActionResult<T, Name>> {
	const value = await action.run(worktree, runtime);
	return { actionName: action.name, value, response: action.onSuccess(value) };
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message
		? error.message
		: String(error);
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

function valueWithSavedSession<T>(
	value: T,
	resultSession: Session,
	savedSession: Session,
): T {
	if (value === resultSession) {
		return savedSession as T;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return value;
	}
	if (!Object.hasOwn(value, "session")) {
		return value;
	}
	const compositeValue = value as T & { session?: unknown };
	if (compositeValue.session !== resultSession) {
		return value;
	}
	return { ...compositeValue, session: savedSession } as T;
}

async function syncArtifactsAfterPersistence(
	worktree: string,
	session: Session,
	syncArtifacts: boolean,
	runtime: SessionRuntimePort,
): Promise<SessionArtifactSyncFailure | null> {
	if (!syncArtifacts) {
		return null;
	}
	try {
		await runtime.syncSessionArtifacts(worktree, session);
		return null;
	} catch (error) {
		return { status: "failed", error: errorMessage(error) };
	}
}

export async function runMutationActionAtRoot<T, Name extends string>(
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

	let result = action.run(session);
	if (!result.ok && action.recordFailure) {
		const failureSession = action.recordFailure(
			result.session ?? session,
			result,
		);
		if (failureSession) {
			result = { ...result, session: failureSession };
		}
	}

	const syncArtifacts = action.syncArtifacts ?? true;
	const onError =
		action.onError ??
		((failure: Extract<TransitionResult<T>, { ok: false }>) =>
			errorResponse(failure.message));

	if (
		result.ok &&
		action.onNoopSuccess &&
		action.isNoopSuccess?.(result.value, session) === true
	) {
		const artifactSync = await syncArtifactsAfterPersistence(
			worktree,
			session,
			syncArtifacts,
			runtime,
		);
		const response = action.onNoopSuccess(session, result.value);
		if (artifactSync) {
			return {
				kind: "success_artifact_sync_failed",
				actionName: action.name,
				value: result.value,
				savedSession: session,
				response: {
					...response,
					status: "partial_success",
					persistedMutation: false,
					artifactSync,
				},
				artifactSync,
			};
		}
		return {
			kind: "success",
			actionName: action.name,
			value: result.value,
			savedSession: session,
			response,
		};
	}

	if (!result.ok) {
		if (!result.session) {
			return {
				kind: "failure",
				actionName: action.name,
				response: onError(result),
				transition: result,
			};
		}
		const saved = await runtime.saveSessionState(worktree, result.session);
		const artifactSync = await syncArtifactsAfterPersistence(
			worktree,
			saved,
			syncArtifacts,
			runtime,
		);
		const response = onError(result);
		return {
			kind: "failure",
			actionName: action.name,
			response: artifactSync
				? { ...response, persistedMutation: true, artifactSync }
				: response,
			transition: result,
			savedSession: saved,
			...(artifactSync ? { artifactSync } : {}),
		};
	}

	const resultSession = action.getSession(result.value);
	const nextSession = applyFailedAttemptClearPolicy(
		resultSession,
		action.clearFailedAttemptOnSuccess,
	);
	const saved = await runtime.saveSessionState(worktree, nextSession);
	const responseValue = valueWithSavedSession(
		result.value,
		resultSession,
		saved,
	);
	const artifactSync = await syncArtifactsAfterPersistence(
		worktree,
		saved,
		syncArtifacts,
		runtime,
	);
	const response = action.onSuccess(saved, responseValue);
	if (artifactSync) {
		return {
			kind: "success_artifact_sync_failed",
			actionName: action.name,
			value: responseValue,
			savedSession: saved,
			response: {
				...response,
				status: "partial_success",
				persistedMutation: true,
				artifactSync,
			},
			artifactSync,
		};
	}
	return {
		kind: "success",
		actionName: action.name,
		value: responseValue,
		savedSession: saved,
		response,
	};
}
