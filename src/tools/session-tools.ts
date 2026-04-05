import { tool } from "@opencode-ai/plugin";
import { activateSession, archiveSession, createSession, listSessionHistory, loadSession, loadStoredSession, saveSession } from "../runtime/session";
import { summarizeSession } from "../runtime/summary";
import {
  FlowAutoPrepareArgsShape,
  FlowHistoryArgsShape,
  FlowHistoryShowArgsShape,
  FlowPlanStartArgsShape,
  FlowSessionActivateArgsShape,
  FlowStatusArgsShape,
  type FlowAutoPrepareArgs,
  type FlowHistoryShowArgs,
  type FlowPlanStartArgs,
  type FlowSessionActivateArgs,
  type ToolContext,
} from "./schemas";
import { summarizePersistedSession, toJson } from "./helpers";

export function createSessionTools() {
  return {
    flow_status: tool({
      description: "Show the active Flow session summary",
      args: FlowStatusArgsShape,
      async execute(_args: unknown, context: ToolContext) {
        const session = await loadSession(context.worktree);
        return toJson(summarizeSession(session));
      },
    }),

    flow_history: tool({
      description: "Show stored Flow session history across active and archived runs",
      args: FlowHistoryArgsShape,
      async execute(_args: unknown, context: ToolContext) {
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
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowHistoryShowArgs;
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
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowSessionActivateArgs;
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
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowPlanStartArgs;
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
          session: summarizePersistedSession(session).session,
        });
      },
    }),

    flow_auto_prepare: tool({
      description: "Classify a flow-auto invocation",
      args: FlowAutoPrepareArgsShape,
      async execute(args: unknown, context: ToolContext) {
        const input = args as FlowAutoPrepareArgs;
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

    flow_reset_session: tool({
      description: "Archive and clear the active Flow session",
      args: FlowStatusArgsShape,
      async execute(_args: unknown, context: ToolContext) {
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
