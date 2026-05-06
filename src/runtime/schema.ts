// Flow runtime schema owner: session, plan, review, and worker payload strictness remains normative here.

import { z } from "zod";
import {
	CLOSURE_KINDS,
	DECOMPOSITION_POLICIES,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	FEATURE_PRIORITIES,
	FINAL_REVIEW_POLICIES,
	GOAL_MODES,
	PRIORITY_MODES,
	REPLAN_REASONS,
	REVIEW_PURPOSES,
	REVIEWER_DECISION_STATUSES,
	STOP_RULES,
	VALIDATION_SCOPES,
} from "./constants";
import {
	FollowUpSchema,
	finalReviewInputSharedShape,
	finalReviewPersistedSharedShape,
	ReviewFindingClosureSchema,
	ReviewFindingSchema,
	ReviewSchema,
	ReviewScopeLedgerEntrySchema,
	ReviewScopeTargetSchema,
} from "./schema-review-shared";
import {
	addReplanRequiredIssueIfNeeded,
	isNeedsInputOutcomeKind,
} from "./schema-worker-result-refinements";
import {
	ArtifactSchema,
	DecisionSchema,
	FeatureResultSchema,
	OutcomeSchema,
	ValidationRunSchema,
} from "./schema-worker-result-shared";

export {
	BehaviorCheckResultSchema,
	BehaviorCheckSchema,
	BehaviorRiskClassSchema,
	ReviewScopeAccountingStatusSchema,
	ReviewScopeLedgerEntrySchema,
	ReviewScopeTargetSchema,
	ValidationCoverageSchema,
} from "./schema-review-shared";
export {
	ArtifactSchema,
	DecisionSchema,
	FeatureResultSchema,
	NoteSchema,
	OutcomeKindSchema,
	OutcomeSchema,
	ValidationRunSchema,
	ValidationStatusSchema,
} from "./schema-worker-result-shared";

import {
	EvidencePacketArraySchema,
	EvidencePacketReferenceArraySchema,
} from "./schema-evidence-packets";
import {
	ImplementationApproachSchema,
	PlanningDecisionSchema,
	StackProfileSchema,
	StandardsProfileSchema,
} from "./schema-planning-profiles";

export {
	EvidencePacketArraySchema,
	EvidencePacketPurposeSchema,
	EvidencePacketReferenceArraySchema,
	EvidencePacketReferenceSchema,
	EvidencePacketSchema,
	EvidencePacketValidationRunSchema,
	EvidencePacketValidationStatusSchema,
	FlowContextLaneSchema,
} from "./schema-evidence-packets";

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

function addApprovedBehaviorDecisionConsistencyChecks(
	value: {
		status: string;
		behaviorChecks?: Array<{ result: string }> | undefined;
	},
	context: z.RefinementCtx,
): void {
	if (
		value.status === "approved" &&
		value.behaviorChecks?.some((check) => check.result === "needs_fix")
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["behaviorChecks"],
			message:
				"Approved final decisions cannot include behaviorChecks with result 'needs_fix'.",
		});
	}
}

export const FinalReviewSchema = ReviewSchema.extend({
	...finalReviewInputSharedShape,
	evidencePackets: EvidencePacketArraySchema.optional(),
});

export const PersistedFinalReviewSchema = ReviewSchema.extend({
	...finalReviewPersistedSharedShape,
	evidencePackets: EvidencePacketArraySchema.optional(),
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
	evidencePackets: EvidencePacketReferenceArraySchema.optional(),
});

export const FinalReviewerDecisionSchema = z
	.object({
		scope: z.literal("final"),
		reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
		status: z.enum(REVIEWER_DECISION_STATUSES),
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
		followUps: z.array(FollowUpSchema).default([]),
		...finalReviewInputSharedShape,
		reviewScopeLedger: z.array(ReviewScopeLedgerEntrySchema).optional(),
		evidencePackets: EvidencePacketArraySchema.optional(),
	})
	.strict()
	.superRefine(addApprovedBehaviorDecisionConsistencyChecks);

export const PersistedFinalReviewerDecisionSchema = z
	.object({
		scope: z.literal("final"),
		reviewPurpose: z.enum(REVIEW_PURPOSES).optional(),
		status: z.enum(REVIEWER_DECISION_STATUSES),
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
		followUps: z.array(FollowUpSchema).default([]),
		...finalReviewPersistedSharedShape,
		reviewScopeLedger: z.array(ReviewScopeLedgerEntrySchema).optional(),
		evidencePackets: EvidencePacketArraySchema.optional(),
	})
	.strict()
	.superRefine(addApprovedBehaviorDecisionConsistencyChecks);

export const ReviewerDecisionSchema = z.discriminatedUnion("scope", [
	FeatureReviewerDecisionSchema,
	PersistedFinalReviewerDecisionSchema,
]);

export const WorkerResultBaseSchema = z.object({
	contractVersion: z.literal("1"),
	summary: z.string().min(1),
	artifactsChanged: z.array(ArtifactSchema).default([]),
	validationRun: z.array(ValidationRunSchema).default([]),
	validationScope: z.enum(VALIDATION_SCOPES).optional(),
	reviewIterations: z.number().int().nonnegative().optional(),
	decisions: z.array(DecisionSchema).default([]),
	reviewFindingClosures: z.array(ReviewFindingClosureSchema).optional(),
	reviewScopeLedger: z.array(ReviewScopeLedgerEntrySchema).optional(),
	evidencePackets: EvidencePacketReferenceArraySchema.optional(),
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
		addReplanRequiredIssueIfNeeded(value, context);
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
	reviewScope: z.array(ReviewScopeTargetSchema).optional(),
	verification: z.array(z.string().min(1)).default([]),
	dependsOn: z.array(z.string().min(1)).optional(),
	blockedBy: z.array(z.string().min(1)).optional(),
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
		addReplanRequiredIssueIfNeeded(value, context);
	});

export const FlowReviewRecordFeatureArgsSchema =
	FeatureReviewerDecisionSchema.strict();

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
	reviewScopeLedger: z.array(ReviewScopeLedgerEntrySchema).optional(),
	featureResult: FeatureResultSchema.optional(),
	replanRecord: ReplanRecordSchema.optional(),
	reviewerDecision: ReviewerDecisionSchema.nullable().optional(),
	evidencePackets: EvidencePacketReferenceArraySchema.optional(),
	featureReview: ReviewSchema.optional(),
	finalReview: PersistedFinalReviewSchema.optional(),
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

export {
	EvidenceConfidenceSchema,
	ImplementationApproachSchema,
	PlanningDecisionOptionSchema,
	PlanningDecisionSchema,
	StackProfileEntrySchema,
	StackProfileSchema,
	StandardsGapSchema,
	StandardsProfileSchema,
	StandardsRuleSchema,
	StandardsSourceSchema,
} from "./schema-planning-profiles";

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
export type { EvidencePacket } from "./schema-evidence-packets";
export type ReviewerDecision = z.infer<typeof ReviewerDecisionSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type WorkerResultArgs = z.input<typeof WorkerResultArgsSchema>;
