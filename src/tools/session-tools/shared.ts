/**
 * Session tool boundary: tiny shared helpers only.
 * Keep response shaping in the runtime/application boundary and routing
 * policy in next-command-policy.ts.
 */
import {
	executeDispatchedSessionWorkspaceAction,
	inspectWorkspaceContext,
	resolveMutableSessionRoot,
	resolveReadableSessionRoot,
	runDispatchedSessionReadAction,
	type SessionReadActionName,
	type SessionReadPayloadMap,
	type SessionReadValueMap,
	type SessionWorkspaceActionName,
	type SessionWorkspacePayloadMap,
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

export async function readToolSessionValue<Name extends SessionReadActionName>(
	context: ToolContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
): Promise<SessionReadValueMap[Name]> {
	return (await runDispatchedSessionReadAction(context, name, payload)).value;
}

export async function executeToolWorkspaceAction<
	Name extends SessionWorkspaceActionName,
>(
	context: ToolContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
): Promise<string> {
	return executeDispatchedSessionWorkspaceAction(context, name, payload);
}
