import type { LatestFailedFlowAttempt, Session } from "../schema";
import type { TransitionResult } from "../transitions";
import type { RuntimeToolResponse } from "./session-engine-action-runner";

export type FailedAttemptClearPolicy =
	| true
	| { tool: LatestFailedFlowAttempt["tool"] };

export interface SessionMutationPersistencePort {
	saveSessionState: (worktree: string, session: Session) => Promise<Session>;
	syncSessionArtifacts: (worktree: string, session: Session) => Promise<void>;
}

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
	const responseValue = valueWithSavedSession(
		result.value,
		resultSession,
		saved,
	);
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

export async function finalizeNoopMutationAtRoot<T, Name extends string>(
	actionName: Name,
	worktree: string,
	originalSession: Session,
	value: T,
	onNoopSuccess: (saved: Session, value: T) => RuntimeToolResponse,
	syncArtifacts: boolean,
	runtime: SessionMutationPersistencePort,
): Promise<SessionMutationResult<T, Name>> {
	if (syncArtifacts) {
		await runtime.syncSessionArtifacts(worktree, originalSession);
	}
	return {
		kind: "success",
		actionName,
		value,
		savedSession: originalSession,
		response: onNoopSuccess(originalSession, value),
	};
}
