import { join } from "node:path";

export function getFlowDir(worktree: string): string {
  return join(worktree, ".flow");
}

export function getActiveSessionPath(worktree: string): string {
  return join(getFlowDir(worktree), "active");
}

export function getArchiveDir(worktree: string): string {
  return join(getFlowDir(worktree), "archive");
}

export function getSessionsDir(worktree: string): string {
  return join(getFlowDir(worktree), "sessions");
}

export function getSessionDir(worktree: string, sessionId: string): string {
  return join(getSessionsDir(worktree), sessionId);
}

export function getSessionPath(worktree: string, sessionId: string): string {
  return join(getSessionDir(worktree, sessionId), "session.json");
}

export function getDocsDir(worktree: string, sessionId: string): string {
  return join(getSessionDir(worktree, sessionId), "docs");
}

export function getFeaturesDocsDir(worktree: string, sessionId: string): string {
  return join(getDocsDir(worktree, sessionId), "features");
}

export function getReviewsDir(worktree: string, sessionId: string): string {
  return join(getSessionDir(worktree, sessionId), "reviews");
}

export function getIndexDocPath(worktree: string, sessionId: string): string {
  return join(getDocsDir(worktree, sessionId), "index.md");
}

export function getFeatureDocPath(worktree: string, sessionId: string, featureId: string): string {
  return join(getFeaturesDocsDir(worktree, sessionId), `${featureId}.md`);
}

export function getLegacySessionPath(worktree: string): string {
  return join(getFlowDir(worktree), "session.json");
}

export function getLegacyDocsDir(worktree: string): string {
  return join(getFlowDir(worktree), "docs");
}
