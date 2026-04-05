import { parse } from "node:path";
import { loadSession, saveSessionState, syncSessionArtifacts } from "../runtime/session";
import { summarizeSession } from "../runtime/summary";
import type { Session } from "../runtime/schema";
import type { TransitionResult } from "../runtime/transitions";
import type { ToolContext, ToolResponse } from "./schemas";

export function parseFeatureIds(raw?: string[]): string[] {
  return (raw ?? []).map((value) => value.trim()).filter(Boolean);
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function asWritableRootCandidate(rawPath: string | undefined): string | null {
  const path = rawPath?.trim();
  if (!path) {
    return null;
  }

  if (parse(path).root === path) {
    return null;
  }

  return path;
}

export function resolveSessionRoot(context: ToolContext): string {
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

  throw new Error("Flow tool context is missing a writable workspace root (worktree or directory).");
}

export function summarizePersistedSession(session: Session) {
  return summarizeSession(session);
}

export function missingSessionResponse(summary = "No active Flow session exists.", nextCommand?: string): ToolResponse {
  return nextCommand ? { status: "missing_session", summary, nextCommand } : { status: "missing_session", summary };
}

export function errorResponse(summary: string, extra?: ToolResponse): ToolResponse {
  return {
    status: "error",
    summary,
    ...(extra ?? {}),
  };
}

export async function withSession(
  context: ToolContext,
  execute: (session: Session) => Promise<string>,
  missingResponse: ToolResponse = missingSessionResponse(),
): Promise<string> {
  const session = await loadSession(resolveSessionRoot(context));
  if (!session) {
    return toJson(missingResponse);
  }

  return execute(session);
}

export async function persistTransition<T>(
  context: ToolContext,
  result: TransitionResult<T>,
  getSession: (value: T) => Session,
  onSuccess: (saved: Session, value: T) => ToolResponse,
  onError: (result: Extract<TransitionResult<T>, { ok: false }>) => ToolResponse = (failure) =>
    errorResponse(failure.message),
  options: { syncArtifacts?: boolean } = { syncArtifacts: true },
): Promise<string> {
  if (!result.ok) {
    return toJson(onError(result));
  }

  const worktree = resolveSessionRoot(context);
  const saved = await saveSessionState(worktree, getSession(result.value));
  if (options.syncArtifacts) {
    await syncSessionArtifacts(worktree, saved);
  }
  return toJson(onSuccess(saved, result.value));
}

export async function withPersistedTransition<T>(
  context: ToolContext,
  runTransition: (session: Session) => TransitionResult<T>,
  options: {
    getSession: (value: T) => Session;
    onSuccess: (saved: Session, value: T) => ToolResponse;
    missingResponse?: ToolResponse;
    onError?: (result: Extract<TransitionResult<T>, { ok: false }>) => ToolResponse;
    syncArtifacts?: boolean;
  },
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
      ),
    options.missingResponse ?? missingSessionResponse(),
  );
}
