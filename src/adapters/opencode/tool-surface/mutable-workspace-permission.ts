import { basename, join } from "node:path";
import { resolveMutableSessionRoot } from "../../../runtime/application";
import type { ToolContext } from "./schemas";

export type ResolvedMutableToolWorkspace = {
	root: string;
	source: string;
	requiresHiddenRootApproval: boolean;
};

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

	await context.ask?.({
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
	return resolved.root;
}
