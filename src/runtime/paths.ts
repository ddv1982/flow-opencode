import { join } from "node:path";

export function getFlowDir(worktree: string): string {
  return join(worktree, ".flow");
}

export function getSessionPath(worktree: string): string {
  return join(getFlowDir(worktree), "session.json");
}

export function getDocsDir(worktree: string): string {
  return join(getFlowDir(worktree), "docs");
}

export function getFeaturesDocsDir(worktree: string): string {
  return join(getDocsDir(worktree), "features");
}

export function getIndexDocPath(worktree: string): string {
  return join(getDocsDir(worktree), "index.md");
}

export function getFeatureDocPath(worktree: string, featureId: string): string {
  return join(getFeaturesDocsDir(worktree), `${featureId}.md`);
}
