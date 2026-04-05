import { tool } from "@opencode-ai/plugin";
import {
  errorResponse,
  missingSessionResponse,
  parseToolArgs,
  summarizePersistedSession,
  withPersistedTransition,
} from "../runtime/application";
import { applyPlan, approvePlan, completeRun, recordReviewerDecision, resetFeature, selectPlanFeatures, startRun } from "../runtime/transitions";
import {
  FlowPlanApplyArgsSchema,
  FlowPlanApplyArgsShape,
  FlowPlanApproveArgsSchema,
  FlowPlanApproveArgsShape,
  FlowPlanSelectArgsSchema,
  FlowPlanSelectArgsShape,
  FlowResetFeatureArgsSchema,
  FlowResetFeatureArgsShape,
  FlowReviewRecordFeatureArgsSchema,
  FlowReviewRecordFeatureArgsShape,
  FlowReviewRecordFinalArgsSchema,
  FlowReviewRecordFinalArgsShape,
  FlowRunStartArgsSchema,
  FlowRunStartArgsShape,
  WorkerResultArgsSchema,
  WorkerResultArgsShape,
  type ToolContext,
} from "./schemas";

function parseFeatureIds(raw?: string[]): string[] {
  return (raw ?? []).map((value) => value.trim()).filter(Boolean);
}

export function createRuntimeTools() {
  return {
    flow_plan_apply: tool({
      description: "Persist a Flow draft plan into the active session",
      args: FlowPlanApplyArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(FlowPlanApplyArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;
        return withPersistedTransition(context, (session) => applyPlan(session, input.plan, input.planning), {
          getSession: (value) => value,
          onSuccess: (saved) => ({
            status: "ok",
            summary: "Draft plan saved.",
            session: summarizePersistedSession(saved).session,
          }),
          missingResponse: missingSessionResponse("No active Flow planning session exists.", "/flow-plan <goal>"),
        });
      },
    }),

    flow_plan_approve: tool({
      description: "Approve the active Flow draft plan",
      args: FlowPlanApproveArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(FlowPlanApproveArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;
        return withPersistedTransition(context, (session) => approvePlan(session, parseFeatureIds(input.featureIds)), {
          getSession: (value) => value,
          onSuccess: (saved) => ({
            status: "ok",
            summary: "Plan approved.",
            session: summarizePersistedSession(saved).session,
          }),
        });
      },
    }),

    flow_plan_select_features: tool({
      description: "Keep only selected features in the active Flow draft plan",
      args: FlowPlanSelectArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(FlowPlanSelectArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;
        return withPersistedTransition(context, (session) => selectPlanFeatures(session, parseFeatureIds(input.featureIds)), {
          getSession: (value) => value,
          onSuccess: (saved) => ({
            status: "ok",
            summary: "Draft plan narrowed.",
            session: summarizePersistedSession(saved).session,
          }),
        });
      },
    }),

    flow_run_start: tool({
      description: "Start the next runnable Flow feature",
      args: FlowRunStartArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(FlowRunStartArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;
        return withPersistedTransition(context, (session) => startRun(session, input.featureId), {
          getSession: (value) => value.session,
          onSuccess: (saved, value) => {
            const summary = summarizePersistedSession(saved);

            return {
              status: value.reason === "complete" ? "complete" : value.feature ? "ok" : "blocked",
              summary: summary.summary,
              session: summary.session,
              feature: value.feature,
              reason: value.reason,
            };
          },
          missingResponse: missingSessionResponse("No active Flow session exists.", "/flow-plan <goal>"),
        });
      },
    }),

    flow_run_complete_feature: tool({
      description: "Persist the result of a Flow feature execution",
      args: WorkerResultArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(WorkerResultArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;
        return withPersistedTransition(context, (session) => completeRun(session, input), {
          getSession: (value) => value,
          onSuccess: (saved) => {
            const summary = summarizePersistedSession(saved);

            return {
              status: "ok",
              summary: summary.summary,
              session: summary.session,
            };
          },
          onError: (failure) => errorResponse(failure.message, { recovery: failure.recovery }),
        });
      },
    }),

    flow_review_record_feature: tool({
      description: "Record the reviewer decision for the active feature",
      args: FlowReviewRecordFeatureArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(FlowReviewRecordFeatureArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;
        return withPersistedTransition(context, (session) => recordReviewerDecision(session, input), {
          getSession: (value) => value,
          onSuccess: (saved) => ({
            status: "ok",
            summary: "Reviewer decision recorded.",
            session: summarizePersistedSession(saved).session,
          }),
        });
      },
    }),

    flow_review_record_final: tool({
      description: "Record the reviewer decision for final cross-feature validation",
      args: FlowReviewRecordFinalArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(FlowReviewRecordFinalArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;
        return withPersistedTransition(context, (session) => recordReviewerDecision(session, input), {
          getSession: (value) => value,
          onSuccess: (saved) => ({
            status: "ok",
            summary: "Reviewer decision recorded.",
            session: summarizePersistedSession(saved).session,
          }),
        });
      },
    }),

    flow_reset_feature: tool({
      description: "Reset a Flow feature to pending",
      args: FlowResetFeatureArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const parsed = parseToolArgs(FlowResetFeatureArgsSchema, args);
        if (!parsed.ok) return parsed.response;
        const input = parsed.value;

        return withPersistedTransition(context, (session) => resetFeature(session, input.featureId), {
          getSession: (value) => value,
          onSuccess: (saved) => ({
            status: "ok",
            summary: `Reset feature '${input.featureId}'.`,
            session: summarizePersistedSession(saved).session,
          }),
        });
      },
    }),
  };
}
