import {
	createFlowService,
	type FlowResponse,
} from "../../application/flow-service.js";
import { systemTransitionEnvironment } from "../system/transition-environment.js";
import { createFileSessionRepository } from "./session-repository.js";

function service(workspace: string) {
	return createFlowService(
		createFileSessionRepository(workspace),
		systemTransitionEnvironment,
	);
}

export const flowStatus = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).status(input);
export const flowPlanSave = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).planSave(input);
export const flowPlanApprove = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).planApprove(input);
export const flowRunStart = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).runStart(input);
export const flowReviewStart = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).reviewStart(input);
export const flowFeatureComplete = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).featureComplete(input);
export const flowFeatureCompleteReplay = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).featureCompleteReplay(input);
export const flowFeatureReset = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).featureReset(input);
export const flowSessionClose = (
	workspace: string,
	input: unknown,
): Promise<FlowResponse> => service(workspace).sessionClose(input);
