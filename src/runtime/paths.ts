import { join, relative } from "node:path";

export class InvalidFlowPathInputError extends Error {
	readonly code = "INVALID_FLOW_PATH_INPUT";

	constructor(kind: "session" | "feature" | "completed", value: string) {
		super(`Invalid ${kind} id '${value}'.`);
		this.name = "InvalidFlowPathInputError";
	}
}

export type LiveSessionLocation = "active" | "stored";

function sanitizePathComponent(
	kind: "session" | "feature" | "completed",
	value: string,
): string {
	if (
		value.length === 0 ||
		value === "." ||
		value === ".." ||
		value.includes("..") ||
		value.startsWith("/") ||
		value.includes("/") ||
		value.includes("\\") ||
		value.split(/[/\\]+/).includes("..")
	) {
		throw new InvalidFlowPathInputError(kind, value);
	}

	return value;
}

function assertDescendant(base: string, target: string): string {
	const rel = relative(base, target);
	if (
		rel === ".." ||
		rel.startsWith(`..${"/"}`) ||
		rel.startsWith(`..${"\\"}`)
	) {
		throw new InvalidFlowPathInputError("session", target);
	}

	return target;
}

export function getFlowDir(worktree: string): string {
	return join(worktree, ".flow");
}

export function getActiveSessionsDir(worktree: string): string {
	return join(getFlowDir(worktree), "active");
}

export function getStoredSessionsDir(worktree: string): string {
	return join(getFlowDir(worktree), "stored");
}

export function getCompletedSessionsDir(worktree: string): string {
	return join(getFlowDir(worktree), "completed");
}

function getLiveSessionsDir(
	worktree: string,
	location: LiveSessionLocation,
): string {
	return location === "active"
		? getActiveSessionsDir(worktree)
		: getStoredSessionsDir(worktree);
}

export function getSessionDir(
	worktree: string,
	sessionId: string,
	location: LiveSessionLocation = "active",
): string {
	const root = getLiveSessionsDir(worktree, location);
	return assertDescendant(
		root,
		join(root, sanitizePathComponent("session", sessionId)),
	);
}

export function getActiveSessionDir(
	worktree: string,
	sessionId: string,
): string {
	return getSessionDir(worktree, sessionId, "active");
}

export function getStoredSessionDir(
	worktree: string,
	sessionId: string,
): string {
	return getSessionDir(worktree, sessionId, "stored");
}

export function getCompletedSessionDir(
	worktree: string,
	completedDirName: string,
): string {
	const completedRoot = getCompletedSessionsDir(worktree);
	return assertDescendant(
		completedRoot,
		join(completedRoot, sanitizePathComponent("completed", completedDirName)),
	);
}

export function getSessionPath(
	worktree: string,
	sessionId: string,
	location: LiveSessionLocation = "active",
): string {
	return getSessionPathFromDir(getSessionDir(worktree, sessionId, location));
}

export function getActiveSessionPath(
	worktree: string,
	sessionId: string,
): string {
	return getSessionPath(worktree, sessionId, "active");
}

export function getStoredSessionPath(
	worktree: string,
	sessionId: string,
): string {
	return getSessionPath(worktree, sessionId, "stored");
}

export function getCompletedSessionPath(
	worktree: string,
	completedDirName: string,
): string {
	return getSessionPathFromDir(
		getCompletedSessionDir(worktree, completedDirName),
	);
}

export function getSessionPathFromDir(sessionDir: string): string {
	return join(sessionDir, "session.json");
}

export function getDocsDir(
	worktree: string,
	sessionId: string,
	location: LiveSessionLocation = "active",
): string {
	return getDocsDirFromSessionDir(getSessionDir(worktree, sessionId, location));
}

export function getCompletedDocsDir(
	worktree: string,
	completedDirName: string,
): string {
	return getDocsDirFromSessionDir(
		getCompletedSessionDir(worktree, completedDirName),
	);
}

export function getDocsDirFromSessionDir(sessionDir: string): string {
	return join(sessionDir, "docs");
}

export function getFeaturesDocsDir(
	worktree: string,
	sessionId: string,
	location: LiveSessionLocation = "active",
): string {
	return getFeaturesDocsDirFromSessionDir(
		getSessionDir(worktree, sessionId, location),
	);
}

export function getFeaturesDocsDirFromSessionDir(sessionDir: string): string {
	return join(getDocsDirFromSessionDir(sessionDir), "features");
}

export function getReviewsDir(
	worktree: string,
	sessionId: string,
	location: LiveSessionLocation = "active",
): string {
	return getReviewsDirFromSessionDir(
		getSessionDir(worktree, sessionId, location),
	);
}

export function getReviewsDirFromSessionDir(sessionDir: string): string {
	return join(sessionDir, "reviews");
}

export function getIndexDocPath(
	worktree: string,
	sessionId: string,
	location: LiveSessionLocation = "active",
): string {
	return getIndexDocPathFromSessionDir(
		getSessionDir(worktree, sessionId, location),
	);
}

export function getIndexDocPathFromSessionDir(sessionDir: string): string {
	return join(getDocsDirFromSessionDir(sessionDir), "index.md");
}

export function getFeatureDocPath(
	worktree: string,
	sessionId: string,
	featureId: string,
	location: LiveSessionLocation = "active",
): string {
	return getFeatureDocPathFromSessionDir(
		getSessionDir(worktree, sessionId, location),
		featureId,
	);
}

export function getFeatureDocPathFromSessionDir(
	sessionDir: string,
	featureId: string,
): string {
	const featuresDir = getFeaturesDocsDirFromSessionDir(sessionDir);
	return assertDescendant(
		featuresDir,
		join(featuresDir, `${sanitizePathComponent("feature", featureId)}.md`),
	);
}
