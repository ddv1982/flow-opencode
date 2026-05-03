// Flow runtime schema owner: session, plan, review, and worker payload strictness remains normative here.

import { z } from "zod";
import {
	CLOSURE_KINDS,
	DECISION_DOMAINS,
	DECISION_MODES,
	DECOMPOSITION_POLICIES,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	FEATURE_PRIORITIES,
	FINAL_REVIEW_POLICIES,
	FINAL_REVIEW_SURFACES,
	GOAL_MODES,
	NEEDS_INPUT_OUTCOME_KINDS,
	OUTCOME_KINDS,
	PRIORITY_MODES,
	REPLAN_REASONS,
	REVIEW_FINDING_CLOSURE_STATUSES,
	REVIEW_PURPOSES,
	REVIEW_STATUSES,
	REVIEWER_DECISION_STATUSES,
	STOP_RULES,
	VALIDATION_SCOPES,
	VALIDATION_STATUSES,
	VERIFICATION_STATUSES,
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
export const OutcomeKindSchema = z.enum(OUTCOME_KINDS);
export const EvidenceConfidenceSchema = z.enum(["low", "medium", "high"]);

export const StackProfileEntrySchema = z
	.object({
		name: z.string().min(1),
		evidenceRefs: z.array(z.string().min(1)).default([]),
		confidence: EvidenceConfidenceSchema.default("medium"),
	})
	.strict();

export const StackProfileSchema = z
	.object({
		languages: z.array(StackProfileEntrySchema).default([]),
		frameworks: z.array(StackProfileEntrySchema).default([]),
		runtimes: z.array(StackProfileEntrySchema).default([]),
		packageManagers: z.array(StackProfileEntrySchema).default([]),
		tools: z.array(StackProfileEntrySchema).default([]),
	})
	.strict();

export const StandardsSourceSchema = z
	.object({
		title: z.string().min(1),
		sourceType: z.enum(["local", "official", "external"]),
		reference: z.string().min(1),
		confidence: EvidenceConfidenceSchema.default("medium"),
	})
	.strict();

export const StandardsRuleSchema = z
	.object({
		summary: z.string().min(1),
		sourceRefs: z.array(z.string().min(1)).default([]),
		priority: z.enum(["user", "local", "official", "external"]),
	})
	.strict();

export const StandardsGapSchema = z
	.object({
		stackItem: z.string().min(1),
		reason: z.string().min(1),
		suggestedResearch: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const StandardsProfileSchema = z
	.object({
		localGuidelines: z.array(StandardsSourceSchema).default([]),
		externalGuidance: z.array(StandardsSourceSchema).default([]),
		rules: z.array(StandardsRuleSchema).default([]),
		gaps: z.array(StandardsGapSchema).default([]),
		precedence: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const ArtifactSchema = z.object({
	path: z.string().min(1),
	kind: z.string().min(1).optional(),
});

export const ValidationRunSchema = z.object({
	command: z.string().min(1),
	status: ValidationStatusSchema,
	summary: z.string().min(1),
});

const EVIDENCE_PACKET_VALIDATION_STATUSES = [
	...VALIDATION_STATUSES,
	"not_run",
] as const;

export const EvidencePacketValidationStatusSchema = z.enum(
	EVIDENCE_PACKET_VALIDATION_STATUSES,
);

export const EvidencePacketValidationRunSchema = z.object({
	command: z.string().min(1),
	status: EvidencePacketValidationStatusSchema,
	summary: z.string().min(1),
});

export const EvidencePacketPurposeSchema = z.enum([
	"planning",
	"review",
	"audit",
	"validation",
	"general",
]);

export const EvidencePacketSchema = z
	.object({
		id: z.string().min(1),
		purpose: EvidencePacketPurposeSchema.optional(),
		summary: z.string().min(1),
		sourceRefs: z.array(z.string().min(1)).optional(),
		highlights: z.array(z.string().min(1)).optional(),
		selectedContext: z.array(z.string().min(1)).optional(),
		excludedContext: z.array(z.string().min(1)).optional(),
		codemapSummaries: z.array(z.string().min(1)).optional(),
		sliceSummaries: z.array(z.string().min(1)).optional(),
		relationshipHypotheses: z.array(z.string().min(1)).optional(),
		ambiguities: z.array(z.string().min(1)).optional(),
		knownExclusions: z.array(z.string().min(1)).optional(),
		alreadyCoveredFindings: z.array(z.string().min(1)).optional(),
		validationEvidence: z.array(EvidencePacketValidationRunSchema).optional(),
	})
	.strict()
	.readonly();

export const EvidencePacketArraySchema = z.array(EvidencePacketSchema);

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

export const ReviewFindingClosureSchema = z
	.object({
		findingRef: z.string().min(1),
		status: z.enum(REVIEW_FINDING_CLOSURE_STATUSES),
		fixRefs: z.array(z.string().min(1)).default([]),
		testRefs: z.array(z.string().min(1)).default([]),
		validationRefs: z.array(z.string().min(1)).default([]),
		residualRisk: z.string().min(1),
	})
	.strict();

export const ReviewFindingSchema = z.object({
	summary: z.string().min(1),
});

export const ReviewDepthSchema = z.enum(FINAL_REVIEW_POLICIES);
export const ReviewSurfaceSchema = z.enum(FINAL_REVIEW_SURFACES);
export const FinalReviewEvidenceRefsSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)).default([]),
		validationCommands: z.array(z.string().min(1)).default([]),
	})
	.strict()
	.default({ changedArtifacts: [], validationCommands: [] });

export const ReviewSchema = z.object({
	status: z.enum(REVIEW_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
});

export const FinalReviewSchema = ReviewSchema.extend({
	reviewDepth: ReviewDepthSchema,
	reviewedSurfaces: z.array(ReviewSurfaceSchema).default([]),
	evidenceSummary: z.string().min(1).optional(),
	validationAssessment: z.string().min(1).optional(),
	evidenceRefs: FinalReviewEvidenceRefsSchema,
	evidencePackets: EvidencePacketArraySchema.optional(),
	integrationChecks: z.array(z.string().min(1)).default([]),
	regressionChecks: z.array(z.string().min(1)).default([]),
	remainingGaps: z.array(z.string().min(1)).default([]),
});

export const FeatureReviewerDecisionSchema = z.object({
	scope: z.literal("feature"),
	featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
	reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
	status: z.enum(REVIEWER_DECISION_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
	followUps: z.array(FollowUpSchema).default([]),
	suggestedValidation: z.array(z.string().min(1)).default([]),
});

export const FinalReviewerDecisionSchema = z
	.object({
		scope: z.literal("final"),
		reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
		reviewDepth: ReviewDepthSchema,
		status: z.enum(REVIEWER_DECISION_STATUSES),
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
		followUps: z.array(FollowUpSchema).default([]),
		suggestedValidation: z.array(z.string().min(1)).default([]),
		reviewedSurfaces: z.array(ReviewSurfaceSchema).default([]),
		evidenceSummary: z.string().min(1).optional(),
		validationAssessment: z.string().min(1).optional(),
		evidenceRefs: FinalReviewEvidenceRefsSchema,
		evidencePackets: EvidencePacketArraySchema.optional(),
		integrationChecks: z.array(z.string().min(1)).default([]),
		regressionChecks: z.array(z.string().min(1)).default([]),
		remainingGaps: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const ReviewerDecisionSchema = z.discriminatedUnion("scope", [
	FeatureReviewerDecisionSchema,
	FinalReviewerDecisionSchema,
]);

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
	reviewFindingClosures: z.array(ReviewFindingClosureSchema).optional(),
	nextStep: z.string().min(1),
	featureResult: FeatureResultSchema,
	featureReview: ReviewSchema,
	finalReview: FinalReviewSchema.optional(),
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
	finalReviewPolicy: z.enum(FINAL_REVIEW_POLICIES).default("detailed"),
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
	stackProfile: StackProfileSchema.optional(),
	standardsProfile: StandardsProfileSchema.optional(),
	research: z.array(z.string().min(1)).default([]),
	implementationApproach: ImplementationApproachSchema.optional(),
	decisionLog: z.array(PlanningDecisionSchema).default([]),
	replanLog: z.array(ReplanRecordSchema).default([]),
	evidencePackets: EvidencePacketArraySchema.optional(),
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

export const FlowReviewRecordFeatureArgsSchema = FeatureReviewerDecisionSchema;

export const FlowReviewRecordFinalArgsSchema = FinalReviewerDecisionSchema;

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
	reviewFindingClosures: z.array(ReviewFindingClosureSchema).default([]),
	featureResult: FeatureResultSchema.optional(),
	replanRecord: ReplanRecordSchema.optional(),
	reviewerDecision: ReviewerDecisionSchema.nullable().optional(),
	featureReview: ReviewSchema.optional(),
	finalReview: FinalReviewSchema.optional(),
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
export type StackProfile = z.infer<typeof StackProfileSchema>;
export type StandardsProfile = z.infer<typeof StandardsProfileSchema>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;
export type ReviewerDecision = z.infer<typeof ReviewerDecisionSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type WorkerResultArgs = z.input<typeof WorkerResultArgsSchema>;
