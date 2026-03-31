import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { WorkerResultSchema } from "./runtime/schema";
import { loadSession, saveSession, createSession, deleteSession } from "./runtime/session";
import { applyPlan, approvePlan, completeRun, resetFeature, selectPlanFeatures, startRun } from "./runtime/transitions";
import { summarizeSession } from "./runtime/summary";

const PlanArgsSchema = z.object({
  summary: z.string().min(1),
  overview: z.string().min(1),
  requirements: z.array(z.string().min(1)).default([]),
  architectureDecisions: z.array(z.string().min(1)).default([]),
  features: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      summary: z.string().min(1),
      fileTargets: z.array(z.string().min(1)).default([]),
      verification: z.array(z.string().min(1)).default([]),
      dependsOn: z.array(z.string().min(1)).optional(),
      blockedBy: z.array(z.string().min(1)).optional(),
    }),
  ).min(1),
  goalMode: z.enum(["implementation", "review", "review_and_fix"]).optional(),
  decompositionPolicy: z.enum(["atomic_feature", "iterative_refinement", "open_ended"]).optional(),
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
      args: {},
      async execute(_args: any, context: any) {
        const session = await loadSession(context.worktree);
        return toJson(summarizeSession(session));
      },
    } as any),

    flow_plan_start: tool({
      description: "Create or refresh the active Flow planning session",
      args: {
        goal: z.string().min(1).optional(),
        repoProfile: z.array(z.string().min(1)).optional(),
      },
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
    } as any),

    flow_plan_apply: tool({
      description: "Persist a Flow draft plan into the active session",
      args: {
        plan: PlanArgsSchema,
        planning: PlanningContextArgsSchema.optional(),
      },
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
    } as any),

    flow_plan_approve: tool({
      description: "Approve the active Flow draft plan",
        args: {
          featureIds: z.array(z.string().min(1)).optional(),
        },
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
    } as any),

    flow_plan_select_features: tool({
      description: "Keep only selected features in the active Flow draft plan",
        args: {
          featureIds: z.array(z.string().min(1)),
        },
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
    } as any),

    flow_run_start: tool({
      description: "Start the next runnable Flow feature",
        args: {
          featureId: z.string().min(1).optional(),
        },
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
    } as any),

    flow_run_complete_feature: tool({
      description: "Persist the result of a Flow feature execution",
      args: WorkerResultSchema,
      async execute(args: any, context: any) {
        const input = args as unknown;
        const session = await loadSession(context.worktree);
        if (!session) {
          return toJson({ status: "missing_session", summary: "No active Flow session exists." });
        }

        const result = completeRun(session, input);
        if (!result.ok) {
          return toJson({ status: "error", summary: result.message });
        }

        const saved = await saveSession(context.worktree, result.value);
        return toJson({
          status: "ok",
          summary: summarizeSession(saved).summary,
          session: summarizeSession(saved).session,
        });
      },
    } as any),

    flow_reset: tool({
      description: "Reset a Flow feature or clear the active session",
        args: {
          scope: z.enum(["feature", "session"]),
          featureId: z.string().min(1).optional(),
        },
      async execute(args: any, context: any) {
        const input = args as { scope: "feature" | "session"; featureId?: string };
        if (input.scope === "session") {
          await deleteSession(context.worktree);
          return toJson({
            status: "ok",
            summary: "Cleared the active Flow session.",
            nextCommand: "/flow-plan <goal>",
          });
        }

        if (!input.featureId) {
          return toJson({ status: "error", summary: "featureId is required when resetting a feature." });
        }

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
    } as any),
  };
}
