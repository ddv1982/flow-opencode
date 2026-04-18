import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
	getDocsDir,
	getFeatureDocPath,
	getFeaturesDocsDir,
	getIndexDocPath,
} from "./paths";
import { renderFeatureDoc } from "./render-feature-sections";
import { renderIndexDoc } from "./render-index-sections";
import type { Session } from "./schema";
import {
	ensureSessionDirPrepared,
	ensureSessionDocsPrepared,
	ensureSessionFeaturesDocsPrepared,
} from "./session";

type RenderedDoc = {
	path: string;
	content: string;
};

function createContentHash(input: string): string {
	let hash = 2166136261;

	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}

async function writeDocIfChanged(doc: RenderedDoc): Promise<boolean> {
	const nextHash = createContentHash(doc.content);

	try {
		const previousContent = await readFile(doc.path, "utf8");
		if (createContentHash(previousContent) === nextHash) {
			return false;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	await writeFile(doc.path, doc.content, "utf8");
	return true;
}

async function pruneFeatureDocs(
	worktree: string,
	sessionId: string,
	activeFeatureIds: Set<string>,
): Promise<void> {
	const featuresDir = getFeaturesDocsDir(worktree, sessionId);

	try {
		const entries = await readdir(featuresDir, { withFileTypes: true });
		await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.filter((entry) => !activeFeatureIds.has(entry.name.slice(0, -3)))
				.map((entry) =>
					rm(getFeatureDocPath(worktree, sessionId, entry.name.slice(0, -3)), {
						force: true,
					}),
				),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
}

export async function renderSessionDocs(
	worktree: string,
	session: Session,
): Promise<void> {
	const sessionId = session.id;
	const renderSession = session;
	const features = renderSession.plan?.features ?? [];

	await ensureSessionDirPrepared(worktree, sessionId);
	await ensureSessionDocsPrepared(worktree, sessionId);
	await ensureSessionFeaturesDocsPrepared(worktree, sessionId);
	await writeDocIfChanged({
		path: getIndexDocPath(worktree, sessionId),
		content: renderIndexDoc(renderSession),
	});

	await Promise.all(
		features.map((feature) =>
			writeDocIfChanged({
				path: getFeatureDocPath(worktree, sessionId, feature.id),
				content: renderFeatureDoc(renderSession, feature),
			}),
		),
	);
	await pruneFeatureDocs(
		worktree,
		sessionId,
		new Set(features.map((feature) => feature.id)),
	);
}

export async function deleteSessionDocs(
	worktree: string,
	sessionId: string,
): Promise<void> {
	await rm(getDocsDir(worktree, sessionId), { recursive: true, force: true });
}
