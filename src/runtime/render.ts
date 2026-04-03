import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { getDocsDir, getFeatureDocPath, getFeaturesDocsDir, getIndexDocPath } from "./paths";
import type { Session } from "./schema";
import { renderFeatureDoc, renderIndexDoc } from "./render-sections";

async function pruneFeatureDocs(worktree: string, activeFeatureIds: Set<string>): Promise<void> {
  const featuresDir = getFeaturesDocsDir(worktree);

  try {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .filter((entry) => !activeFeatureIds.has(entry.name.slice(0, -3)))
        .map((entry) => rm(getFeatureDocPath(worktree, entry.name.slice(0, -3)), { force: true })),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function renderSessionDocs(worktree: string, session: Session): Promise<void> {
  const docsDir = getDocsDir(worktree);
  const featuresDir = getFeaturesDocsDir(worktree);
  const features = session.plan?.features ?? [];

  await mkdir(docsDir, { recursive: true });
  await mkdir(featuresDir, { recursive: true });
  await writeFile(getIndexDocPath(worktree), renderIndexDoc(session), "utf8");

  await Promise.all(features.map((feature) => writeFile(getFeatureDocPath(worktree, feature.id), renderFeatureDoc(session, feature), "utf8")));
  await pruneFeatureDocs(worktree, new Set(features.map((feature) => feature.id)));
}

export async function deleteSessionDocs(worktree: string): Promise<void> {
  await rm(getDocsDir(worktree), { recursive: true, force: true });
}
