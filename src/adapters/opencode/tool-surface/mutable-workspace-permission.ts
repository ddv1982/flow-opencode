import { basename, join } from "node:path";
import { resolveMutableSessionRoot } from "../../../runtime/application";
import type { ToolContext } from "./schemas";

export type ResolvedMutableToolWorkspace = {
	root: string;
	source: string;
	requiresHiddenRootApproval: boolean;
};

export class MutableWorkspacePermissionError extends Error {
	readonly code = "MUTABLE_WORKSPACE_PERMISSION_REQUIRED";
	readonly root: string;
	readonly source: string;

	constructor(resolved: ResolvedMutableToolWorkspace) {
		super(
			`Refusing to mutate hidden workspace root ${resolved.root}: OpenCode edit approval is required but ToolContext.ask is unavailable.`,
		);
		this.name = "MutableWorkspacePermissionError";
		this.root = resolved.root;
		this.source = resolved.source;
	}
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as PromiseLike<unknown>).then === "function"
	);
}

function requiresHiddenRootApproval(root: string): boolean {
	const name = basename(root);
	return name.startsWith(".") && name !== ".flow";
}

function resolveMutableToolWorkspace(
	context: ToolContext,
): ResolvedMutableToolWorkspace {
	const resolved = resolveMutableSessionRoot(context);
	return {
		root: resolved.root,
		source: resolved.source,
		requiresHiddenRootApproval: requiresHiddenRootApproval(resolved.root),
	};
}

export async function ensureMutableWorkspacePermission(
	context: ToolContext,
	resolved = resolveMutableToolWorkspace(context),
): Promise<string> {
	if (!resolved.requiresHiddenRootApproval) {
		return resolved.root;
	}

	if (!context.ask) {
		throw new MutableWorkspacePermissionError(resolved);
	}

	const askResult = context.ask({
		permission: "edit",
		patterns: [join(resolved.root, ".flow", "**")],
		always: [join(resolved.root, ".flow", "**")],
		metadata: {
			workspaceRoot: resolved.root,
			workspaceSource: resolved.source,
			reason:
				"Flow is about to persist state inside a hidden workspace root outside its own .flow directory.",
		},
	});
	if (!isThenable(askResult)) {
		// Hosts older than OpenCode SDK 1.15.5 return a lazy Effect here; without
		// the effect runtime we cannot run it, so refuse the mutation instead of
		// silently skipping the approval prompt.
		throw new MutableWorkspacePermissionError(resolved);
	}
	await askResult;
	return resolved.root;
}
