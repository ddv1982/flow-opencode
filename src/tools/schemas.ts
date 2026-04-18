import { tool } from "@opencode-ai/plugin";
import type { WorkspaceContext } from "../runtime/application";
import { FEATURE_ID_MESSAGE, FEATURE_ID_PATTERN } from "../runtime/primitives";
import type {
	Plan,
	PlanningContext,
	FlowReviewRecordFeatureArgs as RuntimeFlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs as RuntimeFlowReviewRecordFinalArgs,
} from "../runtime/schema";

const z = tool.schema;
export const featureIdSchema = z
	.string()
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);

export const FlowStatusArgsShape = {};
export const FlowHistoryArgsShape = {};
export const FlowHistoryShowArgsShape = {
	sessionId: z
		.string()
		.min(1)
		.regex(FEATURE_ID_PATTERN, "Session ids must be lowercase kebab-case"),
};
export const FlowSessionActivateArgsShape = {
	sessionId: z
		.string()
		.min(1)
		.regex(FEATURE_ID_PATTERN, "Session ids must be lowercase kebab-case"),
};
export const FlowAutoPrepareArgsShape = {
	argumentString: z.string().optional(),
};
export const FlowPlanStartArgsShape = {
	goal: z.string().trim().min(1).optional(),
	repoProfile: z.array(z.string().min(1)).optional(),
};
export const FlowPlanApplyArgsShape = {
	plan: z.object({
		summary: z.string().min(1),
		overview: z.string().min(1),
		requirements: z.array(z.string().min(1)).default([]),
		architectureDecisions: z.array(z.string().min(1)).default([]),
		features: z
			.array(
				z.object({
					id: featureIdSchema,
					title: z.string().min(1),
					summary: z.string().min(1),
					fileTargets: z.array(z.string().min(1)).default([]),
					verification: z.array(z.string().min(1)).default([]),
					dependsOn: z.array(z.string().min(1)).optional(),
					blockedBy: z.array(z.string().min(1)).optional(),
				}),
			)
			.min(1),
		goalMode: z.string().min(1).optional(),
		decompositionPolicy: z.string().min(1).optional(),
		completionPolicy: z
			.object({
				minCompletedFeatures: z.number().int().positive().optional(),
				requireFinalReview: z.boolean().optional(),
			})
			.optional(),
		notes: z.array(z.string().min(1)).optional(),
	}),
	planning: z.custom<Partial<PlanningContext>>().optional(),
};
export const FlowPlanApproveArgsShape = {
	featureIds: z.array(featureIdSchema).optional(),
};
export const FlowPlanSelectArgsShape = {
	featureIds: z.array(featureIdSchema),
};
export const FlowRunStartArgsShape = {
	featureId: featureIdSchema.optional(),
};
export const FlowResetFeatureArgsShape = {
	featureId: featureIdSchema,
};

export const WorkerResultArgsShape = {
	contractVersion: z.custom<"1">(),
	status: z.custom<"ok" | "needs_input">(),
	summary: z.string().min(1),
	artifactsChanged: z
		.array(
			z.object({
				path: z.string().min(1),
				kind: z.string().min(1).optional(),
			}),
		)
		.default([]),
	validationRun: z
		.array(
			z.object({
				command: z.string().min(1),
				status: z.custom<"passed" | "failed" | "not_run" | "blocked">(),
				summary: z.string().min(1),
			}),
		)
		.default([]),
	validationScope: z.custom<"targeted" | "broad">().optional(),
	reviewIterations: z.number().int().nonnegative().optional(),
	decisions: z.array(z.object({ summary: z.string().min(1) })).default([]),
	nextStep: z.string().min(1),
	outcome: z
		.object({
			kind: z.custom<string>(),
			category: z.string().min(1).optional(),
			summary: z.string().min(1).optional(),
			resolutionHint: z.string().min(1).optional(),
			retryable: z.boolean().optional(),
			autoResolvable: z.boolean().optional(),
			needsHuman: z.boolean().optional(),
		})
		.optional(),
	featureResult: z.object({
		featureId: featureIdSchema,
		verificationStatus: z
			.custom<"passed" | "failed" | "not_run" | "blocked">()
			.optional(),
		notes: z.array(z.object({ note: z.string().min(1) })).optional(),
		followUps: z
			.array(
				z.object({
					summary: z.string().min(1),
					severity: z.string().min(1).optional(),
				}),
			)
			.optional(),
	}),
	featureReview: z.object({
		status: z.custom<"passed" | "failed">(),
		summary: z.string().min(1),
		blockingFindings: z
			.array(z.object({ summary: z.string().min(1) }))
			.default([]),
	}),
	finalReview: z
		.object({
			status: z.custom<"passed" | "failed">(),
			summary: z.string().min(1),
			blockingFindings: z
				.array(z.object({ summary: z.string().min(1) }))
				.default([]),
		})
		.optional(),
};
export const FlowReviewRecordFeatureArgsShape = {
	scope: z.literal("feature"),
	featureId: featureIdSchema,
	status: z.custom<RuntimeFlowReviewRecordFeatureArgs["status"]>(),
	summary: z.string().min(1),
	blockingFindings: z
		.array(z.object({ summary: z.string().min(1) }))
		.default([]),
	followUps: z
		.array(
			z.object({
				summary: z.string().min(1),
				severity: z.string().min(1).optional(),
			}),
		)
		.default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
};
export const FlowReviewRecordFinalArgsShape = {
	scope: z.literal("final"),
	status: z.custom<RuntimeFlowReviewRecordFinalArgs["status"]>(),
	summary: z.string().min(1),
	blockingFindings: z
		.array(z.object({ summary: z.string().min(1) }))
		.default([]),
	followUps: z
		.array(
			z.object({
				summary: z.string().min(1),
				severity: z.string().min(1).optional(),
			}),
		)
		.default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
};

export const FlowStatusArgsSchema = z.object(FlowStatusArgsShape);
export const FlowHistoryArgsSchema = z.object(FlowHistoryArgsShape);
export const FlowHistoryShowArgsSchema = z.object(FlowHistoryShowArgsShape);
export const FlowSessionActivateArgsSchema = z.object(
	FlowSessionActivateArgsShape,
);
export const FlowAutoPrepareArgsSchema = z.object(FlowAutoPrepareArgsShape);
export const FlowPlanStartArgsSchema = z.object(FlowPlanStartArgsShape);
export const FlowPlanApplyArgsSchema = z.object(FlowPlanApplyArgsShape);
export const FlowPlanApproveArgsSchema = z.object(FlowPlanApproveArgsShape);
export const FlowPlanSelectArgsSchema = z.object(FlowPlanSelectArgsShape);
export const FlowRunStartArgsSchema = z.object(FlowRunStartArgsShape);
export const FlowResetFeatureArgsSchema = z.object(FlowResetFeatureArgsShape);
export const WorkerResultArgsSchema = z.object(WorkerResultArgsShape);
export const FlowReviewRecordFeatureArgsSchema = z.object(
	FlowReviewRecordFeatureArgsShape,
);
export const FlowReviewRecordFinalArgsSchema = z
	.object(FlowReviewRecordFinalArgsShape)
	.strict();

export type FlowHistoryShowArgs = {
	sessionId: string;
};

export type FlowSessionActivateArgs = {
	sessionId: string;
};

export type FlowAutoPrepareArgs = {
	argumentString?: string;
};

export type FlowPlanStartArgs = {
	goal?: string;
	repoProfile?: string[];
};

export type FlowPlanApplyArgs = {
	plan: Plan;
	planning?: Partial<PlanningContext>;
};

export type FlowPlanApproveArgs = {
	featureIds?: string[];
};

export type FlowPlanSelectArgs = {
	featureIds: string[];
};

export type FlowRunStartArgs = {
	featureId?: string;
};

export type FlowResetFeatureArgs = {
	featureId: string;
};

export type ToolContext = WorkspaceContext;
