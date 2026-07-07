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
export const FeatureReviewDepthSchema = z.enum([
	"quick",
	"standard",
	"detailed",
]);
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
		reviewDepth: FeatureReviewDepthSchema.default("standard"),
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
					reviewDepth: FeatureReviewDepthSchema.optional(),
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
				featureReviewDepth: FeatureReviewDepthSchema,
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
				featureReviewDepth: FeatureReviewDepthSchema.optional(),
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
		featureReviewDepth: FeatureReviewDepthSchema.optional(),
		featureReview: ReviewSchema.optional(),
		finalReview: FinalReviewSchema.optional(),
		outcome: WorkerOutcomeSchema.optional(),
	})
	.strict();

export const TokenTelemetrySchema = z
	.object({
		source: z
			.enum(["host_unavailable", "reported"])
			.default("host_unavailable"),
		visibleTokens: z.number().int().nonnegative().nullable().default(null),
		cacheReadTokens: z.number().int().nonnegative().nullable().default(null),
		nonCacheTokens: z.number().int().nonnegative().nullable().default(null),
	})
	.strict();

export const PhaseBoundarySchema = z
	.object({
		reason: z.enum(["feature_limit", "token_limit", "review_failure_limit"]),
		summary: z.string().min(1),
		resumeInstructions: z.string().min(1),
		recordedAt: z.string().min(1),
	})
	.strict();

export const BudgetTelemetrySchema = z
	.object({
		phaseStartedAt: z.string().min(1).default("unknown"),
		completedFeaturesSinceBoundary: z.number().int().nonnegative().default(0),
		reviewCount: z.number().int().nonnegative().default(0),
		failedReviewCount: z.number().int().nonnegative().default(0),
		failedReviewAttemptsByFeature: z
			.record(
				z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
				z.number().int().nonnegative(),
			)
			.default({}),
		tokenTelemetry: TokenTelemetrySchema.default({
			source: "host_unavailable",
			visibleTokens: null,
			cacheReadTokens: null,
			nonCacheTokens: null,
		}),
		phaseBoundary: PhaseBoundarySchema.nullable().default(null),
	})
	.strict();

export const SessionSchema = z
	.object({
		version: z.literal(2),
		// Constrained to the archive-safe charset so a hostile or hand-edited
		// session.json with an exotic id (e.g. "session/1") fails to load and
		// routes through quarantine recovery, instead of loading and then
		// wedging every archive (flow_plan_save / flow_session_close) forever.
		id: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Invalid session id."),
		goal: z.string().min(1),
		status: SessionStatusSchema,
		approval: z.enum(["pending", "approved"]),
		plan: PlanSchema.nullable(),
		activeFeatureId: z
			.string()
			.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE)
			.nullable(),
		history: z.array(ExecutionHistoryEntrySchema).default([]),
		budget: BudgetTelemetrySchema.default({
			phaseStartedAt: "unknown",
			completedFeaturesSinceBoundary: 0,
			reviewCount: 0,
			failedReviewCount: 0,
			failedReviewAttemptsByFeature: {},
			tokenTelemetry: {
				source: "host_unavailable",
				visibleTokens: null,
				cacheReadTokens: null,
				nonCacheTokens: null,
			},
			phaseBoundary: null,
		}),
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
export type BudgetTelemetry = z.infer<typeof BudgetTelemetrySchema>;
export type ExecutionHistoryEntry = z.infer<typeof ExecutionHistoryEntrySchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type FeatureReviewDepth = z.infer<typeof FeatureReviewDepthSchema>;
export type FinalReview = z.infer<typeof FinalReviewSchema>;
export type PhaseBoundary = z.infer<typeof PhaseBoundarySchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanInputSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ValidationRun = z.infer<typeof ValidationRunSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
