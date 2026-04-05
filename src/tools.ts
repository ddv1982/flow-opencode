import { tool } from "@opencode-ai/plugin";
import { activateSession, archiveSession, createSession, listSessionHistory, loadSession, loadStoredSession, saveSession } from "./runtime/session";
import { adaptFlowRunCompleteFeatureInput, adaptReviewerDecisionInput } from "./runtime/adapters";
import { applyPlan, approvePlan, completeRun, recordReviewerDecision, resetFeature, selectPlanFeatures, startRun, type TransitionResult } from "./runtime/transitions";
import { summarizeSession } from "./runtime/summary";
import { DECOMPOSITION_POLICIES, GOAL_MODES, OUTCOME_KINDS, REVIEW_STATUSES, VALIDATION_STATUSES, VERIFICATION_STATUSES, WORKER_STATUSES } from "./runtime/contracts";
import { FEATURE_ID_MESSAGE, FEATURE_ID_PATTERN, FEATURE_REVIEW_SCOPE, FINAL_REVIEW_SCOPE, VALIDATION_SCOPES } from "./runtime/primitives";
import type { Session } from "./runtime/schema";

const z = tool.schema;
const featureIdSchema = z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);

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
  validationScope: z.enum(VALIDATION_SCOPES).optional(),
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
    featureId: featureIdSchema,
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
const FlowHistoryArgsShape = {};
const FlowHistoryShowArgsShape = {
  sessionId: z.string().min(1),
};
const FlowSessionActivateArgsShape = {
  sessionId: z.string().min(1),
};

const FlowAutoPrepareArgsShape = {
  argumentString: z.string().optional(),
};

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
  scope: z.literal(FEATURE_REVIEW_SCOPE),
  featureId: featureIdSchema,
  status: z.enum(["approved", "needs_fix", "blocked"]),
  summary: z.string().min(1),
  blockingFindings: z.array(z.object({ summary: z.string().min(1) })).default([]),
  followUps: z.array(z.object({ summary: z.string().min(1), severity: z.string().min(1).optional() })).default([]),
  suggestedValidation: z.array(z.string().min(1)).default([]),
};

const FlowReviewRecordFinalArgsShape = {
  scope: z.literal(FINAL_REVIEW_SCOPE),
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

type ToolContext = {
  worktree: string;
};

type ToolResponse = Record<string, unknown>;

function missingSessionResponse(summary = "No active Flow session exists.", nextCommand?: string): ToolResponse {
  return nextCommand ? { status: "missing_session", summary, nextCommand } : { status: "missing_session", summary };
}

function errorResponse(summary: string, extra?: ToolResponse): ToolResponse {
  return {
    status: "error",
    summary,
    ...(extra ?? {}),
  };
}

async function withSession(
  context: ToolContext,
  execute: (session: Session) => Promise<string>,
  missingResponse: ToolResponse = missingSessionResponse(),
): Promise<string> {
  const session = await loadSession(context.worktree);
  if (!session) {
    return toJson(missingResponse);
  }

  return execute(session);
}

async function persistTransition<T>(
  context: ToolContext,
  result: TransitionResult<T>,
  getSession: (value: T) => Session,
  onSuccess: (saved: Session, value: T) => ToolResponse,
  onError: (result: Extract<TransitionResult<T>, { ok: false }>) => ToolResponse = (failure) =>
    errorResponse(failure.message),
): Promise<string> {
  if (!result.ok) {
    return toJson(onError(result));
  }

  const saved = await saveSession(context.worktree, getSession(result.value));
  return toJson(onSuccess(saved, result.value));
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

    flow_history: tool({
      description: "Show stored Flow session history across active and archived runs",
      args: FlowHistoryArgsShape,
      async execute(_args: any, context: any) {
        const history = await listSessionHistory(context.worktree);
        const activeCount = history.activeSessionId ? 1 : 0;
        const totalCount = history.sessions.length + history.archived.length;
        const resumableStoredSession = history.sessions.find((session) => session.status !== "completed");

        if (totalCount === 0) {
          return toJson({
            status: "missing",
            summary: "No Flow session history found.",
            history,
            nextCommand: "/flow-plan <goal>",
          });
        }

        return toJson({
          status: "ok",
          summary: `Found ${totalCount} Flow session ${totalCount === 1 ? "entry" : "entries"} (${activeCount} active, ${history.archived.length} archived).`,
          history,
          nextCommand: history.activeSessionId
            ? "/flow-status"
            : resumableStoredSession
              ? `/flow-session activate ${resumableStoredSession.id}`
              : "/flow-plan <goal>",
        });
      },
    }),

    flow_history_show: tool({
      description: "Show a specific stored Flow session by id",
      args: FlowHistoryShowArgsShape,
      async execute(args: any, context: any) {
        const input = args as { sessionId: string };
        const found = await loadStoredSession(context.worktree, input.sessionId);

        if (!found) {
          return toJson({
            status: "missing_session",
            summary: `No stored Flow session exists for id '${input.sessionId}'.`,
            nextCommand: "/flow-history",
          });
        }

        const nextCommand = found.active
          ? "/flow-status"
          : found.source === "sessions" && found.session.status !== "completed"
            ? `/flow-session activate ${input.sessionId}`
            : found.session.status === "completed"
              ? "/flow-plan <goal>"
              : "/flow-history";
        const summarizedSession = summarizeSession(found.session).session;

        return toJson({
          status: "ok",
          summary: `Showing ${found.source === "archive" ? "archived" : "stored"} Flow session '${input.sessionId}'.`,
          source: found.source,
          active: found.active,
          path: found.path,
          archivePath: found.archivePath ?? null,
          archivedAt: found.archivedAt ?? null,
          session: found.active ? summarizedSession : { ...summarizedSession, nextCommand },
          nextCommand,
        });
      },
    }),

    flow_session_activate: tool({
      description: "Activate a stored Flow session by id",
      args: FlowSessionActivateArgsShape,
      async execute(args: any, context: any) {
        const input = args as { sessionId: string };
        const session = await activateSession(context.worktree, input.sessionId);

        if (!session) {
          return toJson({
            status: "missing_session",
            summary: `No stored Flow session exists for id '${input.sessionId}'.`,
            nextCommand: "/flow-history",
          });
        }

        return toJson({
          status: "ok",
          summary: `Activated Flow session: ${session.goal}`,
          session: summarizeSession(session).session,
          nextCommand: "/flow-status",
        });
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

    flow_auto_prepare: tool({
      description: "Classify a flow-auto invocation",
      args: FlowAutoPrepareArgsShape,
      async execute(args: any, context: any) {
        const input = args as { argumentString?: string };
        const trimmed = (input.argumentString ?? "").trim();
        const session = await loadSession(context.worktree);
        const isResume = trimmed === "" || trimmed === "resume";
        const resumableSession = session && session.status !== "completed" ? session : null;

        if (isResume) {
          if (!resumableSession) {
            return toJson({
              status: "missing_goal",
              mode: "missing_goal",
              summary: "No active Flow session exists. Provide a goal to start a new autonomous run.",
              nextCommand: "/flow-auto <goal>",
            });
          }

          return toJson({
            status: "ok",
            mode: "resume",
            goal: resumableSession.goal,
            summary: `Resuming active Flow goal: ${resumableSession.goal}`,
            nextCommand: "/flow-status",
          });
        }

        return toJson({
          status: "ok",
          mode: "start_new_goal",
          goal: trimmed,
          summary: `Starting a new autonomous Flow goal: ${trimmed}`,
          nextCommand: "/flow-status",
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
        return withSession(
          context,
          async (session) =>
            persistTransition(
              context,
              applyPlan(session, input.plan, input.planning),
              (value) => value,
              (saved) => ({
                status: "ok",
                summary: "Draft plan saved.",
                session: summarizeSession(saved).session,
              }),
            ),
          missingSessionResponse("No active Flow planning session exists.", "/flow-plan <goal>"),
        );
      },
    }),

    flow_plan_approve: tool({
      description: "Approve the active Flow draft plan",
      args: FlowPlanApproveArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureIds?: string[] };
        return withSession(context, async (session) =>
          persistTransition(
            context,
            approvePlan(session, parseFeatureIds(input.featureIds)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Plan approved.",
              session: summarizeSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_plan_select_features: tool({
      description: "Keep only selected features in the active Flow draft plan",
      args: FlowPlanSelectArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureIds: string[] };
        return withSession(context, async (session) =>
          persistTransition(
            context,
            selectPlanFeatures(session, parseFeatureIds(input.featureIds)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Draft plan narrowed.",
              session: summarizeSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_run_start: tool({
      description: "Start the next runnable Flow feature",
      args: FlowRunStartArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureId?: string };
        return withSession(
          context,
          async (session) =>
            persistTransition(
              context,
              startRun(session, input.featureId),
              (value) => value.session,
              (saved, value) => ({
                status: value.reason === "complete" ? "complete" : value.feature ? "ok" : "blocked",
                summary: summarizeSession(saved).summary,
                session: summarizeSession(saved).session,
                feature: value.feature,
                reason: value.reason,
              }),
            ),
          missingSessionResponse("No active Flow session exists.", "/flow-plan <goal>"),
        );
      },
    }),

    flow_run_complete_feature: tool({
      description: "Persist the result of a Flow feature execution",
      args: WorkerResultArgsShape,
      async execute(args: any, context: any) {
        const input = adaptFlowRunCompleteFeatureInput(args);
        return withSession(context, async (session) =>
          persistTransition(
            context,
            completeRun(session, input),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: summarizeSession(saved).summary,
              session: summarizeSession(saved).session,
            }),
            (failure) => errorResponse(failure.message, { recovery: failure.recovery }),
          ),
        );
      },
    }),

    flow_review_record_feature: tool({
      description: "Record the reviewer decision for the active feature",
      args: FlowReviewRecordFeatureArgsShape,
      async execute(args: any, context: any) {
        return withSession(context, async (session) =>
          persistTransition(
            context,
            recordReviewerDecision(session, adaptReviewerDecisionInput(args)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Reviewer decision recorded.",
              session: summarizeSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_review_record_final: tool({
      description: "Record the reviewer decision for final cross-feature validation",
      args: FlowReviewRecordFinalArgsShape,
      async execute(args: any, context: any) {
        return withSession(context, async (session) =>
          persistTransition(
            context,
            recordReviewerDecision(session, adaptReviewerDecisionInput(args)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Reviewer decision recorded.",
              session: summarizeSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_reset_feature: tool({
      description: "Reset a Flow feature to pending",
      args: FlowResetFeatureArgsShape,
      async execute(args: any, context: any) {
        const input = args as { featureId: string };

        return withSession(context, async (session) =>
          persistTransition(
            context,
            resetFeature(session, input.featureId),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: `Reset feature '${input.featureId}'.`,
              session: summarizeSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_reset_session: tool({
      description: "Archive and clear the active Flow session",
      args: FlowStatusArgsShape,
      async execute(_args: any, context: any) {
        const archived = await archiveSession(context.worktree);
        return toJson({
          status: "ok",
          summary: archived ? "Archived and cleared the active Flow session." : "No active Flow session existed.",
          archivedSessionId: archived?.sessionId ?? null,
          archivedTo: archived?.archivedTo ?? null,
          nextCommand: "/flow-plan <goal>",
        });
      },
    }),
  };
}
