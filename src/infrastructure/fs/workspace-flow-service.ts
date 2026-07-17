import {
	createFlowService,
	type FlowResponse,
	type FlowService,
} from "../../application/flow-service.js";
import { systemTransitionEnvironment } from "../system/transition-environment.js";
import { createFileSessionRepository } from "./session-repository.js";

export function createWorkspaceFlowService(workspace: string): FlowService {
	return createFlowService(
		createFileSessionRepository(workspace),
		systemTransitionEnvironment,
	);
}

export async function flowStatus(workspace: string): Promise<FlowResponse> {
	return createWorkspaceFlowService(workspace).status();
}

export async function flowPlanSave(
	workspace: string,
	input: unknown,
): Promise<FlowResponse> {
	return createWorkspaceFlowService(workspace).planSave(input);
}

export async function flowPlanApprove(
	workspace: string,
): Promise<FlowResponse> {
	return createWorkspaceFlowService(workspace).planApprove();
}

export async function flowRunStart(
	workspace: string,
	input: unknown,
): Promise<FlowResponse> {
	return createWorkspaceFlowService(workspace).runStart(input);
}

export async function flowFeatureComplete(
	workspace: string,
	input: unknown,
): Promise<FlowResponse> {
	return createWorkspaceFlowService(workspace).featureComplete(input);
}

export async function flowFeatureReset(
	workspace: string,
	input: unknown,
): Promise<FlowResponse> {
	return createWorkspaceFlowService(workspace).featureReset(input);
}

export async function flowSessionClose(
	workspace: string,
	input: unknown,
): Promise<FlowResponse> {
	return createWorkspaceFlowService(workspace).sessionClose(input);
}
