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

const CANDIDATE_SHAPED_DECISIONS: ReadonlySet<string> = new Set([
	"candidate-exact-path",
	"candidate-worktree",
	"tournament",
]);

export function isCandidateShapedDecision(
	decision: string | undefined,
): boolean {
	return decision !== undefined && CANDIDATE_SHAPED_DECISIONS.has(decision);
}

// Single source of truth for "did candidate/verifier work actually run" —
// used by both schema validation and telemetry counting in transitions.ts so
// the two can never disagree about what counts as execution evidence.
export function hasCandidateExecutionEvidence(pass: {
	kind: string;
	modes: readonly string[];
	candidateWorkerCount: number;
}): boolean {
	return (
		pass.kind === "candidate" ||
		pass.modes.includes("candidate-implementation") ||
		pass.candidateWorkerCount > 0
	);
}

export function hasVerifierExecutionEvidence(pass: {
	kind: string;
	modes: readonly string[];
	verifierWorkerCount: number;
}): boolean {
	return (
		pass.kind === "verification" ||
		pass.modes.includes("verifier") ||
		pass.verifierWorkerCount > 0
	);
}

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
		const issue = (path: string, message: string) =>
			ctx.addIssue({ code: "custom", path: [path], message });
		const isImplementationDecision = value.kind === "implementation-decision";
		const candidateEligibilityIsUnknown =
			value.candidateEligibility === "unknown";
		// A worker may fill both roles, so subtype counts are checked
		// individually against the total instead of summed.
		if (value.candidateWorkerCount > value.workerCount) {
			issue(
				"candidateWorkerCount",
				"candidateWorkerCount cannot exceed total workerCount.",
			);
		}
		if (value.verifierWorkerCount > value.workerCount) {
			issue(
				"verifierWorkerCount",
				"verifierWorkerCount cannot exceed total workerCount.",
			);
		}
		if (
			isCandidateShapedDecision(value.decision) &&
			!hasCandidateExecutionEvidence(value)
		) {
			issue(
				"decision",
				"Candidate-shaped decisions require candidate execution evidence: a candidate pass, candidate-implementation mode, or candidateWorkerCount > 0.",
			);
		}
		if (isImplementationDecision) {
			if (value.decision === "parallel") {
				issue(
					"decision",
					"Implementation decisions cannot use decision 'parallel'; use 'serial', 'skipped', or a candidate-shaped decision.",
				);
			}
			if (candidateEligibilityIsUnknown) {
				issue(
					"candidateEligibility",
					"Implementation decisions must include explicit candidateEligibility.",
				);
			}
			if (!value.candidateDecision) {
				issue(
					"candidateDecision",
					"Implementation decisions must include explicit candidateDecision.",
				);
			}
			if (!value.decision) {
				issue(
					"decision",
					"Implementation decisions must include explicit decision.",
				);
			}
			if (value.decisionFactors.length === 0) {
				issue(
					"decisionFactors",
					"Implementation decisions must include at least one decisionFactor.",
				);
			}
		}
		if (!value.candidateDecision) return;
		if (!isImplementationDecision && candidateEligibilityIsUnknown) {
			issue(
				"candidateEligibility",
				"Candidate eligibility must be explicit when candidateDecision is set.",
			);
		}
		if (
			!isImplementationDecision &&
			(value.candidateDecision === "skipped" ||
				value.candidateDecision === "serial_required")
		) {
			issue(
				"candidateDecision",
				"Candidate decisions 'skipped' and 'serial_required' are only valid on implementation-decision records.",
			);
		}
		if (
			value.candidateEligibility === "not_eligible" &&
			value.candidateDecision === "used"
		) {
			issue(
				"candidateDecision",
				"Candidate decision 'used' requires eligible candidate work.",
			);
		}
		if (
			value.candidateEligibility === "eligible" &&
			value.candidateDecision === "serial_required"
		) {
			issue(
				"candidateDecision",
				"Candidate decision 'serial_required' requires not_eligible candidate work.",
			);
		}
		if (
			value.candidateDecision === "skipped" &&
			value.candidateEligibility !== "eligible"
		) {
			issue(
				"candidateDecision",
				"Candidate decision 'skipped' requires eligible candidate work.",
			);
		}
		if (
			isImplementationDecision &&
			value.decision === "skipped" &&
			value.candidateDecision !== "skipped"
		) {
			issue(
				"decision",
				"Implementation decision 'skipped' requires candidateDecision 'skipped'.",
			);
		}
		if (
			isImplementationDecision &&
			value.candidateDecision === "skipped" &&
			value.decision &&
			value.decision !== "skipped"
		) {
			issue(
				"candidateDecision",
				"Candidate decision 'skipped' requires implementation decision 'skipped'.",
			);
		}
		if (
			isImplementationDecision &&
			value.candidateDecision === "serial_required" &&
			value.decision &&
			value.decision !== "serial"
		) {
			issue(
				"candidateDecision",
				"Candidate decision 'serial_required' requires implementation decision 'serial'.",
			);
		}
		if (value.candidateDecision === "used") {
			if (!hasCandidateExecutionEvidence(value)) {
				issue(
					"candidateDecision",
					"Candidate decision 'used' requires a candidate pass, candidate mode, or candidate worker count.",
				);
			}
			if (value.decision && !isCandidateShapedDecision(value.decision)) {
				issue(
					"decision",
					"Candidate decision 'used' requires an omitted or candidate-shaped decision.",
				);
			}
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
		// Every pass id ever counted, so resubmission dedup survives ids
		// sliding out of the bounded latestPasses window.
		recordedPassIds: z.array(z.string().min(1)).default([]),
		latestPasses: z.array(OrchestrationPassRecordSchema).default([]),
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
				orchestrationPasses: z.array(OrchestrationPassRecordSchema).default([]),
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
				orchestrationPasses: z.array(OrchestrationPassRecordSchema).default([]),
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
		orchestrationPasses: z.array(OrchestrationPassRecordSchema).default([]),
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
		orchestration: OrchestrationTelemetrySchema.prefault({}),
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

export type Artifact = z.infer<typeof ArtifactSchema>;
export type BudgetTelemetry = z.infer<typeof BudgetTelemetrySchema>;
export type ExecutionHistoryEntry = z.infer<typeof ExecutionHistoryEntrySchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type FeatureReviewDepth = z.infer<typeof FeatureReviewDepthSchema>;
export type FinalReview = z.infer<typeof FinalReviewSchema>;
export type OrchestrationPassRecord = z.infer<
	typeof OrchestrationPassRecordSchema
>;
export type OrchestrationTelemetry = z.infer<
	typeof OrchestrationTelemetrySchema
>;
export type PhaseBoundary = z.infer<typeof PhaseBoundarySchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanInputSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ValidationRun = z.infer<typeof ValidationRunSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
