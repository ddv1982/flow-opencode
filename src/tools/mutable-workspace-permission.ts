import { basename, join } from "node:path";
import { resolveMutableSessionRoot } from "../runtime/application";
import type { ToolContext } from "./schemas";

function requiresHiddenRootApproval(root: string): boolean {
	const name = basename(root);
	return name.startsWith(".") && name !== ".flow";
}

export async function ensureMutableWorkspacePermission(
	context: ToolContext,
): Promise<string> {
	const resolved = resolveMutableSessionRoot(context);
	if (!requiresHiddenRootApproval(resolved.root)) {
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
