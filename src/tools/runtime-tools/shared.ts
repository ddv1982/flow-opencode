import {
	executeDispatchedSessionMutation,
	runDispatchedSessionMutationAction,
	type SessionMutationActionName,
	type SessionMutationPayloadMap,
	type SessionMutationResult,
	type SessionMutationValueMap,
} from "../../runtime/application";
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
	return executeDispatchedSessionMutation(context, name, payload);
}

export async function runGuardedSessionMutationAction<
	Name extends SessionMutationActionName,
>(
	context: ToolContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
): Promise<SessionMutationResult<SessionMutationValueMap[Name]>> {
	await ensureMutableWorkspacePermission(context);
	return runDispatchedSessionMutationAction(context, name, payload);
}
