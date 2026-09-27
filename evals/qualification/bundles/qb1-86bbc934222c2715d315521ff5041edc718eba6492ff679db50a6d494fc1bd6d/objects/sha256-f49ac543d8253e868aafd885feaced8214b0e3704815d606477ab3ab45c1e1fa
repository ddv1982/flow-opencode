import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import { MAX_SESSION_ID_LENGTH } from "../../domain/limits.js";

class InvalidFlowWorkspaceRootError extends Error {
	readonly code = "INVALID_FLOW_WORKSPACE_ROOT";
}

function normalizeWorkspaceRoot(rawPath: string | undefined): string | null {
	const value = rawPath?.trim();
	if (!value) return null;
	const normalized = resolve(value);
	return parse(normalized).root === normalized ? null : normalized;
}

export function assertMutableWorkspaceRoot(rawPath: string): string {
	const candidate = normalizeWorkspaceRoot(rawPath);
	if (!candidate) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow requires a non-root workspace path.",
		);
	}
	let root: string;
	try {
		root = realpathSync(candidate);
	} catch (error) {
		throw new InvalidFlowWorkspaceRootError(
			`Flow requires an existing workspace directory: ${candidate}.`,
			{ cause: error },
		);
	}
	if (parse(root).root === root || !lstatSync(root).isDirectory()) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow requires an existing non-root workspace directory.",
		);
	}
	const homes = [process.env.HOME, homedir()]
		.filter((value): value is string => Boolean(value?.trim()))
		.map((value) => {
			try {
				return realpathSync(resolve(value));
			} catch {
				return resolve(value);
			}
		});
	if (homes.includes(root)) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow refuses to use the home directory itself as mutable state.",
		);
	}
	return root;
}

export function resolveWorkspaceRoot(context: {
	worktree?: string | undefined;
	directory?: string | undefined;
}): string {
	const candidate =
		normalizeWorkspaceRoot(context.worktree) ??
		normalizeWorkspaceRoot(context.directory);
	if (!candidate) {
		throw new InvalidFlowWorkspaceRootError(
			"Flow could not resolve a workspace root from tool context.",
		);
	}
	return assertMutableWorkspaceRoot(candidate);
}

export function flowDir(workspace: string): string {
	return join(workspace, ".flow");
}

export function sessionPath(workspace: string): string {
	return join(flowDir(workspace), "session.json");
}

export function historyDir(workspace: string): string {
	return join(flowDir(workspace), "history");
}

function archivedSessionFilename(sessionId: string): string {
	if (sessionId.length < 1 || sessionId.length > MAX_SESSION_ID_LENGTH) {
		throw new Error("Invalid session id.");
	}
	return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

export function archivedSessionPath(
	workspace: string,
	sessionId: string,
): string {
	return join(historyDir(workspace), archivedSessionFilename(sessionId));
}
