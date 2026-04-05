import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderSessionDocs } from "./render";
import {
  getActiveSessionPath,
  getArchiveDir,
  getFlowDir,
  getLegacyDocsDir,
  getLegacySessionPath,
  getSessionDir,
  getSessionPath,
  getSessionsDir,
} from "./paths";
import { SessionSchema, type Session } from "./schema";

const FLOW_GITIGNORE_ENTRIES = ["active", "sessions/", "archive/"] as const;

export function now(): string {
  return new Date().toISOString();
}

export function archiveTimestamp(): string {
  return now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "");
}

export async function readSessionFromPath(sessionPath: string): Promise<Session> {
  const raw = await readFile(sessionPath, "utf8");
  return SessionSchema.parse(JSON.parse(raw));
}

export async function ensureWorkspace(worktree: string): Promise<void> {
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

export async function writeActiveSessionId(worktree: string, sessionId: string | null): Promise<void> {
  await ensureWorkspace(worktree);

  if (!sessionId) {
    await rm(getActiveSessionPath(worktree), { force: true });
    return;
  }

  await writeFile(getActiveSessionPath(worktree), `${sessionId}\n`, "utf8");
}

export async function writeSessionFile(worktree: string, session: Session): Promise<void> {
  await ensureWorkspace(worktree);
  await mkdir(getSessionDir(worktree, session.id), { recursive: true });
  await writeFile(getSessionPath(worktree, session.id), JSON.stringify(session, null, 2) + "\n", "utf8");
}

export async function migrateLegacySessionIfNeeded(worktree: string): Promise<void> {
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

export async function resolveActiveSessionId(worktree: string): Promise<string | null> {
  await migrateLegacySessionIfNeeded(worktree);
  return readActiveSessionId(worktree);
}
