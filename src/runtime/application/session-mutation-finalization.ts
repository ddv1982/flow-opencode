import type { LatestFailedFlowAttempt, Session } from "../schema";
import type { TransitionResult } from "../transitions";
import type { RuntimeToolResponse } from "./session-engine-action-runner";

export type FailedAttemptClearPolicy =
	| true
	| { tool: LatestFailedFlowAttempt["tool"] };

interface SessionMutationPersistencePort {
	saveSessionState: (worktree: string, session: Session) => Promise<Session>;
	syncSessionArtifacts: (worktree: string, session: Session) => Promise<void>;
}

export type SessionArtifactSyncFailure = {
	status: "failed";
	error: string;
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

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message
		? error.message
		: String(error);
}

async function syncArtifactsAfterPersistence(
	worktree: string,
	session: Session,
	syncArtifacts: boolean | undefined,
	runtime: SessionMutationPersistencePort,
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

function responseWithPersistedArtifactFailure(
	response: RuntimeToolResponse,
	artifactSync: SessionArtifactSyncFailure,
): RuntimeToolResponse {
	return {
		...response,
		status: "partial_success",
		persistedMutation: true,
		artifactSync,
	};
}

function responseWithArtifactFailure(
	response: RuntimeToolResponse,
	artifactSync: SessionArtifactSyncFailure,
): RuntimeToolResponse {
	return {
		...response,
		persistedMutation: true,
		artifactSync,
	};
}

function responseWithNoopArtifactFailure(
	response: RuntimeToolResponse,
	artifactSync: SessionArtifactSyncFailure,
): RuntimeToolResponse {
	return {
		...response,
		status: "partial_success",
		persistedMutation: false,
		artifactSync,
	};
}

export async function finalizeTransitionAtRoot<T, Name extends string>(
	actionName: Name,
	worktree: string,
	result: TransitionResult<T>,
	getSession: (value: T) => Session,
	onSuccess: (saved: Session, value: T) => RuntimeToolResponse,
	onError: (
		result: Extract<TransitionResult<T>, { ok: false }>,
	) => RuntimeToolResponse,
	options: {
		syncArtifacts?: boolean;
		clearFailedAttemptOnSuccess?: FailedAttemptClearPolicy;
	},
	runtime: SessionMutationPersistencePort,
): Promise<SessionMutationResult<T, Name>> {
	if (!result.ok) {
		if (result.session) {
			const saved = await runtime.saveSessionState(worktree, result.session);
			const artifactSync = await syncArtifactsAfterPersistence(
				worktree,
				saved,
				options.syncArtifacts,
				runtime,
			);
			const response = onError(result);
			return {
				kind: "failure",
				actionName,
				response: artifactSync
					? responseWithArtifactFailure(response, artifactSync)
					: response,
				transition: result,
				savedSession: saved,
				...(artifactSync ? { artifactSync } : {}),
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
	const responseValue = valueWithSavedSession(
		result.value,
		resultSession,
		saved,
	);
	const artifactSync = await syncArtifactsAfterPersistence(
		worktree,
		saved,
		options.syncArtifacts,
		runtime,
	);
	const response = onSuccess(saved, responseValue);
	if (artifactSync) {
		return {
			kind: "success_artifact_sync_failed",
			actionName,
			value: responseValue,
			savedSession: saved,
			response: responseWithPersistedArtifactFailure(response, artifactSync),
			artifactSync,
		};
	}
	return {
		kind: "success",
		actionName,
		value: responseValue,
		savedSession: saved,
		response,
	};
}

export async function finalizeNoopMutationAtRoot<T, Name extends string>(
	actionName: Name,
	worktree: string,
	originalSession: Session,
	value: T,
	onNoopSuccess: (saved: Session, value: T) => RuntimeToolResponse,
	syncArtifacts: boolean,
	runtime: SessionMutationPersistencePort,
): Promise<SessionMutationResult<T, Name>> {
	const artifactSync = await syncArtifactsAfterPersistence(
		worktree,
		originalSession,
		syncArtifacts,
		runtime,
	);
	const response = onNoopSuccess(originalSession, value);
	if (artifactSync) {
		return {
			kind: "success_artifact_sync_failed",
			actionName,
			value,
			savedSession: originalSession,
			response: responseWithNoopArtifactFailure(response, artifactSync),
			artifactSync,
		};
	}
	return {
		kind: "success",
		actionName,
		value,
		savedSession: originalSession,
		response,
	};
}
