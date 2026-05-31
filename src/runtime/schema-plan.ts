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
	STOP_RULES,
} from "./constants";
import { EvidencePacketArraySchema } from "./schema-evidence-packets";
import {
	ImplementationApproachSchema,
	PlanningDecisionSchema,
	StackProfileSchema,
	StandardsProfileSchema,
} from "./schema-planning-profiles";
import { ReviewScopeTargetSchema } from "./schema-review-shared";

const FeatureStatusSchema = z.enum([
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
const GoalModeSchema = z.enum(GOAL_MODES);
const DecompositionPolicySchema = z.enum(DECOMPOSITION_POLICIES);
export const PackageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun"]);

const FeatureIdSchema = z
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

const CompletionPolicySchema = z.object({
	minCompletedFeatures: z.number().int().positive().optional(),
});

const DeliveryPolicySchema = z.object({
	priorityMode: z.enum(PRIORITY_MODES).default("balanced"),
	stopRule: z.enum(STOP_RULES).default("ship_when_clean"),
	deferAllowed: z.boolean().default(false),
	finalReviewPolicy: z.enum(FINAL_REVIEW_POLICIES).default("detailed"),
	strictReview: z.boolean().optional(),
});

export const ReplanRecordSchema = z.object({
	featureId: FeatureIdSchema.nullable().optional(),
	reason: z.enum(REPLAN_REASONS),
	summary: z.string().min(1),
	failedAssumption: z.string().min(1),
	recommendedAdjustment: z.string().min(1),
	recordedAt: z.string().min(1),
});

export const ReviewFindingPlanningContextSchema = z.object({
	findingRef: z.string().min(1),
	summary: z.string().min(1),
	sourceRefs: z.array(z.string().min(1)).min(1),
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
	reviewFindings: z.array(ReviewFindingPlanningContextSchema).default([]),
	evidencePackets: EvidencePacketArraySchema.optional(),
});

export const PlanArgsSchema = PlanSchema.omit({
	goalMode: true,
	decompositionPolicy: true,
})
	.extend({
		goalMode: GoalModeSchema.optional(),
		decompositionPolicy: DecompositionPolicySchema.optional(),
	})
	.strict();

export const PlanningContextArgsSchema =
	PlanningContextSchema.partial().strict();
