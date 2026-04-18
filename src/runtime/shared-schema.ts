import {
	DECOMPOSITION_POLICIES,
	GOAL_MODES,
	OUTCOME_KINDS,
	REVIEW_STATUSES,
	REVIEWER_DECISION_STATUSES,
	VALIDATION_STATUSES,
	VERIFICATION_STATUSES,
	WORKER_STATUSES,
} from "./contracts";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	REVIEW_SCOPES,
} from "./primitives";

// Biome disables noExplicitAny for this file because M3 will unify the schema layer and remove this temporary type-erasure bridge.
type SchemaApi = {
	string: () => {
		min: (length: number) => any;
		regex: (pattern: RegExp, message?: string) => any;
		optional: () => any;
		default: (value: string) => any;
	};
	number: () => {
		int: () => {
			positive: () => any;
		};
	};
	boolean: () => {
		optional: () => any;
		default: (value: boolean) => any;
	};
	enum: (values: readonly string[]) => {
		optional: () => any;
		default: (value: string) => any;
	};
	object: (shape: Record<string, any>) => any;
	array: (schema: any) => {
		default: (value: unknown[]) => any;
		min: (length: number) => any;
		optional: () => any;
	};
	literal: (value: string) => any;
};

export type SharedSchemaBuildOptions = {
	includeFeatureStatus: boolean;
	defaultGoalMode: boolean;
	defaultDecompositionPolicy: boolean;
	defaultPlanningArrays: boolean;
};

const FEATURE_STATUSES = [
	"pending",
	"in_progress",
	"completed",
	"blocked",
] as const;

export function buildSharedSchemas(
	schema: SchemaApi,
	options: SharedSchemaBuildOptions,
) {
	const featureIdSchema = schema
		.string()
		.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);
	const validationStatusSchema = schema.enum(VALIDATION_STATUSES);
	const workerStatusSchema = schema.enum(WORKER_STATUSES);
	const outcomeKindSchema = schema.enum(OUTCOME_KINDS);
	const goalModeSchema = schema.enum(GOAL_MODES);
	const decompositionPolicySchema = schema.enum(DECOMPOSITION_POLICIES);

	const reviewFindingSchema = schema.object({
		summary: schema.string().min(1),
	});

	const followUpSchema = schema.object({
		summary: schema.string().min(1),
		severity: schema.string().min(1).optional(),
	});

	const decisionSchema = schema.object({
		summary: schema.string().min(1),
	});

	const noteSchema = schema.object({
		note: schema.string().min(1),
	});

	const artifactSchema = schema.object({
		path: schema.string().min(1),
		kind: schema.string().min(1).optional(),
	});

	const validationRunSchema = schema.object({
		command: schema.string().min(1),
		status: validationStatusSchema,
		summary: schema.string().min(1),
	});

	const reviewSchema = schema.object({
		status: schema.enum(REVIEW_STATUSES),
		summary: schema.string().min(1),
		blockingFindings: schema.array(reviewFindingSchema).default([]),
	});

	const reviewerDecisionSchema = schema.object({
		scope: schema.enum(REVIEW_SCOPES),
		featureId: featureIdSchema.optional(),
		status: schema.enum(REVIEWER_DECISION_STATUSES),
		summary: schema.string().min(1),
		blockingFindings: schema.array(reviewFindingSchema).default([]),
		followUps: schema.array(followUpSchema).default([]),
		suggestedValidation: schema.array(schema.string().min(1)).default([]),
	});

	const outcomeSchema = schema.object({
		kind: outcomeKindSchema,
		category: schema.string().min(1).optional(),
		summary: schema.string().min(1).optional(),
		resolutionHint: schema.string().min(1).optional(),
		retryable: schema.boolean().optional(),
		autoResolvable: schema.boolean().optional(),
		needsHuman: schema.boolean().optional(),
	});

	const featureResultSchema = schema.object({
		featureId: featureIdSchema,
		verificationStatus: schema.enum(VERIFICATION_STATUSES).optional(),
		notes: schema.array(noteSchema).optional(),
		followUps: schema.array(followUpSchema).optional(),
	});

	const featureShape: Record<string, any> = {
		id: featureIdSchema,
		title: schema.string().min(1),
		summary: schema.string().min(1),
		fileTargets: schema.array(schema.string().min(1)).default([]),
		verification: schema.array(schema.string().min(1)).default([]),
		dependsOn: schema.array(schema.string().min(1)).optional(),
		blockedBy: schema.array(schema.string().min(1)).optional(),
	};

	if (options.includeFeatureStatus) {
		featureShape.status = schema.enum(FEATURE_STATUSES).default("pending");
	}

	const featureSchema = schema.object(featureShape);

	const implementationApproachSchema = schema.object({
		chosenDirection: schema.string().min(1),
		keyConstraints: schema.array(schema.string().min(1)).default([]),
		validationSignals: schema.array(schema.string().min(1)).default([]),
		sources: schema.array(schema.string().min(1)).default([]),
	});

	const completionPolicySchema = schema.object({
		minCompletedFeatures: schema.number().int().positive().optional(),
		requireFinalReview: schema.boolean().optional(),
	});

	const planSchema = schema.object({
		summary: schema.string().min(1),
		overview: schema.string().min(1),
		requirements: schema.array(schema.string().min(1)).default([]),
		architectureDecisions: schema.array(schema.string().min(1)).default([]),
		features: schema.array(featureSchema).min(1),
		goalMode: options.defaultGoalMode
			? goalModeSchema.default("implementation")
			: goalModeSchema.optional(),
		decompositionPolicy: options.defaultDecompositionPolicy
			? decompositionPolicySchema.default("atomic_feature")
			: decompositionPolicySchema.optional(),
		completionPolicy: completionPolicySchema.optional(),
		notes: schema.array(schema.string().min(1)).optional(),
	});

	const planningContextSchema = schema.object({
		repoProfile: options.defaultPlanningArrays
			? schema.array(schema.string().min(1)).default([])
			: schema.array(schema.string().min(1)).optional(),
		research: options.defaultPlanningArrays
			? schema.array(schema.string().min(1)).default([])
			: schema.array(schema.string().min(1)).optional(),
		implementationApproach: implementationApproachSchema.optional(),
	});

	return {
		featureIdSchema,
		goalModeSchema,
		decompositionPolicySchema,
		validationStatusSchema,
		workerStatusSchema,
		outcomeKindSchema,
		reviewFindingSchema,
		followUpSchema,
		decisionSchema,
		noteSchema,
		artifactSchema,
		validationRunSchema,
		reviewSchema,
		reviewerDecisionSchema,
		outcomeSchema,
		featureResultSchema,
		featureSchema,
		implementationApproachSchema,
		completionPolicySchema,
		planSchema,
		planningContextSchema,
	};
}
