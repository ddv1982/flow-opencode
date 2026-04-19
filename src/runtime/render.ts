import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import {
	getDocsDir,
	getDocsDirFromSessionDir,
	getFeatureDocPathFromSessionDir,
	getFeaturesDocsDirFromSessionDir,
	getIndexDocPathFromSessionDir,
	getSessionDir,
	type LiveSessionLocation,
} from "./paths";
import { renderFeatureDoc } from "./render-feature-sections";
import { renderIndexDoc } from "./render-index-sections";
import type { Session } from "./schema";

type RenderedDoc = {
	path: string;
	content: string;
};
const preparedFeaturesDocsDirs = new Set<string>();

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

async function ensureSessionDocDirs(sessionDir: string): Promise<void> {
	const featuresDir = getFeaturesDocsDirFromSessionDir(sessionDir);
	if (preparedFeaturesDocsDirs.has(featuresDir)) {
		try {
			await stat(featuresDir);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				preparedFeaturesDocsDirs.delete(featuresDir);
			} else {
				throw error;
			}
		}
	}

	await mkdir(featuresDir, { recursive: true });
	preparedFeaturesDocsDirs.add(featuresDir);
}

async function pruneFeatureDocs(
	sessionDir: string,
	activeFeatureIds: Set<string>,
): Promise<void> {
	const featuresDir = getFeaturesDocsDirFromSessionDir(sessionDir);

	try {
		const entries = await readdir(featuresDir, { withFileTypes: true });
		await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.filter((entry) => !activeFeatureIds.has(entry.name.slice(0, -3)))
				.map((entry) =>
					rm(
						getFeatureDocPathFromSessionDir(
							sessionDir,
							entry.name.slice(0, -3),
						),
						{
							force: true,
						},
					),
				),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
}

export async function renderSessionDocsAtDir(
	sessionDir: string,
	session: Session,
): Promise<void> {
	const features = session.plan?.features ?? [];

	await ensureSessionDocDirs(sessionDir);
	await writeDocIfChanged({
		path: getIndexDocPathFromSessionDir(sessionDir),
		content: renderIndexDoc(session),
	});

	await Promise.all(
		features.map((feature) =>
			writeDocIfChanged({
				path: getFeatureDocPathFromSessionDir(sessionDir, feature.id),
				content: renderFeatureDoc(session, feature),
			}),
		),
	);
	await pruneFeatureDocs(
		sessionDir,
		new Set(features.map((feature) => feature.id)),
	);
}

export async function renderSessionDocs(
	worktree: string,
	session: Session,
	location: LiveSessionLocation = "active",
): Promise<void> {
	await renderSessionDocsAtDir(
		getSessionDir(worktree, session.id, location),
		session,
	);
}

export async function deleteSessionDocsAtDir(
	sessionDir: string,
): Promise<void> {
	preparedFeaturesDocsDirs.delete(getFeaturesDocsDirFromSessionDir(sessionDir));
	await rm(getDocsDirFromSessionDir(sessionDir), {
		recursive: true,
		force: true,
	});
}

export async function deleteSessionDocs(
	worktree: string,
	sessionId: string,
	location: LiveSessionLocation = "active",
): Promise<void> {
	await rm(getDocsDir(worktree, sessionId, location), {
		recursive: true,
		force: true,
	});
}
