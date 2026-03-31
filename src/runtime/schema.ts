import { z } from "zod";

export const FeatureStatusSchema = z.enum(["pending", "in_progress", "completed", "blocked"]);
export const SessionStatusSchema = z.enum(["planning", "ready", "running", "blocked", "completed"]);
export const ApprovalStatusSchema = z.enum(["pending", "approved"]);
export const GoalModeSchema = z.enum(["implementation", "review", "review_and_fix"]);
export const DecompositionPolicySchema = z.enum(["atomic_feature", "iterative_refinement", "open_ended"]);
export const ValidationStatusSchema = z.enum(["passed", "failed", "failed_existing", "partial"]);
export const WorkerStatusSchema = z.enum(["ok", "needs_input"]);
export const OutcomeKindSchema = z.enum([
  "completed",
  "replan_required",
  "blocked_external",
  "needs_operator_input",
  "contract_error",
]);

export const ArtifactSchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1).optional(),
});

export const ValidationRunSchema = z.object({
  command: z.string().min(1),
  status: ValidationStatusSchema,
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

export const ReviewSchema = z.object({
  status: z.enum(["passed", "failed", "needs_followup"]),
  summary: z.string().min(1),
  blockingFindings: z.array(ReviewFindingSchema).default([]),
});

export const OutcomeSchema = z.object({
  kind: OutcomeKindSchema,
  category: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  resolutionHint: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  autoResolvable: z.boolean().optional(),
  needsHuman: z.boolean().optional(),
});

export const FeatureResultSchema = z.object({
  featureId: z.string().min(1),
  verificationStatus: z.enum(["passed", "partial", "failed", "not_recorded"]).optional(),
  notes: z.array(NoteSchema).optional(),
  followUps: z.array(FollowUpSchema).optional(),
});

const WorkerResultBaseSchema = z.object({
  contractVersion: z.literal("1"),
  summary: z.string().min(1),
  artifactsChanged: z.array(ArtifactSchema).default([]),
  validationRun: z.array(ValidationRunSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  nextStep: z.string().min(1),
  featureResult: FeatureResultSchema,
  featureReview: ReviewSchema,
  finalReview: ReviewSchema.optional(),
});

export const WorkerResultSchema = z.discriminatedUnion("status", [
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
    outcome: OutcomeSchema.refine((value) => value.kind !== "completed", {
      message: "needs_input outcomes must not use 'completed'.",
    }),
  }),
]);

export const FeatureSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Feature ids must be lowercase kebab-case"),
  title: z.string().min(1),
  summary: z.string().min(1),
  status: FeatureStatusSchema.default("pending"),
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

export const CompletionPolicySchema = z.object({
  minCompletedFeatures: z.number().int().positive().optional(),
  requireFinalReview: z.boolean().optional(),
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
  notes: z.array(z.string().min(1)).optional(),
});

export const PlanningContextSchema = z.object({
  repoProfile: z.array(z.string().min(1)).default([]),
  research: z.array(z.string().min(1)).default([]),
  implementationApproach: ImplementationApproachSchema.optional(),
});

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
    lastValidationRun: z.array(ValidationRunSchema).default([]),
    history: z.array(ExecutionHistoryEntrySchema).default([]),
  }),
  notes: z.array(z.string().min(1)).default([]),
  artifacts: z.array(ArtifactSchema).default([]),
  timestamps: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    approvedAt: z.string().min(1).nullable(),
    completedAt: z.string().min(1).nullable(),
  }),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanningContext = z.infer<typeof PlanningContextSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
