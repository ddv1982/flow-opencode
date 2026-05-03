import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	getFeatureDocPathFromSessionDir,
	getFeaturesDocsDirFromSessionDir,
	getIndexDocPathFromSessionDir,
	getWorkflowProjectionDir,
} from "../runtime/paths";
import { renderFeatureDoc } from "../runtime/render-feature-sections";
import { renderIndexDoc } from "../runtime/render-index-sections";
import type { Session } from "../runtime/schema";
import { assertMutableWorkspaceRoot } from "../runtime/workspace-root";
import { writeFileAtomically } from "./atomic-file";
import { withPersistenceLock } from "./locks";

type RenderedProjectionDoc = {
	path: string;
	content: string;
};

const preparedProjectionFeaturesDirs = new Set<string>();

function createContentHash(input: string): string {
	let hash = 2166136261;

	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}

async function writeProjectionDocIfChanged(
	doc: RenderedProjectionDoc,
): Promise<boolean> {
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

	await writeFileAtomically(doc.path, doc.content);
	return true;
}

async function ensureProjectionDocDirs(projectionDir: string): Promise<void> {
	const featuresDir = getFeaturesDocsDirFromSessionDir(projectionDir);
	if (preparedProjectionFeaturesDirs.has(featuresDir)) {
		try {
			await stat(featuresDir);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				preparedProjectionFeaturesDirs.delete(featuresDir);
			} else {
				throw error;
			}
		}
	}

	await mkdir(featuresDir, { recursive: true });
	preparedProjectionFeaturesDirs.add(featuresDir);
}

async function pruneProjectionFeatureDocs(
	projectionDir: string,
	activeFeatureIds: Set<string>,
): Promise<void> {
	const featuresDir = getFeaturesDocsDirFromSessionDir(projectionDir);

	try {
		const entries = await readdir(featuresDir, { withFileTypes: true });
		await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.filter((entry) => !activeFeatureIds.has(entry.name.slice(0, -3)))
				.map((entry) =>
					rm(
						getFeatureDocPathFromSessionDir(
							projectionDir,
							entry.name.slice(0, -3),
						),
						{ force: true },
					),
				),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
}

export function getWorkflowProjectionIndexPath(
	worktree: string,
	sessionId: string,
): string {
	return getIndexDocPathFromSessionDir(
		getWorkflowProjectionDir(worktree, sessionId),
	);
}

export function getWorkflowProjectionFeaturePath(
	worktree: string,
	sessionId: string,
	featureId: string,
): string {
	return getFeatureDocPathFromSessionDir(
		getWorkflowProjectionDir(worktree, sessionId),
		featureId,
	);
}

export async function renderWorkflowProjectionAtDir(
	projectionDir: string,
	session: Session,
): Promise<void> {
	const features = session.plan?.features ?? [];
	await ensureProjectionDocDirs(projectionDir);
	await writeProjectionDocIfChanged({
		path: getIndexDocPathFromSessionDir(projectionDir),
		content: renderIndexDoc(session),
	});
	await Promise.all(
		features.map((feature) =>
			writeProjectionDocIfChanged({
				path: getFeatureDocPathFromSessionDir(projectionDir, feature.id),
				content: renderFeatureDoc(session, feature),
			}),
		),
	);
	await pruneProjectionFeatureDocs(
		projectionDir,
		new Set(features.map((feature) => feature.id)),
	);
}

export async function renderWorkflowProjection(
	worktree: string,
	session: Session,
): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	await withPersistenceLock(
		mutableWorktree,
		`projection-${session.id}`,
		async () => {
			const projectionDir = getWorkflowProjectionDir(
				mutableWorktree,
				session.id,
			);
			await mkdir(join(projectionDir, "docs"), { recursive: true });
			await renderWorkflowProjectionAtDir(projectionDir, session);
		},
	);
}
