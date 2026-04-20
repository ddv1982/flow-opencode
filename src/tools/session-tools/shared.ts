/**
 * Session tool boundary: tiny shared helpers only.
 * Keep response assembly in responses.ts and routing policy in
 * next-command-policy.ts.
 */
import {
	inspectWorkspaceContext,
	resolveMutableSessionRoot,
	resolveReadableSessionRoot,
} from "../../runtime/application";
import type { ToolContext } from "../schemas";

export function inspectToolWorkspace(context: ToolContext) {
	return inspectWorkspaceContext(context);
}

export function resolveReadableToolSessionRoot(context: ToolContext) {
	return resolveReadableSessionRoot(context).root;
}

export function resolveMutableToolSessionRoot(context: ToolContext) {
	return resolveMutableSessionRoot(context).root;
}

export function recordToolMetadata(
	context: ToolContext,
	title: string,
	metadata: Record<string, unknown>,
) {
	context.metadata?.({ title, metadata });
}
