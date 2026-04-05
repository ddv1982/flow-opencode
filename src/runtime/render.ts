import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { getDocsDir, getFeatureDocPath, getFeaturesDocsDir, getIndexDocPath } from "./paths";
import { renderFeatureDoc } from "./render-feature-sections";
import { renderIndexDoc } from "./render-index-sections";
import type { Session } from "./schema";

async function pruneFeatureDocs(worktree: string, sessionId: string, activeFeatureIds: Set<string>): Promise<void> {
  const featuresDir = getFeaturesDocsDir(worktree, sessionId);

  try {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .filter((entry) => !activeFeatureIds.has(entry.name.slice(0, -3)))
        .map((entry) => rm(getFeatureDocPath(worktree, sessionId, entry.name.slice(0, -3)), { force: true })),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function renderSessionDocs(worktree: string, session: Session): Promise<void> {
  const sessionId = session.id;
  const docsDir = getDocsDir(worktree, sessionId);
  const featuresDir = getFeaturesDocsDir(worktree, sessionId);
  const features = session.plan?.features ?? [];

  await mkdir(docsDir, { recursive: true });
  await mkdir(featuresDir, { recursive: true });
  await writeFile(getIndexDocPath(worktree, sessionId), renderIndexDoc(session), "utf8");

  await Promise.all(features.map((feature) => writeFile(getFeatureDocPath(worktree, sessionId, feature.id), renderFeatureDoc(session, feature), "utf8")));
  await pruneFeatureDocs(worktree, sessionId, new Set(features.map((feature) => feature.id)));
}

export async function deleteSessionDocs(worktree: string, sessionId: string): Promise<void> {
  await rm(getDocsDir(worktree, sessionId), { recursive: true, force: true });
}
