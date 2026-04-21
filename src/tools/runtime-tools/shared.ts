import {
	FlowPlanApplyArgsSchema,
	FlowPlanApproveArgsShape,
	FlowPlanSelectArgsShape,
	FlowReviewRecordFeatureArgsShape,
	FlowReviewRecordFinalArgsShape,
	FlowRunStartArgsShape,
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
