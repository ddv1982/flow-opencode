import { parse, resolve } from "node:path";
import { errorResponse } from "../errors";
import type { Session } from "../schema";
import {
	loadSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../session";
import type { TransitionResult } from "../transitions";

export type WorkspaceContext = {
	worktree?: string;
	directory?: string;
};

export type RuntimeToolResponse = Record<string, unknown>;

type ParseSchema<T> = {
	parse: (input: unknown) => T;
};

export interface SessionRuntimePort {
	loadSession: (worktree: string) => Promise<Session | null>;
	saveSessionState: (worktree: string, session: Session) => Promise<Session>;
	syncSessionArtifacts: (worktree: string, session: Session) => Promise<void>;
}

export const DEFAULT_SESSION_RUNTIME_PORT: SessionRuntimePort = {
	loadSession,
	saveSessionState,
	syncSessionArtifacts,
};

export function toJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function asWritableRootCandidate(rawPath: string | undefined): string | null {
	const path = rawPath?.trim();
	if (!path) {
		return null;
	}

	const normalized = resolve(path);
	if (parse(normalized).root === normalized) {
		return null;
	}

	return normalized;
}

export function resolveSessionRoot(context: WorkspaceContext): string {
	const candidateWorktree = asWritableRootCandidate(context.worktree);
	const candidateDirectory = asWritableRootCandidate(context.directory);
	const candidateCwd = asWritableRootCandidate(process.cwd());

	if (candidateWorktree) {
		return candidateWorktree;
	}

	if (candidateDirectory) {
		return candidateDirectory;
	}

	if (candidateCwd) {
		return candidateCwd;
	}

	throw new Error(
		"Flow tool context is missing a writable workspace root (worktree or directory).",
	);
}

export function missingSessionResponse(
	summary = "No active Flow session exists.",
	nextCommand?: string,
): RuntimeToolResponse {
	return nextCommand
		? { status: "missing_session", summary, nextCommand }
		: { status: "missing_session", summary };
}

export function parseToolArgs<T>(
	schema: ParseSchema<T>,
	args: unknown,
	messagePrefix = "Tool argument validation failed",
): { ok: true; value: T } | { ok: false; response: string } {
	const normalizedArgs = args ?? {};

	try {
		return { ok: true, value: schema.parse(normalizedArgs) };
	} catch (error) {
		const issues = (
			error as { issues?: Array<{ path?: unknown[]; message?: string }> } | null
		)?.issues;
		const first = Array.isArray(issues) && issues.length > 0 ? issues[0] : null;
		const path =
			first?.path && first.path.length > 0
				? first.path.map(String).join(".")
				: "args";
		const detail = first?.message ? `${path}: ${first.message}` : null;
		const summary = detail
			? `${messagePrefix}: ${detail}`
			: `${messagePrefix}.`;

		return { ok: false, response: toJson(errorResponse(summary)) };
	}
}

export async function withSession(
	context: WorkspaceContext,
	execute: (session: Session) => Promise<string>,
	missingResponse: RuntimeToolResponse = missingSessionResponse(),
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<string> {
	const session = await runtime.loadSession(resolveSessionRoot(context));
	if (!session) {
		return toJson(missingResponse);
	}

	return execute(session);
}

export async function persistTransition<T>(
	context: WorkspaceContext,
	result: TransitionResult<T>,
	getSession: (value: T) => Session,
	onSuccess: (saved: Session, value: T) => RuntimeToolResponse,
	onError: (
		result: Extract<TransitionResult<T>, { ok: false }>,
	) => RuntimeToolResponse = (failure) => errorResponse(failure.message),
	options: { syncArtifacts?: boolean } = { syncArtifacts: true },
	runtime: SessionRuntimePort = DEFAULT_SESSION_RUNTIME_PORT,
): Promise<string> {
	const worktree = resolveSessionRoot(context);

	if (!result.ok) {
		if (result.session) {
			const saved = await runtime.saveSessionState(worktree, result.session);
			if (options.syncArtifacts) {
				await runtime.syncSessionArtifacts(worktree, saved);
			}
		}

		return toJson(onError(result));
	}

	const saved = await runtime.saveSessionState(
		worktree,
		getSession(result.value),
	);
	if (options.syncArtifacts) {
		await runtime.syncSessionArtifacts(worktree, saved);
	}
	return toJson(onSuccess(saved, result.value));
}

export async function withPersistedTransition<T>(
	context: WorkspaceContext,
	runTransition: (session: Session) => TransitionResult<T>,
	options: {
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
	const syncArtifacts = options.syncArtifacts ?? true;

	return withSession(
		context,
		async (session) =>
			persistTransition(
				context,
				runTransition(session),
				options.getSession,
				options.onSuccess,
				options.onError,
				{ syncArtifacts },
				runtime,
			),
		options.missingResponse ?? missingSessionResponse(),
		runtime,
	);
}

export { errorResponse };
