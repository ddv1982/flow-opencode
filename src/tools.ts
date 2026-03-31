import { tool } from "@opencode-ai/plugin";
import { loadSession, saveSession, createSession, deleteSession } from "./runtime/session";
import { applyPlan, approvePlan, completeRun, recordReviewerDecision, resetFeature, selectPlanFeatures, startRun } from "./runtime/transitions";
import { summarizeSession } from "./runtime/summary";
import { DECOMPOSITION_POLICIES, GOAL_MODES, OUTCOME_KINDS, REVIEW_STATUSES, VALIDATION_STATUSES, VERIFICATION_STATUSES, WORKER_STATUSES } from "./runtime/contracts";

const z = tool.schema;
const featureIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Feature ids must be lowercase kebab-case");

const PlanArgsSchema = z.object({
  summary: z.string().min(1),
  overview: z.string().min(1),
  requirements: z.array(z.string().min(1)).default([]),
  architectureDecisions: z.array(z.string().min(1)).default([]),
  features: z.array(
    z.object({
      id: featureIdSchema,
      title: z.string().min(1),
      summary: z.string().min(1),
      fileTargets: z.array(z.string().min(1)).default([]),
      verification: z.array(z.string().min(1)).default([]),
      dependsOn: z.array(z.string().min(1)).optional(),
      blockedBy: z.array(z.string().min(1)).optional(),
    }),
  ).min(1),
  goalMode: z.enum(GOAL_MODES).optional(),
  decompositionPolicy: z.enum(DECOMPOSITION_POLICIES).optional(),
  completionPolicy: z
    .object({
      minCompletedFeatures: z.number().int().positive().optional(),
      requireFinalReview: z.boolean().optional(),
    })
    .optional(),
  notes: z.array(z.string().min(1)).optional(),
});

const PlanningContextArgsSchema = z.object({
  repoProfile: z.array(z.string().min(1)).optional(),
  research: z.array(z.string().min(1)).optional(),
  implementationApproach: z
    .object({
      chosenDirection: z.string().min(1),
      keyConstraints: z.array(z.string().min(1)).default([]),
      validationSignals: z.array(z.string().min(1)).default([]),
      sources: z.array(z.string().min(1)).default([]),
    })
    .optional(),
});

const WorkerResultArgsShape = {
  contractVersion: z.literal("1"),
  status: z.enum(WORKER_STATUSES),
  summary: z.string().min(1),
  artifactsChanged: z.array(z.object({ path: z.string().min(1), kind: z.string().min(1).optional() })).default([]),
  validationRun: z
    .array(
      z.object({
        command: z.string().min(1),
        status: z.enum(VALIDATION_STATUSES),
        summary: z.string().min(1),
      }),
    )
    .default([]),
  validationScope: z.enum(["targeted", "broad"]).optional(),
  reviewIterations: z.number().int().nonnegative().optional(),
  decisions: z.array(z.object({ summary: z.string().min(1) })).default([]),
  nextStep: z.string().min(1),
  outcome: z
    .object({
      kind: z.enum(OUTCOME_KINDS),
      category: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      resolutionHint: z.string().min(1).optional(),
      retryable: z.boolean().optional(),
      autoResolvable: z.boolean().optional(),
      needsHuman: z.boolean().optional(),
    })
    .optional(),
  featureResult: z.object({
    featureId: z.string().min(1),
    verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
    notes: z.array(z.object({ note: z.string().min(1) })).optional(),
    followUps: z.array(z.object({ summary: z.string().min(1), severity: z.string().min(1).optional() })).optional(),
  }),
  featureReview: z.object({
    status: z.enum(REVIEW_STATUSES),
    summary: z.string().min(1),
    blockingFindings: z.array(z.object({ summary: z.string().min(1) })).default([]),
  }),
  finalReview: z
    .object({
      status: z.enum(REVIEW_STATUSES),
      summary: z.string().min(1),
      blockingFindings: z.array(z.object({ summary: z.string().min(1) })).default([]),
    })
    .optional(),
};

const FlowStatusArgsShape = {};

const FlowPlanStartArgsShape = {
  goal: z.string().min(1).optional(),
  repoProfile: z.array(z.string().min(1)).optional(),
};

const FlowPlanApplyArgsShape = {
  plan: PlanArgsSchema,
  planning: PlanningContextArgsSchema.optional(),
};

const FlowPlanApproveArgsShape = {
  featureIds: z.array(featureIdSchema).optional(),
};

const FlowPlanSelectArgsShape = {
  featureIds: z.array(featureIdSchema),
};

const FlowRunStartArgsShape = {
  featureId: featureIdSchema.optional(),
};

const FlowReviewRecordFeatureArgsShape = {
  scope: z.literal("feature"),
  featureId: featureIdSchema,
  status: z.enum(["approved", "needs_fix", "blocked"]),
  summary: z.string().min(1),
  blockingFindings: z.array(z.object({ summary: z.string().min(1) })).default([]),
  followUps: z.array(z.object({ summary: z.string().min(1), severity: z.string().min(1).optional() })).default([]),
  suggestedValidation: z.array(z.string().min(1)).default([]),
};

const FlowReviewRecordFinalArgsShape = {
  scope: z.literal("final"),
  status: z.enum(["approved", "needs_fix", "blocked"]),
  summary: z.string().min(1),
  blockingFindings: z.array(z.object({ summary: z.string().min(1) })).default([]),
  followUps: z.array(z.object({ summary: z.string().min(1), severity: z.string().min(1).optional() })).default([]),
  suggestedValidation: z.array(z.string().min(1)).default([]),
};

const FlowResetFeatureArgsShape = {
  featureId: featureIdSchema,
};

function parseFeatureIds(raw?: string[]): string[] {
  return (raw ?? []).map((value) => value.trim()).filter(Boolean);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createTools(_ctx: unknown) {
  return {
    flow_status: tool({
      description: "Show the active Flow session summary",
      args: FlowStatusArgsShape,
      async execute(_args: any, context: any) {
        const session = await loadSession(context.worktree);
        return toJson(summarizeSession(session));
      },
    }),

    flow_plan_start: tool({
      description: "Create or refresh the active Flow planning session",
      args: FlowPlanStartArgsShape,
      async execute(args: any, context: any) {
        const input = args as { goal?: string; repoProfile?: string[] };
        const existing = await loadSession(context.worktree);

        if (!input.goal && !existing) {
          return toJson({
            status: "missing_goal",
            summary: "Provide a goal to create a new Flow plan.",
            nextCommand: "/flow-plan <goal>",
          });
        }

        const goal = input.goal ?? existing!.goal;
        const isNewGoal = Boolean(existing && input.goal && input.goal !== existing.goal);
        const base =
          !existing || existing.status === "completed" || isNewGoal
            ? createSession(goal, { repoProfile: input.repoProfile })
            : {
                ...existing,
                goal,
                status: "planning" as const,
                approval: "pending" as const,
                plan: null,
                planning: {
                  ...existing.planning,
                  repoProfile: input.repoProfile ?? existing.planning.repoProfile,
                },
                execution: {
                  ...existing.execution,
                  activeFeatureId: null,
                  lastFeatureId: null,
                  lastSummary: null,
                  lastOutcomeKind: null,
                  lastOutcome: null,
                  lastNextStep: null,
                  lastFeatureResult: null,
                  lastReviewerDecision: null,
                  lastValidationRun: [],
                },
                notes: [],
                artifacts: [],
                timestamps: {
                  ...existing.timestamps,
                  approvedAt: null,
                  completedAt: null,
                },
              };

        const session = await saveSession(context.worktree, base);
        return toJson({
          status: "ok",
          summary: `Planning session ready for goal: ${session.goal}`,
          session: summarizeSession(session).session,
        });
      },
    }),

    flow_plan_apply: tool({
      description: "Persist a Flow draft plan into the active session",
      args: FlowPlanApplyArgsShape,
      async execute(args: any, context: any) {
        const input = args as {
          plan: unknown;
          planning?: {
            repoProfile?: string[];
            research?: string[];
            implementationApproach?: {
              chosenDirection: string;
              keyConstraints: string[];
              validationSignals: string[];
              sources: string[];
            };
          };
        };
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({
            status: "missing_session",
            summary: "No active Flow planning session exists.",
            nextCommand: "/flow-plan <goal>",
          });
        }

        const result = applyPlan(session, input.plan, input.planning);
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: "Draft plan saved.",
          session: summarizeSession(saved).session,
        });
      },
    }),

    flow_plan_approve: tool({
      description: "Approve the active Flow draft plan",
      args: FlowPlanApproveArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureIds?: string[] };
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists." });
        }

        const result = approvePlan(session, parseFeatureIds(input.featureIds));
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: "Plan approved.",
          session: summarizeSession(saved).session,
        });
      },
    }),

    flow_plan_select_features: tool({
      description: "Keep only selected features in the active Flow draft plan",
      args: FlowPlanSelectArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureIds: string[] };
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists." });
        }

        const result = selectPlanFeatures(session, parseFeatureIds(input.featureIds));
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: "Draft plan narrowed.",
          session: summarizeSession(saved).session,
        });
      },
    }),

    flow_run_start: tool({
      description: "Start the next runnable Flow feature",
      args: FlowRunStartArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureId?: string };
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists.", nextCommand: "/flow-plan <goal>" });
        }

        const result = startRun(session, input.featureId);
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value.session);
        return toJson({
          status: result.value.reason === "complete" ? "complete" : result.value.feature ? "ok" : "blocked",
          summary: summarizeSession(saved).summary,
          session: summarizeSession(saved).session,
          feature: result.value.feature,
          reason: result.value.reason,
        });
      },
    }),

    flow_run_complete_feature: tool({
      description: "Persist the result of a Flow feature execution",
      args: WorkerResultArgsShape,
      async execute(args: any, context: any) {
        const input = args as unknown;
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists." });
        }

        const result = completeRun(session, input);
        if (!result.ok) {
          return toJson({
            status: "error",
            summary: result.message,
            recovery: result.recovery,
          });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: summarizeSession(saved).summary,
          session: summarizeSession(saved).session,
        });
      },
    }),

    flow_review_record_feature: tool({
      description: "Record the reviewer decision for the active feature",
      args: FlowReviewRecordFeatureArgsShape,
      async execute(args: any, context: any) {
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists." });
        }

        const result = recordReviewerDecision(session, args);
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: "Reviewer decision recorded.",
          session: summarizeSession(saved).session,
        });
      },
    }),

    flow_review_record_final: tool({
      description: "Record the reviewer decision for final cross-feature validation",
      args: FlowReviewRecordFinalArgsShape,
      async execute(args: any, context: any) {
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists." });
        }

        const result = recordReviewerDecision(session, args);
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: "Reviewer decision recorded.",
          session: summarizeSession(saved).session,
        });
      },
    }),

    flow_reset_feature: tool({
      description: "Reset a Flow feature to pending",
      args: FlowResetFeatureArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureId: string };

        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists." });
        }

        const result = resetFeature(session, input.featureId);
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: `Reset feature '${input.featureId}'.`,
          session: summarizeSession(saved).session,
        });
      },
    }),

    flow_reset_session: tool({
      description: "Clear the active Flow session",
      args: FlowStatusArgsShape,
      async execute(_args: any, context: any) {
        await deleteSession(context.worktree);
        return toJson({
          status: "ok",
          summary: "Cleared the active Flow session.",
          nextCommand: "/flow-plan <goal>",
        });
      },
    }),
  };
}
