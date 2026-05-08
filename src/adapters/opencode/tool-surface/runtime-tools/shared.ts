import {
	executeFlowCoreCommand,
	resolveSessionRoot,
	runFlowCoreCommand,
	type SessionMutationActionName,
	type SessionMutationPayloadMap,
	type SessionMutationResult,
	type SessionMutationValueMap,
} from "../../../../runtime/application";
import {
	type FeatureDocDrilldownTarget,
	resolveFeatureDocDrilldownTarget,
} from "../../../../runtime/feature-doc-drilldown";
import { readActiveSessionId } from "../../../../runtime/session";
import { ensureMutableWorkspacePermission } from "../mutable-workspace-permission";
import {
	FlowPlanApproveArgsShape,
	FlowPlanSelectArgsShape,
	FlowRunStartArgsShape,
	type ToolContext,
} from "../schemas";

export const flowPlanApproveArgsShape = FlowPlanApproveArgsShape;

export const flowPlanSelectArgsShape = FlowPlanSelectArgsShape;

export const flowRunStartArgsShape = FlowRunStartArgsShape;

export function parseFeatureIds(raw?: string[]): string[] {
	return (raw ?? []).map((value) => value.trim()).filter(Boolean);
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

export async function runGuardedSessionMutationAction<
	Name extends SessionMutationActionName,
>(
	context: ToolContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
): Promise<SessionMutationResult<SessionMutationValueMap[Name]>> {
	await ensureMutableWorkspacePermission(context);
	return runFlowCoreCommand(context, name, payload) as Promise<
		SessionMutationResult<SessionMutationValueMap[Name]>
	>;
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
