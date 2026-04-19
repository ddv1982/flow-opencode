import { join, relative } from "node:path";

export class InvalidFlowPathInputError extends Error {
	readonly code = "INVALID_FLOW_PATH_INPUT";

	constructor(kind: "session" | "feature", value: string) {
		super(`Invalid ${kind} id '${value}'.`);
		this.name = "InvalidFlowPathInputError";
	}
}

function sanitizePathComponent(
	kind: "session" | "feature",
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
	const sessionsDir = getSessionsDir(worktree);
	return assertDescendant(
		sessionsDir,
		join(sessionsDir, sanitizePathComponent("session", sessionId)),
	);
}

export function getSessionPath(worktree: string, sessionId: string): string {
	return join(getSessionDir(worktree, sessionId), "session.json");
}

export function getDocsDir(worktree: string, sessionId: string): string {
	return join(getSessionDir(worktree, sessionId), "docs");
}

export function getFeaturesDocsDir(
	worktree: string,
	sessionId: string,
): string {
	return join(getDocsDir(worktree, sessionId), "features");
}

export function getReviewsDir(worktree: string, sessionId: string): string {
	return join(getSessionDir(worktree, sessionId), "reviews");
}

export function getIndexDocPath(worktree: string, sessionId: string): string {
	return join(getDocsDir(worktree, sessionId), "index.md");
}

export function getFeatureDocPath(
	worktree: string,
	sessionId: string,
	featureId: string,
): string {
	const featuresDir = getFeaturesDocsDir(worktree, sessionId);
	return assertDescendant(
		featuresDir,
		join(featuresDir, `${sanitizePathComponent("feature", featureId)}.md`),
	);
}
