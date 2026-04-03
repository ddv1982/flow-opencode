import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { deleteSessionDocs, renderSessionDocs } from "./render";
import { getSessionPath } from "./paths";
import { SessionSchema, type PlanningContext, type Session } from "./schema";

function now(): string {
  return new Date().toISOString();
}

function normalizeSession(session: Session): Session {
  return SessionSchema.parse({
    ...session,
    timestamps: {
      ...session.timestamps,
      updatedAt: now(),
    },
  });
}

async function writeSessionFile(worktree: string, session: Session): Promise<void> {
  const sessionPath = getSessionPath(worktree);
  await mkdir(worktree + "/.flow", { recursive: true });
  await writeFile(sessionPath, JSON.stringify(session, null, 2) + "\n", "utf8");
}

async function removeSessionFile(worktree: string): Promise<void> {
  await rm(getSessionPath(worktree), { force: true });
}

export async function loadSession(worktree: string): Promise<Session | null> {
  const sessionPath = getSessionPath(worktree);

  try {
    const raw = await readFile(sessionPath, "utf8");
    return SessionSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function saveSessionState(worktree: string, session: Session): Promise<Session> {
  const normalized = normalizeSession(session);
  await writeSessionFile(worktree, normalized);
  return normalized;
}

export async function syncSessionArtifacts(worktree: string, session: Session): Promise<void> {
  await renderSessionDocs(worktree, session);
}

export async function saveSession(worktree: string, session: Session): Promise<Session> {
  const normalized = await saveSessionState(worktree, session);
  await syncSessionArtifacts(worktree, normalized);
  return normalized;
}

export async function deleteSessionState(worktree: string): Promise<void> {
  await removeSessionFile(worktree);
}

export async function deleteSessionArtifacts(worktree: string): Promise<void> {
  await deleteSessionDocs(worktree);
}

export async function deleteSession(worktree: string): Promise<void> {
  await deleteSessionState(worktree);
  await deleteSessionArtifacts(worktree);
}

export function createSession(goal: string, planning?: Partial<PlanningContext>): Session {
  const createdAt = now();

  return SessionSchema.parse({
    version: 1,
    id: randomUUID(),
    goal,
    status: "planning",
    approval: "pending",
    planning: {
      repoProfile: planning?.repoProfile ?? [],
      research: planning?.research ?? [],
      implementationApproach: planning?.implementationApproach,
    },
    plan: null,
    execution: {
      activeFeatureId: null,
      lastFeatureId: null,
      lastSummary: null,
      lastOutcomeKind: null,
      lastOutcome: null,
      lastNextStep: null,
      lastFeatureResult: null,
      lastReviewerDecision: null,
      lastValidationRun: [],
      history: [],
    },
    notes: [],
    artifacts: [],
    timestamps: {
      createdAt,
      updatedAt: createdAt,
      approvedAt: null,
      completedAt: null,
    },
  });
}
