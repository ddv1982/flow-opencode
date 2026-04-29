// Flow runtime schema owner: session, plan, review, and worker payload strictness remains normative here.

import { z } from "zod";
import {
	AUDIT_DEPTHS,
	AUDIT_FINDING_CATEGORIES,
	AUDIT_FINDING_CONFIDENCE,
	AUDIT_SURFACE_CATEGORIES,
	AUDIT_SURFACE_REVIEW_STATUSES,
	AUDIT_VALIDATION_STATUSES,
	CLOSURE_KINDS,
	DECISION_DOMAINS,
	DECISION_MODES,
	DECOMPOSITION_POLICIES,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	FEATURE_PRIORITIES,
	GOAL_MODES,
	NEEDS_INPUT_OUTCOME_KINDS,
	OUTCOME_KINDS,
	PRIORITY_MODES,
	REPLAN_REASONS,
	REVIEW_PURPOSES,
	REVIEW_SCOPES,
	REVIEW_STATUSES,
	REVIEWER_DECISION_STATUSES,
	STOP_RULES,
	VALIDATION_SCOPES,
	VALIDATION_STATUSES,
	VERIFICATION_STATUSES,
	WORKER_STATUSES,
} from "./constants";

function isNeedsInputOutcomeKind(
	value: (typeof OUTCOME_KINDS)[number],
): value is (typeof NEEDS_INPUT_OUTCOME_KINDS)[number] {
	return NEEDS_INPUT_OUTCOME_KINDS.includes(
		value as (typeof NEEDS_INPUT_OUTCOME_KINDS)[number],
	);
}

function hasStructuredReplanReason(value: {
	replanReason?: string | undefined;
	failedAssumption?: string | undefined;
	recommendedAdjustment?: string | undefined;
}): boolean {
	return Boolean(
		value.replanReason && value.failedAssumption && value.recommendedAdjustment,
	);
}

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
export const ApprovalStatusSchema = z.enum(["pending", "approved"]);
export const GoalModeSchema = z.enum(GOAL_MODES);
export const DecompositionPolicySchema = z.enum(DECOMPOSITION_POLICIES);
export const PackageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun"]);
export const ValidationStatusSchema = z.enum(VALIDATION_STATUSES);
export const AuditValidationStatusSchema = z.enum(AUDIT_VALIDATION_STATUSES);
export const WorkerStatusSchema = z.enum(WORKER_STATUSES);
export const OutcomeKindSchema = z.enum(OUTCOME_KINDS);
export const AuditDepthSchema = z.enum(AUDIT_DEPTHS);
export const AuditSurfaceCategorySchema = z.enum(AUDIT_SURFACE_CATEGORIES);
export const AuditSurfaceReviewStatusSchema = z.enum(
	AUDIT_SURFACE_REVIEW_STATUSES,
);
export const AuditFindingCategorySchema = z.enum(AUDIT_FINDING_CATEGORIES);
export const AuditFindingConfidenceSchema = z.enum(AUDIT_FINDING_CONFIDENCE);

export const ArtifactSchema = z.object({
	path: z.string().min(1),
	kind: z.string().min(1).optional(),
});

export const ValidationRunSchema = z.object({
	command: z.string().min(1),
	status: ValidationStatusSchema,
	summary: z.string().min(1),
});

export const AuditValidationRunSchema = z.object({
	command: z.string().min(1),
	status: AuditValidationStatusSchema,
	summary: z.string().min(1),
});

export const DecisionSchema = z.object({
	summary: z.string().min(1),
});

export const NoteSchema = z.object({
	note: z.string().min(1),
});

export const FollowUpSchema = z.object({
	summary: z.string().min(1),
	severity: z.string().min(1).optional(),
});

export const ReviewFindingSchema = z.object({
	summary: z.string().min(1),
});

export const AuditSurfaceSchema = z
	.object({
		name: z.string().min(1),
		category: AuditSurfaceCategorySchema,
		reviewStatus: AuditSurfaceReviewStatusSchema,
		evidence: z.array(z.string().min(1)).default([]),
		reason: z.string().min(1).optional(),
	})
	.superRefine((value, context) => {
		if (value.reviewStatus === "unreviewed") {
			if (!value.reason) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Unreviewed audit surfaces must include a reason explaining the coverage gap.",
					path: ["reason"],
				});
			}
			if (value.evidence.length > 0) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Unreviewed audit surfaces must not claim direct evidence lines.",
					path: ["evidence"],
				});
			}
			return;
		}

		if (value.evidence.length === 0) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Reviewed or spot-checked audit surfaces must include supporting evidence.",
				path: ["evidence"],
			});
		}
	});

export const ReviewedAuditSurfaceSchema = z.object({
	name: z.string().min(1),
	evidence: z.array(z.string().min(1)).min(1),
});

export const UnreviewedAuditSurfaceSchema = z.object({
	name: z.string().min(1),
	reason: z.string().min(1),
});

export const AuditCoverageSummarySchema = z.object({
	discoveredSurfaceCount: z.number().int().nonnegative(),
	reviewedSurfaceCount: z.number().int().nonnegative(),
	unreviewedSurfaceCount: z.number().int().nonnegative(),
	notes: z.array(z.string().min(1)).optional(),
});

export const AuditCoverageRubricSchema = z.object({
	fullAuditEligible: z.boolean(),
	directlyReviewedCategories: z.array(AuditSurfaceCategorySchema).default([]),
	spotCheckedCategories: z.array(AuditSurfaceCategorySchema).default([]),
	unreviewedCategories: z.array(AuditSurfaceCategorySchema).default([]),
	blockingReasons: z.array(z.string().min(1)).default([]),
});

export const AuditFindingSchema = z.object({
	title: z.string().min(1),
	category: AuditFindingCategorySchema,
	confidence: AuditFindingConfidenceSchema,
	severity: z.enum(["high", "medium", "low"]).optional(),
	evidence: z.array(z.string().min(1)).min(1),
	impact: z.string().min(1),
	remediation: z.string().min(1).optional(),
});

export const ReviewSchema = z.object({
	status: z.enum(REVIEW_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
});

export const ReviewerDecisionSchema = z.object({
	scope: z.enum(REVIEW_SCOPES),
	featureId: z
		.string()
		.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE)
		.optional(),
	reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
	status: z.enum(REVIEWER_DECISION_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
	followUps: z.array(FollowUpSchema).default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
});

export const OutcomeSchema = z.object({
	kind: OutcomeKindSchema,
	category: z.string().min(1).optional(),
	summary: z.string().min(1).optional(),
	resolutionHint: z.string().min(1).optional(),
	retryable: z.boolean().optional(),
	autoResolvable: z.boolean().optional(),
	needsHuman: z.boolean().optional(),
	replanReason: z.enum(REPLAN_REASONS).optional(),
	failedAssumption: z.string().min(1).optional(),
	recommendedAdjustment: z.string().min(1).optional(),
});

export const FeatureResultSchema = z.object({
	featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
	verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
	notes: z.array(NoteSchema).optional(),
	followUps: z.array(FollowUpSchema).optional(),
});

export const WorkerResultBaseSchema = z.object({
	contractVersion: z.literal("1"),
	summary: z.string().min(1),
	artifactsChanged: z.array(ArtifactSchema).default([]),
	validationRun: z.array(ValidationRunSchema).default([]),
	validationScope: z.enum(VALIDATION_SCOPES).optional(),
	reviewIterations: z.number().int().nonnegative().optional(),
	decisions: z.array(DecisionSchema).default([]),
	nextStep: z.string().min(1),
	featureResult: FeatureResultSchema,
	featureReview: ReviewSchema,
	finalReview: ReviewSchema.optional(),
});

export const WorkerResultSchema = z
	.discriminatedUnion("status", [
		WorkerResultBaseSchema.extend({
			status: z.literal("ok"),
			outcome: z
				.object({
					kind: z.literal("completed"),
					category: z.string().min(1).optional(),
					summary: z.string().min(1).optional(),
					resolutionHint: z.string().min(1).optional(),
					retryable: z.boolean().optional(),
					autoResolvable: z.boolean().optional(),
					needsHuman: z.boolean().optional(),
				})
				.optional(),
		}),
		WorkerResultBaseSchema.extend({
			status: z.literal("needs_input"),
			outcome: OutcomeSchema.refine(
				(value) => isNeedsInputOutcomeKind(value.kind),
				{
					message: "needs_input outcomes must not use 'completed'.",
				},
			),
		}),
	])
	.superRefine((value, context) => {
		if (
			value.status === "needs_input" &&
			value.outcome.kind === "replan_required" &&
			!hasStructuredReplanReason(value.outcome)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"replan_required outcomes must include replanReason, failedAssumption, and recommendedAdjustment.",
				path: ["outcome"],
			});
		}
	});

export const WorkerResultOkArgsSchema = WorkerResultBaseSchema.extend({
	status: z.literal("ok"),
	outcome: OutcomeSchema.optional(),
});

export const WorkerResultNeedsInputArgsSchema = WorkerResultBaseSchema.extend({
	status: z.literal("needs_input"),
	outcome: OutcomeSchema,
});

export const FeatureIdSchema = z
	.string()
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);

export const FeatureSchema = z.object({
	id: FeatureIdSchema,
	title: z.string().min(1),
	summary: z.string().min(1),
	status: FeatureStatusSchema.default("pending"),
	priority: z.enum(FEATURE_PRIORITIES).optional(),
	deferCandidate: z.boolean().optional(),
	fileTargets: z.array(z.string().min(1)).default([]),
	verification: z.array(z.string().min(1)).default([]),
	dependsOn: z.array(z.string().min(1)).optional(),
	blockedBy: z.array(z.string().min(1)).optional(),
});

export const ImplementationApproachSchema = z.object({
	chosenDirection: z.string().min(1),
	keyConstraints: z.array(z.string().min(1)).default([]),
	validationSignals: z.array(z.string().min(1)).default([]),
	sources: z.array(z.string().min(1)).default([]),
});

export const PlanningDecisionOptionSchema = z.object({
	label: z.string().min(1),
	tradeoffs: z.array(z.string().min(1)).default([]),
});

export const PlanningDecisionSchema = z.object({
	question: z.string().min(1),
	decisionMode: z.enum(DECISION_MODES).default("recommend_confirm"),
	decisionDomain: z.enum(DECISION_DOMAINS).default("architecture"),
	options: z.array(PlanningDecisionOptionSchema).min(1),
	recommendation: z.string().min(1),
	rationale: z.array(z.string().min(1)).default([]),
});

export const CompletionPolicySchema = z.object({
	minCompletedFeatures: z.number().int().positive().optional(),
});

export const DeliveryPolicySchema = z.object({
	priorityMode: z.enum(PRIORITY_MODES).default("balanced"),
	stopRule: z.enum(STOP_RULES).default("ship_when_clean"),
	deferAllowed: z.boolean().default(false),
});

export const ReplanRecordSchema = z.object({
	featureId: FeatureIdSchema.nullable().optional(),
	reason: z.enum(REPLAN_REASONS),
	summary: z.string().min(1),
	failedAssumption: z.string().min(1),
	recommendedAdjustment: z.string().min(1),
	recordedAt: z.string().min(1),
});

export const ClosureSchema = z.object({
	kind: z.enum(CLOSURE_KINDS),
	summary: z.string().min(1),
	recordedAt: z.string().min(1),
});

export const PlanSchema = z.object({
	summary: z.string().min(1),
	overview: z.string().min(1),
	requirements: z.array(z.string().min(1)).default([]),
	architectureDecisions: z.array(z.string().min(1)).default([]),
	features: z.array(FeatureSchema).min(1),
	goalMode: GoalModeSchema.default("implementation"),
	decompositionPolicy: DecompositionPolicySchema.default("atomic_feature"),
	completionPolicy: CompletionPolicySchema.optional(),
	deliveryPolicy: DeliveryPolicySchema.optional(),
	notes: z.array(z.string().min(1)).optional(),
});

export const PlanningContextSchema = z.object({
	repoProfile: z.array(z.string().min(1)).default([]),
	packageManager: PackageManagerSchema.optional(),
	packageManagerAmbiguous: z.boolean().default(false),
	research: z.array(z.string().min(1)).default([]),
	implementationApproach: ImplementationApproachSchema.optional(),
	decisionLog: z.array(PlanningDecisionSchema).default([]),
	replanLog: z.array(ReplanRecordSchema).default([]),
});

export const PlanArgsSchema = PlanSchema.omit({
	goalMode: true,
	decompositionPolicy: true,
}).extend({
	goalMode: GoalModeSchema.optional(),
	decompositionPolicy: DecompositionPolicySchema.optional(),
});

export const PlanningContextArgsSchema = PlanningContextSchema.partial();

export const WorkerResultArgsSchema = z
	.discriminatedUnion("status", [
		WorkerResultOkArgsSchema,
		WorkerResultNeedsInputArgsSchema,
	])
	.superRefine((value, context) => {
		if (
			value.status === "needs_input" &&
			value.outcome.kind === "replan_required" &&
			!hasStructuredReplanReason(value.outcome)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"replan_required outcomes must include replanReason, failedAssumption, and recommendedAdjustment.",
				path: ["outcome"],
			});
		}
	});

export const FlowReviewRecordFeatureArgsSchema = ReviewerDecisionSchema.extend({
	scope: z.literal("feature"),
	featureId: FeatureIdSchema,
});

export const FlowReviewRecordFinalArgsSchema = ReviewerDecisionSchema.omit({
	featureId: true,
})
	.extend({
		scope: z.literal("final"),
	})
	.strict();

export const ExecutionHistoryEntrySchema = z.object({
	featureId: z.string().min(1),
	status: z.string().min(1),
	summary: z.string().min(1),
	recordedAt: z.string().min(1),
	outcomeKind: z.string().min(1).nullable().optional(),
	outcome: OutcomeSchema.nullable().optional(),
	nextStep: z.string().min(1).nullable().optional(),
	validationRun: z.array(ValidationRunSchema).default([]),
	artifactsChanged: z.array(ArtifactSchema).default([]),
	decisions: z.array(DecisionSchema).default([]),
	featureResult: FeatureResultSchema.optional(),
	replanRecord: ReplanRecordSchema.optional(),
	reviewerDecision: ReviewerDecisionSchema.nullable().optional(),
	featureReview: ReviewSchema.optional(),
	finalReview: ReviewSchema.optional(),
});

export const SessionSchema = z.object({
	version: z.literal(1),
	id: z.string().min(1),
	goal: z.string().min(1),
	status: SessionStatusSchema,
	approval: ApprovalStatusSchema,
	planning: PlanningContextSchema,
	plan: PlanSchema.nullable(),
	execution: z.object({
		activeFeatureId: z.string().min(1).nullable(),
		lastFeatureId: z.string().min(1).nullable(),
		lastSummary: z.string().min(1).nullable(),
		lastOutcomeKind: z.string().min(1).nullable(),
		lastOutcome: OutcomeSchema.nullable().default(null),
		lastNextStep: z.string().min(1).nullable().default(null),
		lastFeatureResult: FeatureResultSchema.nullable().default(null),
		lastReviewerDecision: ReviewerDecisionSchema.nullable().default(null),
		lastValidationRun: z.array(ValidationRunSchema).default([]),
		history: z.array(ExecutionHistoryEntrySchema).default([]),
	}),
	closure: ClosureSchema.nullable().default(null),
	notes: z.array(z.string().min(1)).default([]),
	artifacts: z.array(ArtifactSchema).default([]),
	timestamps: z.object({
		createdAt: z.string().min(1),
		updatedAt: z.string().min(1),
		approvedAt: z.string().min(1).nullable(),
		completedAt: z.string().min(1).nullable(),
	}),
});

export const AuditReportBaseSchema = z.object({
	requestedDepth: AuditDepthSchema,
	achievedDepth: AuditDepthSchema,
	repoSummary: z.string().min(1),
	overallVerdict: z.string().min(1),
	discoveredSurfaces: z.array(AuditSurfaceSchema).min(1),
	validationRun: z.array(AuditValidationRunSchema).min(1),
	findings: z.array(AuditFindingSchema).default([]),
	nextSteps: z.array(z.string().min(1)).optional(),
});

export const AuditReportSchema = AuditReportBaseSchema.extend({
	coverageSummary: AuditCoverageSummarySchema,
	reviewedSurfaces: z.array(ReviewedAuditSurfaceSchema),
	unreviewedSurfaces: z.array(UnreviewedAuditSurfaceSchema),
	coverageRubric: AuditCoverageRubricSchema,
}).superRefine((value, context) => {
	const reviewed = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus !== "unreviewed",
	);
	const unreviewed = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "unreviewed",
	);
	const directlyReviewed = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "directly_reviewed",
	);
	const spotChecked = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "spot_checked",
	);

	if (
		value.coverageSummary.discoveredSurfaceCount !==
		value.discoveredSurfaces.length
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageSummary.discoveredSurfaceCount must match discoveredSurfaces length.",
			path: ["coverageSummary", "discoveredSurfaceCount"],
		});
	}
	if (value.coverageSummary.reviewedSurfaceCount !== reviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageSummary.reviewedSurfaceCount must match the number of non-unreviewed discovered surfaces.",
			path: ["coverageSummary", "reviewedSurfaceCount"],
		});
	}
	if (value.coverageSummary.unreviewedSurfaceCount !== unreviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageSummary.unreviewedSurfaceCount must match the number of unreviewed discovered surfaces.",
			path: ["coverageSummary", "unreviewedSurfaceCount"],
		});
	}
	if (value.reviewedSurfaces.length !== reviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"reviewedSurfaces must enumerate every reviewed or spot-checked discovered surface.",
			path: ["reviewedSurfaces"],
		});
	}
	if (value.unreviewedSurfaces.length !== unreviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"unreviewedSurfaces must enumerate every unreviewed discovered surface.",
			path: ["unreviewedSurfaces"],
		});
	}

	const reviewedNames = new Set(
		value.reviewedSurfaces.map((surface) => surface.name),
	);
	for (const surface of reviewed) {
		if (!reviewedNames.has(surface.name)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Reviewed surface '${surface.name}' is missing from reviewedSurfaces.`,
				path: ["reviewedSurfaces"],
			});
		}
	}
	const unreviewedNames = new Set(
		value.unreviewedSurfaces.map((surface) => surface.name),
	);
	for (const surface of unreviewed) {
		if (!unreviewedNames.has(surface.name)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Unreviewed surface '${surface.name}' is missing from unreviewedSurfaces.`,
				path: ["unreviewedSurfaces"],
			});
		}
	}

	const allDirectlyReviewed =
		directlyReviewed.length === value.discoveredSurfaces.length &&
		spotChecked.length === 0 &&
		unreviewed.length === 0;

	if (value.coverageRubric.fullAuditEligible !== allDirectlyReviewed) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageRubric.fullAuditEligible must match whether every discovered surface is directly reviewed.",
			path: ["coverageRubric", "fullAuditEligible"],
		});
	}

	if (value.achievedDepth === "full_audit" && !allDirectlyReviewed) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"achievedDepth cannot be full_audit unless every discovered surface is directly reviewed.",
			path: ["achievedDepth"],
		});
	}

	if (
		value.coverageRubric.fullAuditEligible &&
		value.coverageRubric.blockingReasons.length > 0
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageRubric.blockingReasons must be empty when fullAuditEligible is true.",
			path: ["coverageRubric", "blockingReasons"],
		});
	}
});

export type Artifact = z.infer<typeof ArtifactSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type AuditReportArgs = z.input<typeof AuditReportBaseSchema>;
export type AuditSurface = z.infer<typeof AuditSurfaceSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type FlowReviewRecordFeatureArgs = z.input<
	typeof FlowReviewRecordFeatureArgsSchema
>;
export type FlowReviewRecordFinalArgs = z.input<
	typeof FlowReviewRecordFinalArgsSchema
>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanSchema>;
export type PlanArgs = z.input<typeof PlanArgsSchema>;
export type PlanningContext = z.infer<typeof PlanningContextSchema>;
export type PlanningContextArgs = z.input<typeof PlanningContextArgsSchema>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type ReviewerDecision = z.infer<typeof ReviewerDecisionSchema>;
export type ReviewerDecisionInput = z.input<typeof ReviewerDecisionSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type WorkerResultArgs = z.input<typeof WorkerResultArgsSchema>;
