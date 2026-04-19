/**
 * Session tool boundary: tiny shared helpers only.
 * Keep response assembly in responses.ts and routing policy in
 * next-command-policy.ts.
 */
import { resolveSessionRoot } from "../../runtime/application";
import type { ToolContext } from "../schemas";

export function resolveToolSessionRoot(context: ToolContext) {
	return resolveSessionRoot(context);
}

export function recordToolMetadata(
	context: ToolContext,
	title: string,
	metadata: Record<string, unknown>,
) {
	context.metadata?.({ title, metadata });
}
