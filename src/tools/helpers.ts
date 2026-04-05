import { parse } from "node:path";
import { loadSession, saveSession } from "../runtime/session";
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

export function resolveSessionRoot(context: ToolContext): string {
  const worktree = context.worktree?.trim();
  const directory = context.directory?.trim();

  if (worktree && worktree !== parse(worktree).root) {
    return worktree;
  }

  if (directory) {
    return directory;
  }

  if (worktree) {
    return worktree;
  }

  throw new Error("Flow tool context is missing both worktree and directory.");
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
): Promise<string> {
  if (!result.ok) {
    return toJson(onError(result));
  }

  const saved = await saveSession(resolveSessionRoot(context), getSession(result.value));
  return toJson(onSuccess(saved, result.value));
}
