import { basename, join } from "node:path";
import { runPromise } from "effect/Effect";
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

function requiresHiddenRootApproval(root: string): boolean {
	const name = basename(root);
	return name.startsWith(".") && name !== ".flow";
}

export function resolveMutableToolWorkspace(
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

	const askEffect = context.ask({
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
	await runPromise(askEffect);
	return resolved.root;
}
