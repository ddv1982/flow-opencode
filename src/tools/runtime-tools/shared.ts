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
	FlowPlanApplyArgsSchema,
	FlowPlanApproveArgsShape,
	FlowPlanSelectArgsShape,
	FlowReviewRecordFeatureArgsShape,
	FlowReviewRecordFinalArgsShape,
	FlowRunStartArgsShape,
	type ToolContext,
	WorkerResultArgsShape,
} from "../schemas";

export const flowPlanApplyArgsShape = FlowPlanApplyArgsSchema.shape;

export const flowPlanApproveArgsShape = FlowPlanApproveArgsShape;

export const flowPlanSelectArgsShape = FlowPlanSelectArgsShape;

export const flowRunStartArgsShape = FlowRunStartArgsShape;

export const workerResultArgsShape = WorkerResultArgsShape;

export const flowReviewRecordFeatureArgsShape =
	FlowReviewRecordFeatureArgsShape;

export const flowReviewRecordFinalArgsShape = FlowReviewRecordFinalArgsShape;

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
