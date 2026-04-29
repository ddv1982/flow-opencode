import { errorResponse } from "../errors";
import type { Session } from "../schema";
import type { TransitionResult } from "../transitions";
import type { SessionMutationActionName } from "./session-actions";
import {
	DEFAULT_SESSION_RUNTIME_PORT,
	executeSessionMutationAtRoot,
	persistTransitionAtRoot,
	type RuntimeToolResponse,
	runSessionMutationActionAtRoot,
	type SessionMutationAction,
	type SessionMutationResult,
	type SessionRuntimePort,
} from "./session-engine";
import {
	parseToolArgs,
	resolveMutableSessionRoot,
	resolveReadableSessionRoot,
	type WorkspaceContext,
} from "./workspace-runtime";

export function missingSessionResponse(
	summary = "No active Flow session exists.",
	nextCommand?: string,
): RuntimeToolResponse {
	return nextCommand
		? { status: "missing_session", summary, nextCommand }
		: { status: "missing_session", summary };
}

export async function withSession(
	context: WorkspaceContext,
	execute: (session: Session) => Promise<string>,
	missingResponse: RuntimeToolResponse = missingSessionResponse(),
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<string> {
	const session = await runtime.loadSession(
		resolveReadableSessionRoot(context).root,
	);
	if (!session) {
		return JSON.stringify(missingResponse, null, 2);
	}
	return execute(session);
}

export async function persistTransition<T>(
	context: WorkspaceContext,
	actionName: SessionMutationActionName,
	result: TransitionResult<T>,
	getSession: (value: T) => Session,
	onSuccess: (saved: Session, value: T) => RuntimeToolResponse,
	onError: (
		result: Extract<TransitionResult<T>, { ok: false }>,
	) => RuntimeToolResponse = (failure) => errorResponse(failure.message),
	options: { syncArtifacts?: boolean } = { syncArtifacts: true },
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<string> {
	return JSON.stringify(
		await persistTransitionAtRoot(
			actionName,
			resolveMutableSessionRoot(context).root,
			result,
			getSession,
			onSuccess,
			onError,
			options,
			runtime,
		),
		null,
		2,
	);
}

export async function executeSessionMutation<T>(
	context: WorkspaceContext,
	action: SessionMutationAction<T>,
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<string> {
	return JSON.stringify(
		await executeSessionMutationAtRoot(
			resolveMutableSessionRoot(context).root,
			action,
			runtime,
		),
		null,
		2,
	);
}

export async function runSessionMutationAction<T>(
	context: WorkspaceContext,
	action: SessionMutationAction<T>,
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<SessionMutationResult<T>> {
	return runSessionMutationActionAtRoot(
		resolveMutableSessionRoot(context).root,
		action,
		runtime,
	);
}

export async function withPersistedTransition<T>(
	context: WorkspaceContext,
	runTransition: (session: Session) => TransitionResult<T>,
	options:
		| SessionMutationAction<T>
		| {
				actionName: SessionMutationActionName;
				getSession: (value: T) => Session;
				onSuccess: (saved: Session, value: T) => RuntimeToolResponse;
				missingResponse?: RuntimeToolResponse;
				onError?: (
					result: Extract<TransitionResult<T>, { ok: false }>,
				) => RuntimeToolResponse;
				syncArtifacts?: boolean;
		  },
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<string> {
	if ("name" in options && "run" in options) {
		return executeSessionMutation(
			context,
			{
				...options,
				run: runTransition,
			},
			runtime,
		);
	}

	return executeSessionMutation(
		context,
		{
			name: options.actionName,
			run: runTransition,
			getSession: options.getSession,
			onSuccess: options.onSuccess,
			...(options.missingResponse
				? { missingResponse: options.missingResponse }
				: {}),
			...(options.onError ? { onError: options.onError } : {}),
			...(options.syncArtifacts !== undefined
				? { syncArtifacts: options.syncArtifacts }
				: {}),
		},
		runtime,
	);
}

export { errorResponse, parseToolArgs };
