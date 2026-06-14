import { z } from "zod";

export const FEATURE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FEATURE_ID_MESSAGE = "Feature ids must be lowercase kebab-case";

export const FeatureStatusSchema = z.enum([
	"pending",
	"in_progress",
	"completed",
	"blocked",
]);

export const SessionStatusSchema = z.enum([
	"planning",
	"ready",
	"running",
	"blocked",
	"completed",
]);

export const ReviewStatusSchema = z.enum(["passed", "failed"]);
export const ValidationStatusSchema = z.enum(["passed", "failed"]);
export const ValidationScopeSchema = z.enum(["targeted", "broad"]);
export const FinalReviewPolicySchema = z.enum(["broad", "detailed"]);

export const ReviewFindingSchema = z
	.object({
		summary: z.string().min(1),
		severity: z.enum(["blocking", "advisory"]).default("blocking"),
	})
	.strict();

export const ReviewSchema = z
	.object({
		status: ReviewStatusSchema,
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
	})
	.strict();

export const FinalReviewSchema = ReviewSchema.extend({
	reviewDepth: FinalReviewPolicySchema,
}).strict();

export const ValidationRunSchema = z
	.object({
		command: z.string().min(1),
		status: ValidationStatusSchema,
		summary: z.string().min(1),
	})
	.strict();

export const ArtifactSchema = z
	.object({
		path: z.string().min(1),
	})
	.strict();

export const FeatureSchema = z
	.object({
		id: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
		title: z.string().min(1),
		summary: z.string().min(1),
		status: FeatureStatusSchema.default("pending"),
		targets: z.array(z.string().min(1)).default([]),
		validation: z.array(z.string().min(1)).default([]),
		dependsOn: z.array(z.string().regex(FEATURE_ID_PATTERN)).default([]),
	})
	.strict();

export const PlanSchema = z
	.object({
		summary: z.string().min(1),
		overview: z.string().min(1),
		requirements: z.array(z.string().min(1)).default([]),
		decisions: z.array(z.string().min(1)).default([]),
		finalReviewPolicy: FinalReviewPolicySchema.default("detailed"),
		features: z.array(FeatureSchema).min(1),
	})
	.strict();

export const PlanInputSchema = PlanSchema.omit({ features: true }).extend({
	finalReviewPolicy: FinalReviewPolicySchema.optional(),
	features: z
		.array(
			FeatureSchema.omit({ status: true })
				.extend({
					status: FeatureStatusSchema.optional(),
					targets: z.array(z.string().min(1)).optional(),
					validation: z.array(z.string().min(1)).optional(),
					dependsOn: z.array(z.string().regex(FEATURE_ID_PATTERN)).optional(),
				})
				.strict(),
		)
		.min(1),
});

export const WorkerOutcomeSchema = z
	.object({
		kind: z
			.enum(["completed", "blocked", "needs_input", "replan_required"])
			.default("completed"),
		summary: z.string().min(1).optional(),
		resolutionHint: z.string().min(1).optional(),
	})
	.strict();

export const NeedsInputOutcomeSchema = z
	.object({
		kind: z
			.enum(["blocked", "needs_input", "replan_required"])
			.default("needs_input"),
		summary: z.string().min(1),
		resolutionHint: z.string().min(1).optional(),
	})
	.strict();

export const WorkerResultSchema = z
	.discriminatedUnion("status", [
		z
			.object({
				status: z.literal("ok"),
				featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
				summary: z.string().min(1),
				artifactsChanged: z.array(ArtifactSchema).default([]),
				validationRun: z.array(ValidationRunSchema).default([]),
				validationScope: ValidationScopeSchema,
				featureReview: ReviewSchema,
				finalReview: FinalReviewSchema.optional(),
				outcome: WorkerOutcomeSchema.optional(),
			})
			.strict(),
		z
			.object({
				status: z.literal("needs_input"),
				featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
				summary: z.string().min(1),
				artifactsChanged: z.array(ArtifactSchema).default([]),
				validationRun: z.array(ValidationRunSchema).default([]),
				validationScope: ValidationScopeSchema.optional(),
				featureReview: ReviewSchema.optional(),
				finalReview: FinalReviewSchema.optional(),
				outcome: NeedsInputOutcomeSchema,
			})
			.strict(),
	])
	.superRefine((value, ctx) => {
		if (
			value.status === "ok" &&
			value.outcome?.kind &&
			value.outcome.kind !== "completed"
		) {
			ctx.addIssue({
				code: "custom",
				path: ["outcome", "kind"],
				message: 'ok worker results must use outcome.kind "completed".',
			});
		}
	});

export const ExecutionHistoryEntrySchema = z
	.object({
		featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
		status: z.enum(["completed", "blocked", "needs_input"]),
		summary: z.string().min(1),
		recordedAt: z.string().min(1),
		artifactsChanged: z.array(ArtifactSchema).default([]),
		validationRun: z.array(ValidationRunSchema).default([]),
		validationScope: ValidationScopeSchema.optional(),
		featureReview: ReviewSchema.optional(),
		finalReview: FinalReviewSchema.optional(),
		outcome: WorkerOutcomeSchema.optional(),
	})
	.strict();

export const SessionSchema = z
	.object({
		version: z.literal(2),
		id: z.string().min(1),
		goal: z.string().min(1),
		status: SessionStatusSchema,
		approval: z.enum(["pending", "approved"]),
		plan: PlanSchema.nullable(),
		activeFeatureId: z
			.string()
			.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE)
			.nullable(),
		history: z.array(ExecutionHistoryEntrySchema).default([]),
		closure: z
			.object({
				kind: z.enum(["completed", "deferred", "abandoned"]),
				summary: z.string().min(1),
				recordedAt: z.string().min(1),
			})
			.strict()
			.nullable(),
		lastError: z
			.object({
				tool: z.string().min(1),
				summary: z.string().min(1),
				recovery: z.string().min(1).optional(),
				recordedAt: z.string().min(1),
			})
			.strict()
			.nullable()
			.default(null),
		timestamps: z
			.object({
				createdAt: z.string().min(1),
				updatedAt: z.string().min(1),
				completedAt: z.string().min(1).nullable(),
			})
			.strict(),
	})
	.strict();

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ExecutionHistoryEntry = z.infer<typeof ExecutionHistoryEntrySchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type FinalReview = z.infer<typeof FinalReviewSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanInputSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ValidationRun = z.infer<typeof ValidationRunSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
