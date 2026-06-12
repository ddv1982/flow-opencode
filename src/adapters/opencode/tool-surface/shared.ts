/**
 * Tool surface boundary: tiny shared helpers only.
 * Keep response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */
import {
	executeFlowCoreCommand,
	inspectWorkspaceContext,
	resolveSessionRoot,
	runFlowCoreCommand,
	runFlowCoreQuery,
	type SessionMutationActionName,
	type SessionMutationPayloadMap,
	type SessionReadActionName,
	type SessionReadPayloadMap,
	type SessionReadValueMap,
	type SessionWorkspaceActionName,
	type SessionWorkspacePayloadMap,
	type SessionWorkspaceResult,
	type SessionWorkspaceValueMap,
} from "../../../runtime/application";
import {
	type FeatureDocDrilldownTarget,
	resolveFeatureDocDrilldownTarget,
} from "../../../runtime/feature-doc-drilldown";
import { readActiveSessionId } from "../../../runtime/lifecycle";
import { ensureMutableWorkspacePermission } from "./mutable-workspace-permission";
import type { ToolContext } from "./schemas";

export function inspectToolWorkspace(context: ToolContext) {
	return inspectWorkspaceContext(context);
}

export function recordToolMetadata(
	context: ToolContext,
	title: string,
	metadata: Record<string, unknown>,
) {
	context.metadata?.({ title, metadata });
}

export function parseFeatureIds(raw?: string[]): string[] {
	return (raw ?? []).map((value) => value.trim()).filter(Boolean);
}

export async function readToolSessionValue<Name extends SessionReadActionName>(
	context: ToolContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
): Promise<SessionReadValueMap[Name]> {
	const result = await runFlowCoreQuery(context, name, payload);
	return result.value;
}

export async function executeToolWorkspaceAction<
	Name extends SessionWorkspaceActionName,
>(
	context: ToolContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
): Promise<string> {
	await ensureMutableWorkspacePermission(context);
	return executeFlowCoreCommand(context, name, payload);
}

export async function runToolWorkspaceAction<
	Name extends SessionWorkspaceActionName,
>(
	context: ToolContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
): Promise<SessionWorkspaceResult<SessionWorkspaceValueMap[Name], Name>> {
	await ensureMutableWorkspacePermission(context);
	return runFlowCoreCommand(context, name, payload);
}

export async function executeGuardedSessionMutation<
	Name extends SessionMutationActionName,
>(
	context: ToolContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
): Promise<string> {
	await ensureMutableWorkspacePermission(context);
	return executeFlowCoreCommand(context, name, payload);
}

export async function resolveFeatureDocDrilldownFromCurrentSession(
	context: ToolContext,
	featureId: string | undefined,
): Promise<FeatureDocDrilldownTarget | null> {
	if (!featureId) {
		return null;
	}

	try {
		const worktree = resolveSessionRoot(context);
		const sessionId = await readActiveSessionId(worktree);
		if (!sessionId) {
			return null;
		}
		return resolveFeatureDocDrilldownTarget({
			featureId,
			source: { location: "active", worktree, sessionId },
		});
	} catch {
		return null;
	}
}
