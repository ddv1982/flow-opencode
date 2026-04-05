import { tool } from "@opencode-ai/plugin";
import { adaptFlowRunCompleteFeatureInput, adaptReviewerDecisionInput } from "../runtime/adapters";
import { applyPlan, approvePlan, completeRun, recordReviewerDecision, resetFeature, selectPlanFeatures, startRun } from "../runtime/transitions";
import {
  FlowPlanApplyArgsShape,
  FlowPlanApproveArgsShape,
  FlowPlanSelectArgsShape,
  FlowResetFeatureArgsShape,
  FlowReviewRecordFeatureArgsShape,
  FlowReviewRecordFinalArgsShape,
  FlowRunStartArgsShape,
  WorkerResultArgsShape,
  type FlowPlanApplyArgs,
  type FlowPlanApproveArgs,
  type FlowPlanSelectArgs,
  type FlowResetFeatureArgs,
  type FlowRunStartArgs,
  type ToolContext,
} from "./schemas";
import { errorResponse, missingSessionResponse, parseFeatureIds, persistTransition, summarizePersistedSession, withSession } from "./helpers";

export function createRuntimeTools() {
  return {
    flow_plan_apply: tool({
      description: "Persist a Flow draft plan into the active session",
      args: FlowPlanApplyArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowPlanApplyArgs;
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
                session: summarizePersistedSession(saved).session,
              }),
            ),
          missingSessionResponse("No active Flow planning session exists.", "/flow-plan <goal>"),
        );
      },
    }),

    flow_plan_approve: tool({
      description: "Approve the active Flow draft plan",
      args: FlowPlanApproveArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowPlanApproveArgs;
        return withSession(context, async (session) =>
          persistTransition(
            context,
            approvePlan(session, parseFeatureIds(input.featureIds)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Plan approved.",
              session: summarizePersistedSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_plan_select_features: tool({
      description: "Keep only selected features in the active Flow draft plan",
      args: FlowPlanSelectArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowPlanSelectArgs;
        return withSession(context, async (session) =>
          persistTransition(
            context,
            selectPlanFeatures(session, parseFeatureIds(input.featureIds)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Draft plan narrowed.",
              session: summarizePersistedSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_run_start: tool({
      description: "Start the next runnable Flow feature",
      args: FlowRunStartArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowRunStartArgs;
        return withSession(
          context,
          async (session) =>
            persistTransition(
              context,
              startRun(session, input.featureId),
              (value) => value.session,
              (saved, value) => {
                const summary = summarizePersistedSession(saved);

                return {
                  status: value.reason === "complete" ? "complete" : value.feature ? "ok" : "blocked",
                  summary: summary.summary,
                  session: summary.session,
                  feature: value.feature,
                  reason: value.reason,
                };
              },
            ),
          missingSessionResponse("No active Flow session exists.", "/flow-plan <goal>"),
        );
      },
    }),

    flow_run_complete_feature: tool({
      description: "Persist the result of a Flow feature execution",
      args: WorkerResultArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const input = adaptFlowRunCompleteFeatureInput(args);
        return withSession(context, async (session) =>
          persistTransition(
            context,
            completeRun(session, input),
            (value) => value,
            (saved) => {
              const summary = summarizePersistedSession(saved);

              return {
                status: "ok",
                summary: summary.summary,
                session: summary.session,
              };
            },
            (failure) => errorResponse(failure.message, { recovery: failure.recovery }),
          ),
        );
      },
    }),

    flow_review_record_feature: tool({
      description: "Record the reviewer decision for the active feature",
      args: FlowReviewRecordFeatureArgsShape,
      async execute(args: unknown, context: ToolContext) {
        return withSession(context, async (session) =>
          persistTransition(
            context,
            recordReviewerDecision(session, adaptReviewerDecisionInput(args)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Reviewer decision recorded.",
              session: summarizePersistedSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_review_record_final: tool({
      description: "Record the reviewer decision for final cross-feature validation",
      args: FlowReviewRecordFinalArgsShape,
      async execute(args: unknown, context: ToolContext) {
        return withSession(context, async (session) =>
          persistTransition(
            context,
            recordReviewerDecision(session, adaptReviewerDecisionInput(args)),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: "Reviewer decision recorded.",
              session: summarizePersistedSession(saved).session,
            }),
          ),
        );
      },
    }),

    flow_reset_feature: tool({
      description: "Reset a Flow feature to pending",
      args: FlowResetFeatureArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowResetFeatureArgs;

        return withSession(context, async (session) =>
          persistTransition(
            context,
            resetFeature(session, input.featureId),
            (value) => value,
            (saved) => ({
              status: "ok",
              summary: `Reset feature '${input.featureId}'.`,
              session: summarizePersistedSession(saved).session,
            }),
          ),
        );
      },
    }),
  };
}
