import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { deleteSessionDocs, renderSessionDocs } from "./render";
import {
  getActiveSessionPath,
  getArchiveDir,
  getFlowDir,
  getLegacyDocsDir,
  getLegacySessionPath,
  getReviewsDir,
  getSessionDir,
  getSessionPath,
  getSessionsDir,
} from "./paths";
import { SessionSchema, type PlanningContext, type Session } from "./schema";

const FLOW_GITIGNORE_ENTRIES = ["active", "sessions/", "archive/"] as const;

export type SessionHistoryEntry = {
  id: string;
  goal: string | null;
  status: string;
  approval: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  active: boolean;
  path: string;
  error?: string;
};

export type ArchivedSessionHistoryEntry = SessionHistoryEntry & {
  archivePath: string;
  archivedAt: string | null;
};

export type StoredSessionLookup = {
  session: Session;
  source: "sessions" | "archive";
  active: boolean;
  path: string;
  archivePath?: string;
  archivedAt?: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function archiveTimestamp(): string {
  return now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "");
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

function compareIsoDescending(left: string | null, right: string | null): number {
  return (right ?? "").localeCompare(left ?? "");
}

function toHistoryEntry(worktree: string, session: Session, activeSessionId: string | null): SessionHistoryEntry {
  return {
    id: session.id,
    goal: session.goal,
    status: session.status,
    approval: session.approval,
    createdAt: session.timestamps.createdAt,
    updatedAt: session.timestamps.updatedAt,
    completedAt: session.timestamps.completedAt,
    active: session.id === activeSessionId,
    path: relative(worktree, getSessionDir(worktree, session.id)),
  };
}

function toInvalidHistoryEntry(worktree: string, id: string, path: string, error: unknown, activeSessionId: string | null): SessionHistoryEntry {
  return {
    id,
    goal: null,
    status: "invalid",
    approval: null,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    active: id === activeSessionId,
    path: relative(worktree, path),
    error: error instanceof Error ? error.message : String(error),
  };
}

async function readSessionFromPath(sessionPath: string): Promise<Session> {
  const raw = await readFile(sessionPath, "utf8");
  return SessionSchema.parse(JSON.parse(raw));
}

function parseArchiveDirectoryName(directoryName: string): { sessionId: string; archivedAt: string | null } {
  const match = directoryName.match(/^(.*)-(\d{8}T?\d{6}|\d{14})$/);
  if (!match) {
    return { sessionId: directoryName, archivedAt: null };
  }

  return {
    sessionId: match[1] ?? directoryName,
    archivedAt: match[2] ?? null,
  };
}

async function findArchivedSessionDirectory(worktree: string, sessionId: string): Promise<{ archiveDir: string; archivedAt: string | null } | null> {
  const archiveRoot = getArchiveDir(worktree);
  const matches: Array<{ archiveDir: string; archivedAt: string | null }> = [];

  for (const entry of await readdir(archiveRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const parsed = parseArchiveDirectoryName(entry.name);
    if (parsed.sessionId !== sessionId) continue;
    matches.push({ archiveDir: join(archiveRoot, entry.name), archivedAt: parsed.archivedAt });
  }

  matches.sort((left, right) => compareIsoDescending(left.archivedAt, right.archivedAt));
  return matches[0] ?? null;
}

async function ensureWorkspace(worktree: string): Promise<void> {
  const flowDir = getFlowDir(worktree);
  await mkdir(getSessionsDir(worktree), { recursive: true });
  await mkdir(getArchiveDir(worktree), { recursive: true });

  const gitignorePath = join(flowDir, ".gitignore");
  let existingEntries: string[] = [];

  try {
    existingEntries = (await readFile(gitignorePath, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const nextEntries = [...existingEntries];
  for (const entry of FLOW_GITIGNORE_ENTRIES) {
    if (!nextEntries.includes(entry)) {
      nextEntries.push(entry);
    }
  }

  await writeFile(gitignorePath, nextEntries.map((entry) => `${entry}\n`).join(""), "utf8");
}

export async function readActiveSessionId(worktree: string): Promise<string | null> {
  try {
    const raw = await readFile(getActiveSessionPath(worktree), "utf8");
    const value = raw.trim();
    return value || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeActiveSessionId(worktree: string, sessionId: string | null): Promise<void> {
  await ensureWorkspace(worktree);

  if (!sessionId) {
    await rm(getActiveSessionPath(worktree), { force: true });
    return;
  }

  await writeFile(getActiveSessionPath(worktree), `${sessionId}\n`, "utf8");
}

async function writeSessionFile(worktree: string, session: Session): Promise<void> {
  await ensureWorkspace(worktree);
  await mkdir(getSessionDir(worktree, session.id), { recursive: true });
  await writeFile(getSessionPath(worktree, session.id), JSON.stringify(session, null, 2) + "\n", "utf8");
}

async function migrateLegacySessionIfNeeded(worktree: string): Promise<void> {
  await ensureWorkspace(worktree);

  if (await readActiveSessionId(worktree)) {
    return;
  }

  const legacySessionPath = getLegacySessionPath(worktree);

  try {
    const raw = await readFile(legacySessionPath, "utf8");
    const session = SessionSchema.parse(JSON.parse(raw));

    await writeSessionFile(worktree, session);
    await renderSessionDocs(worktree, session);
    await writeActiveSessionId(worktree, session.id);
    await rm(legacySessionPath, { force: true });
    await rm(getLegacyDocsDir(worktree), { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }
}

async function resolveActiveSessionId(worktree: string): Promise<string | null> {
  await migrateLegacySessionIfNeeded(worktree);
  return readActiveSessionId(worktree);
}

export async function loadSession(worktree: string): Promise<Session | null> {
  const sessionId = await resolveActiveSessionId(worktree);
  if (!sessionId) {
    return null;
  }

  try {
    return await readSessionFromPath(getSessionPath(worktree, sessionId));
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
  await writeActiveSessionId(worktree, normalized.id);
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
  const sessionId = await resolveActiveSessionId(worktree);
  if (!sessionId) {
    return;
  }

  await rm(getSessionPath(worktree, sessionId), { force: true });
}

export async function deleteSessionArtifacts(worktree: string): Promise<void> {
  const sessionId = await resolveActiveSessionId(worktree);
  if (!sessionId) {
    return;
  }

  await deleteSessionDocs(worktree, sessionId);
  await rm(getReviewsDir(worktree, sessionId), { recursive: true, force: true });
}

export async function deleteSession(worktree: string): Promise<void> {
  const sessionId = await resolveActiveSessionId(worktree);
  if (!sessionId) {
    return;
  }

  await rm(getSessionDir(worktree, sessionId), { recursive: true, force: true });
  await writeActiveSessionId(worktree, null);
}

export async function archiveSession(worktree: string): Promise<{ sessionId: string; archivedTo: string } | null> {
  const sessionId = await resolveActiveSessionId(worktree);
  if (!sessionId) {
    return null;
  }

  const sourceDir = getSessionDir(worktree, sessionId);
  const archivedDir = join(getArchiveDir(worktree), `${sessionId}-${archiveTimestamp()}`);

  try {
    await rename(sourceDir, archivedDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeActiveSessionId(worktree, null);
      return null;
    }

    throw error;
  }

  await writeActiveSessionId(worktree, null);
  return {
    sessionId,
    archivedTo: relative(worktree, archivedDir),
  };
}

export async function activateSession(worktree: string, sessionId: string): Promise<Session | null> {
  await migrateLegacySessionIfNeeded(worktree);

  try {
    const session = await readSessionFromPath(getSessionPath(worktree, sessionId));
    await writeActiveSessionId(worktree, sessionId);
    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function loadStoredSession(worktree: string, sessionId: string): Promise<StoredSessionLookup | null> {
  await migrateLegacySessionIfNeeded(worktree);
  await ensureWorkspace(worktree);

  const activeSessionId = await readActiveSessionId(worktree);

  try {
    const session = await readSessionFromPath(getSessionPath(worktree, sessionId));
    return {
      session,
      source: "sessions",
      active: sessionId === activeSessionId,
      path: relative(worktree, getSessionDir(worktree, sessionId)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const archived = await findArchivedSessionDirectory(worktree, sessionId);
  if (!archived) {
    return null;
  }

  const session = await readSessionFromPath(join(archived.archiveDir, "session.json"));
  return {
    session,
    source: "archive",
    active: false,
    path: relative(worktree, archived.archiveDir),
    archivePath: relative(worktree, archived.archiveDir),
    archivedAt: archived.archivedAt,
  };
}

export async function listSessionHistory(
  worktree: string,
): Promise<{ activeSessionId: string | null; sessions: SessionHistoryEntry[]; archived: ArchivedSessionHistoryEntry[] }> {
  await migrateLegacySessionIfNeeded(worktree);
  await ensureWorkspace(worktree);

  const activeSessionId = await readActiveSessionId(worktree);
  const sessionsRoot = getSessionsDir(worktree);
  const archiveRoot = getArchiveDir(worktree);

  const sessions: SessionHistoryEntry[] = [];
  for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sessionId = entry.name;
    const sessionPath = getSessionPath(worktree, sessionId);
    try {
      const session = await readSessionFromPath(sessionPath);
      sessions.push(toHistoryEntry(worktree, session, activeSessionId));
    } catch (error) {
      sessions.push(toInvalidHistoryEntry(worktree, sessionId, getSessionDir(worktree, sessionId), error, activeSessionId));
    }
  }
  sessions.sort((left, right) => compareIsoDescending(left.updatedAt, right.updatedAt));

  const archived: ArchivedSessionHistoryEntry[] = [];
  for (const entry of await readdir(archiveRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const archiveDir = join(archiveRoot, entry.name);
    const { sessionId, archivedAt } = parseArchiveDirectoryName(entry.name);
    try {
      const session = await readSessionFromPath(join(archiveDir, "session.json"));
      archived.push({
        ...toHistoryEntry(worktree, session, null),
        path: relative(worktree, archiveDir),
        archivePath: relative(worktree, archiveDir),
        archivedAt,
        active: false,
      });
    } catch (error) {
      archived.push({
        ...toInvalidHistoryEntry(worktree, sessionId, archiveDir, error, null),
        archivePath: relative(worktree, archiveDir),
        archivedAt,
        active: false,
      });
    }
  }
  archived.sort((left, right) => compareIsoDescending(left.archivedAt ?? left.updatedAt, right.archivedAt ?? right.updatedAt));

  return { activeSessionId, sessions, archived };
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
