import {
	FlowPlanApplyArgsSchema,
	FlowPlanApproveArgsShape,
	FlowPlanSelectArgsShape,
	FlowReviewRecordFeatureArgsShape,
	FlowReviewRecordFinalArgsShape,
	FlowRunStartArgsShape,
	WorkerResultArgsShape,
} from "../schemas";

export const flowPlanApplyArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowPlanApplyArgsSchema.shape as any;

export const flowPlanApproveArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowPlanApproveArgsShape as any;

export const flowPlanSelectArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowPlanSelectArgsShape as any;

export const flowRunStartArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowRunStartArgsShape as any;

export const workerResultArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	WorkerResultArgsShape as any;

export const flowReviewRecordFeatureArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowReviewRecordFeatureArgsShape as any;

export const flowReviewRecordFinalArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowReviewRecordFinalArgsShape as any;

export function parseFeatureIds(raw?: string[]): string[] {
	return (raw ?? []).map((value) => value.trim()).filter(Boolean);
}
