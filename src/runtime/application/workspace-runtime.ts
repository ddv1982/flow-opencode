import { homedir } from "node:os";
import { resolve } from "node:path";
import { errorResponse } from "../errors";
import {
	InvalidFlowWorkspaceRootError,
	inspectMutableWorkspaceRoot,
	normalizeWorkspaceRoot,
} from "../workspace-root";

export type WorkspaceContext = {
	worktree?: string;
	directory?: string;
};

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

const READABLE_ROOT_MISSING_REASON =
	"Flow could not resolve a readable workspace root from worktree, directory, or cwd.";

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
	if (!root) return null;
	return { root, source };
}

function contextCandidates(
	context: WorkspaceContext,
	includeCwdFallback: boolean,
): SessionRootCandidate[] {
	const candidates = [
		asSessionRootCandidate(context.worktree, "worktree"),
		asSessionRootCandidate(context.directory, "directory"),
		...(includeCwdFallback
			? [asSessionRootCandidate(process.cwd(), "cwd")]
			: []),
	];
	return candidates.filter(
		(candidate): candidate is SessionRootCandidate => candidate !== null,
	);
}

function candidateFromContext(
	context: WorkspaceContext,
	mode: SessionRootMode,
): SessionRootCandidate | null {
	return contextCandidates(context, mode === "read").at(0) ?? null;
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

function readableRootMissingError(): Error {
	return new Error(READABLE_ROOT_MISSING_REASON);
}

function workspaceSummaryFromRoot(
	root: string | null,
	source: SessionRootSource | null,
	overrides: Partial<WorkspaceContextSummary>,
): WorkspaceContextSummary {
	return {
		root,
		source,
		trusted: false,
		mutationAllowed: false,
		usedFallback: false,
		rejectionReason: null,
		...overrides,
	};
}

function resolveCandidate(
	context: WorkspaceContext,
	mode: SessionRootMode,
): ResolvedSessionRoot {
	const candidate = candidateFromContext(context, mode);
	if (!candidate) {
		throw mode === "mutate"
			? mutableRootMissingError()
			: readableRootMissingError();
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
			remediation:
				candidate.root === resolve(process.env.HOME ?? homedir())
					? "Choose a project/worktree subdirectory instead of using $HOME directly so Flow can manage .flow state there."
					: `Trust this exact path intentionally by setting FLOW_TRUSTED_WORKSPACE_ROOTS=${candidate.root} before running Flow.`,
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
		return workspaceSummaryFromRoot(null, null, {
			rejectionReason: READABLE_ROOT_MISSING_REASON,
		});
	}
	try {
		const mutable = resolveMutableSessionRoot(context);
		return workspaceSummaryFromRoot(mutable.root, mutable.source, {
			trusted: mutable.trusted,
			mutationAllowed: true,
			usedFallback: readRoot.usedFallback,
		});
	} catch (error) {
		if (error instanceof InvalidFlowWorkspaceRootError) {
			const source =
				error.details.source === "worktree" ||
				error.details.source === "directory" ||
				error.details.source === "cwd"
					? error.details.source
					: readRoot.source;
			return workspaceSummaryFromRoot(
				error.details.root ?? readRoot.root,
				source,
				{
					trusted: error.details.trusted,
					usedFallback: readRoot.usedFallback,
					rejectionReason: error.details.rejectionReason,
				},
			);
		}
		throw error;
	}
}

export function resolveSessionRoot(context: WorkspaceContext): string {
	return resolveReadableSessionRoot(context).root;
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
