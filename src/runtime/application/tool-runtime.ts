import { errorResponse } from "../errors";
import type { Session } from "../schema";
import {
	loadSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../session";
import type { TransitionResult } from "../transitions";
import {
	InvalidFlowWorkspaceRootError,
	inspectMutableWorkspaceRoot,
	normalizeWorkspaceRoot,
} from "../workspace-root";

export type WorkspaceContext = {
	worktree?: string;
	directory?: string;
};

export type RuntimeToolResponse = Record<string, unknown>;
export type SessionRootSource = "worktree" | "directory" | "cwd";
export type SessionRootMode = "read" | "mutate";
export type ResolvedSessionRoot = {
	root: string;
	source: SessionRootSource;
	mode: SessionRootMode;
	trusted: boolean;
	usedFallback: boolean;
};
export type WorkspaceContextSummary = {
	root: string | null;
	source: SessionRootSource | null;
	trusted: boolean;
	mutationAllowed: boolean;
	usedFallback: boolean;
	rejectionReason: string | null;
};

type ParseSchema<T> = {
	parse: (input: unknown) => T;
};

type SessionRootCandidate = {
	root: string;
	source: SessionRootSource;
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

export function toCompactJson(value: unknown): string {
	return JSON.stringify(value);
}

function asSessionRootCandidate(
	rawPath: string | undefined,
	source: SessionRootSource,
): SessionRootCandidate | null {
	const root = normalizeWorkspaceRoot(rawPath);
	if (!root) {
		return null;
	}

	return { root, source };
}

function candidateFromContext(
	context: WorkspaceContext,
	mode: SessionRootMode,
): SessionRootCandidate | null {
	const candidateWorktree = asSessionRootCandidate(
		context.worktree,
		"worktree",
	);
	const candidateDirectory = asSessionRootCandidate(
		context.directory,
		"directory",
	);
	if (candidateWorktree) {
		return candidateWorktree;
	}
	if (candidateDirectory) {
		return candidateDirectory;
	}
	if (mode === "mutate") {
		return null;
	}

	return asSessionRootCandidate(process.cwd(), "cwd");
}

function mutableRootMissingError(): InvalidFlowWorkspaceRootError {
	return new InvalidFlowWorkspaceRootError({
		summary:
			"Flow could not resolve a mutable workspace root from tool context. Provide a non-root worktree or directory.",
		remediation:
			"Run Flow from an actual project/worktree directory so it can manage .flow state there.",
		details: {
			root: null,
			source: null,
			trusted: false,
			mutationAllowed: false,
			usedFallback: false,
			rejectionReason:
				"Missing non-root worktree/directory context for a mutating Flow action.",
		},
	});
}

function resolveCandidate(
	context: WorkspaceContext,
	mode: SessionRootMode,
): ResolvedSessionRoot {
	const candidate = candidateFromContext(context, mode);
	if (!candidate) {
		if (mode === "mutate") {
			throw mutableRootMissingError();
		}
		throw new Error(
			"Flow tool context is missing a readable workspace root (worktree, directory, or cwd).",
		);
	}

	if (mode === "read") {
		return {
			root: candidate.root,
			source: candidate.source,
			mode,
			trusted: false,
			usedFallback: candidate.source === "cwd",
		};
	}

	const rootCheck = inspectMutableWorkspaceRoot(candidate.root);
	if (rootCheck.rejectionReason) {
		throw new InvalidFlowWorkspaceRootError({
			summary: `Flow blocked mutable workspace root '${candidate.root}' from ${candidate.source}: ${rootCheck.rejectionReason}`,
			remediation: `Trust this exact path intentionally by setting FLOW_TRUSTED_WORKSPACE_ROOTS=${candidate.root} before running Flow.`,
			details: {
				root: candidate.root,
				source: candidate.source,
				trusted: rootCheck.trusted,
				mutationAllowed: false,
				usedFallback: false,
				rejectionReason: rootCheck.rejectionReason,
			},
		});
	}

	return {
		root: candidate.root,
		source: candidate.source,
		mode,
		trusted: rootCheck.trusted,
		usedFallback: false,
	};
}

export function resolveReadableSessionRoot(
	context: WorkspaceContext,
): ResolvedSessionRoot {
	return resolveCandidate(context, "read");
}

export function resolveMutableSessionRoot(
	context: WorkspaceContext,
): ResolvedSessionRoot {
	return resolveCandidate(context, "mutate");
}

export function inspectWorkspaceContext(
	context: WorkspaceContext,
): WorkspaceContextSummary {
	let readRoot: ResolvedSessionRoot | null = null;
	try {
		readRoot = resolveReadableSessionRoot(context);
	} catch {
		return {
			root: null,
			source: null,
			trusted: false,
			mutationAllowed: false,
			usedFallback: false,
			rejectionReason:
				"Flow could not resolve a readable workspace root from worktree, directory, or cwd.",
		};
	}

	try {
		const mutable = resolveMutableSessionRoot(context);
		return {
			root: mutable.root,
			source: mutable.source,
			trusted: mutable.trusted,
			mutationAllowed: true,
			usedFallback: readRoot.usedFallback,
			rejectionReason: null,
		};
	} catch (error) {
		if (error instanceof InvalidFlowWorkspaceRootError) {
			const source =
				error.details.source === "worktree" ||
				error.details.source === "directory" ||
				error.details.source === "cwd"
					? error.details.source
					: readRoot.source;
			return {
				root: error.details.root ?? readRoot.root,
				source,
				trusted: error.details.trusted,
				mutationAllowed: false,
				usedFallback: readRoot.usedFallback,
				rejectionReason: error.details.rejectionReason,
			};
		}
		throw error;
	}
}

export function resolveSessionRoot(context: WorkspaceContext): string {
	return resolveReadableSessionRoot(context).root;
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
	const session = await runtime.loadSession(
		resolveReadableSessionRoot(context).root,
	);
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
	const worktree = resolveMutableSessionRoot(context).root;

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
