import { z } from "zod";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../domain/feature-id.js";
import { MAX_ORCHESTRATION_PASSES } from "../domain/limits.js";
import { validateOrchestrationPassPolicy } from "../domain/orchestration-policy.js";
import { toFeatureId, toSessionId } from "../domain/session.js";

export {
	hasCandidateExecutionEvidence,
	hasVerifierExecutionEvidence,
	isCandidateShapedDecision,
} from "../domain/orchestration-policy.js";

export const FeatureIdSchema = z
	.string()
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE)
	.transform(toFeatureId);

const SessionIdSchema = z
	.string()
	.regex(/^[a-zA-Z0-9_-]+$/, "Invalid session id.")
	.transform(toSessionId);

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
export const OrchestrationPassKindSchema = z.enum([
	"discovery",
	"audit",
	"review",
	"validation",
	"verification",
	"candidate",
	"implementation-decision",
]);
export const OrchestrationModeSchema = z.enum([
	"evidence",
	"review",
	"validation",
	"audit",
	"verifier",
	"candidate-implementation",
]);
export const OrchestrationDecisionSchema = z.enum([
	"serial",
	"parallel",
	"candidate-exact-path",
	"candidate-worktree",
	"tournament",
	"skipped",
]);
export const OrchestrationCandidateEligibilitySchema = z.enum([
	"eligible",
	"not_eligible",
	"unknown",
]);
export const OrchestrationCandidateDecisionSchema = z.enum([
	"used",
	"skipped",
	"serial_required",
]);
export const OrchestrationDecisionFactorSchema = z.enum([
	"shared_state",
	"overlapping_files",
	"small_slice",
	"needs_manager_judgment",
	"independent_surface",
	"validation_available",
]);
export const OrchestrationWriteScopeSchema = z.enum([
	"none",
	"manager-serial",
	"exact-path",
	"isolated-worktree",
	"mixed",
]);
export const OrchestrationVerificationStatusSchema = z.enum([
	"not-needed",
	"pending",
	"passed",
	"failed",
	"mixed",
	"downgraded",
]);
export const OrchestrationOutcomeSchema = z.enum([
	"accepted",
	"modified",
	"rejected",
	"partial",
	"not-covered",
	"superseded",
]);

export const OrchestrationPassRecordSchema = z
	.object({
		id: z.string().min(1),
		kind: OrchestrationPassKindSchema,
		decision: OrchestrationDecisionSchema.optional(),
		decisionReason: z.string().min(1).optional(),
		candidateEligibility:
			OrchestrationCandidateEligibilitySchema.default("unknown"),
		candidateDecision: OrchestrationCandidateDecisionSchema.optional(),
		decisionFactors: z.array(OrchestrationDecisionFactorSchema).default([]),
		modes: z.array(OrchestrationModeSchema).default([]),
		workerCount: z.number().int().nonnegative().default(0),
		candidateWorkerCount: z.number().int().nonnegative().default(0),
		verifierWorkerCount: z.number().int().nonnegative().default(0),
		sliceIds: z.array(z.string().min(1)).default([]),
		dependsOn: z.array(z.string().min(1)).default([]),
		writeScope: OrchestrationWriteScopeSchema.default("none"),
		handoffRefs: z.array(z.string().min(1)).default([]),
		verificationStatus:
			OrchestrationVerificationStatusSchema.default("not-needed"),
		outcome: OrchestrationOutcomeSchema.default("accepted"),
		synthesisRef: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		for (const issue of validateOrchestrationPassPolicy(value)) {
			ctx.addIssue({
				code: "custom",
				path: [issue.path],
				message: issue.message,
			});
		}
	});

export const OrchestrationTelemetrySchema = z
	.object({
		passCount: z.number().int().nonnegative().default(0),
		workerCount: z.number().int().nonnegative().default(0),
		candidatePassCount: z.number().int().nonnegative().default(0),
		verifierPassCount: z.number().int().nonnegative().default(0),
		candidateEligibleCount: z.number().int().nonnegative().default(0),
		candidateUsedDecisionCount: z.number().int().nonnegative().default(0),
		candidateSerialRequiredDecisionCount: z
			.number()
			.int()
			.nonnegative()
			.default(0),
		skippedCandidateDecisionCount: z.number().int().nonnegative().default(0),
		latestPasses: z
			.array(OrchestrationPassRecordSchema)
			.max(MAX_ORCHESTRATION_PASSES)
			.default([]),
	})
	.strict();

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
		id: FeatureIdSchema,
		title: z.string().min(1),
		summary: z.string().min(1),
		status: FeatureStatusSchema.default("pending"),
		reviewDepth: FeatureReviewDepthSchema.default("standard"),
		targets: z.array(z.string().min(1)).default([]),
		validation: z.array(z.string().min(1)).default([]),
		dependsOn: z.array(FeatureIdSchema).default([]),
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
					dependsOn: z.array(FeatureIdSchema).optional(),
				})
				.strict(),
		)
		.min(1),
});

export const CompletedWorkerOutcomeSchema = z
	.object({
		kind: z.literal("completed"),
		summary: z.string().min(1).optional(),
		resolutionHint: z.string().min(1).optional(),
	})
	.strict();

export const NeedsInputOutcomeSchema = z
	.object({
		kind: z.enum(["blocked", "needs_input", "replan_required"]),
		summary: z.string().min(1),
		resolutionHint: z.string().min(1).optional(),
	})
	.strict();

export const WorkerOutcomeSchema = z.discriminatedUnion("kind", [
	CompletedWorkerOutcomeSchema,
	NeedsInputOutcomeSchema,
]);

export const WorkerResultSchema = z.discriminatedUnion("status", [
	z
		.object({
			status: z.literal("ok"),
			featureId: FeatureIdSchema,
			summary: z.string().min(1),
			artifactsChanged: z.array(ArtifactSchema).default([]),
			validationRun: z.array(ValidationRunSchema).default([]),
			validationScope: ValidationScopeSchema,
			featureReviewDepth: FeatureReviewDepthSchema,
			featureReview: ReviewSchema,
			finalReview: FinalReviewSchema.optional(),
			outcome: CompletedWorkerOutcomeSchema.optional(),
			orchestrationPasses: z
				.array(OrchestrationPassRecordSchema)
				.max(MAX_ORCHESTRATION_PASSES)
				.default([]),
		})
		.strict(),
	z
		.object({
			status: z.literal("needs_input"),
			featureId: FeatureIdSchema,
			summary: z.string().min(1),
			artifactsChanged: z.array(ArtifactSchema).default([]),
			validationRun: z.array(ValidationRunSchema).default([]),
			validationScope: ValidationScopeSchema.optional(),
			featureReviewDepth: FeatureReviewDepthSchema.optional(),
			featureReview: ReviewSchema.optional(),
			finalReview: FinalReviewSchema.optional(),
			outcome: NeedsInputOutcomeSchema,
			orchestrationPasses: z
				.array(OrchestrationPassRecordSchema)
				.max(MAX_ORCHESTRATION_PASSES)
				.default([]),
		})
		.strict(),
]);

export const ExecutionHistoryEntrySchema = z
	.object({
		featureId: FeatureIdSchema,
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
		orchestrationPasses: z
			.array(OrchestrationPassRecordSchema)
			.max(MAX_ORCHESTRATION_PASSES)
			.default([]),
	})
	.strict();

export const BudgetTelemetrySchema = z
	.object({
		reviewCount: z.number().int().nonnegative().default(0),
		failedReviewCount: z.number().int().nonnegative().default(0),
		failedReviewAttemptsByFeature: z
			.record(
				z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
				z.number().int().nonnegative(),
			)
			.default({}),
		orchestration: OrchestrationTelemetrySchema.prefault({}),
	})
	.strict();

export const SessionSchema = z
	.object({
		version: z.literal(3),
		// Constrained to the archive-safe charset so a hostile or hand-edited
		// session.json with an exotic id (e.g. "session/1") fails to load and
		// routes through quarantine recovery, instead of loading and then
		// wedging every archive (flow_plan_save / flow_session_close) forever.
		id: SessionIdSchema,
		goal: z.string().min(1),
		status: SessionStatusSchema,
		approval: z.enum(["pending", "approved"]),
		plan: PlanSchema.nullable(),
		activeFeatureId: FeatureIdSchema.nullable(),
		history: z.array(ExecutionHistoryEntrySchema).default([]),
		budget: BudgetTelemetrySchema.prefault({}),
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

export type {
	Artifact,
	BudgetTelemetry,
	ExecutionHistoryEntry,
	Feature,
	FeatureReviewDepth,
	FinalReview,
	OrchestrationPassRecord,
	OrchestrationTelemetry,
	Plan,
	PlanInput,
	Review,
	Session,
	ValidationRun,
	WorkerResult,
} from "../domain/session.js";
