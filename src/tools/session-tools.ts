import { tool } from "@opencode-ai/plugin";
import { resolveSessionRoot, toJson } from "../runtime/application";
import {
	FLOW_AUTO_RESUME_COMMAND,
	FLOW_AUTO_WITH_GOAL_COMMAND,
	FLOW_HISTORY_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_STATUS_COMMAND,
	flowSessionActivateCommand,
} from "../runtime/constants";
import {
	activateSession,
	archiveSession,
	createSession,
	listSessionHistory,
	loadSession,
	loadStoredSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../runtime/session";
import { summarizeSession } from "../runtime/summary";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowAutoPrepareArgsSchema,
	FlowAutoPrepareArgsShape,
	FlowHistoryArgsSchema,
	FlowHistoryArgsShape,
	FlowHistoryShowArgsSchema,
	FlowHistoryShowArgsShape,
	FlowPlanStartArgsSchema,
	FlowPlanStartArgsShape,
	FlowSessionActivateArgsSchema,
	FlowSessionActivateArgsShape,
	FlowStatusArgsSchema,
	FlowStatusArgsShape,
} from "./schemas";

export function createSessionTools() {
	return {
		flow_status: tool({
			description: "Show the active Flow session summary",
			args: FlowStatusArgsShape,
			execute: withParsedArgs(FlowStatusArgsSchema, async (_input, context) => {
				const session = await loadSession(resolveSessionRoot(context));
				return toJson(summarizeSession(session));
			}),
		}),

		flow_history: tool({
			description:
				"Show stored Flow session history across active and archived runs",
			args: FlowHistoryArgsShape,
			execute: withParsedArgs(
				FlowHistoryArgsSchema,
				async (_input, context) => {
					const history = await listSessionHistory(resolveSessionRoot(context));
					const activeCount = history.activeSessionId ? 1 : 0;
					const totalCount = history.sessions.length + history.archived.length;
					const resumableStoredSession = history.sessions.find(
						(session) => session.status !== "completed",
					);

					if (totalCount === 0) {
						return toJson({
							status: "missing",
							summary: "No Flow session history found.",
							history,
							nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
						});
					}

					return toJson({
						status: "ok",
						summary: `Found ${totalCount} Flow session ${totalCount === 1 ? "entry" : "entries"} (${activeCount} active, ${history.archived.length} archived).`,
						history,
						nextCommand: history.activeSessionId
							? FLOW_STATUS_COMMAND
							: resumableStoredSession
								? flowSessionActivateCommand(resumableStoredSession.id)
								: FLOW_PLAN_WITH_GOAL_COMMAND,
					});
				},
			),
		}),

		flow_history_show: tool({
			description: "Show a specific stored Flow session by id",
			args: FlowHistoryShowArgsShape,
			execute: withParsedArgs(
				FlowHistoryShowArgsSchema,
				async (input, context) => {
					const found = await loadStoredSession(
						resolveSessionRoot(context),
						input.sessionId,
					);

					if (!found) {
						return toJson({
							status: "missing_session",
							summary: `No stored Flow session exists for id '${input.sessionId}'.`,
							nextCommand: FLOW_HISTORY_COMMAND,
						});
					}

					const nextCommand = found.active
						? FLOW_STATUS_COMMAND
						: found.source === "sessions" &&
								found.session.status !== "completed"
							? flowSessionActivateCommand(input.sessionId)
							: found.session.status === "completed"
								? FLOW_PLAN_WITH_GOAL_COMMAND
								: FLOW_HISTORY_COMMAND;
					const summarizedSession = summarizeSession(found.session).session;

					return toJson({
						status: "ok",
						summary: `Showing ${found.source === "archive" ? "archived" : "stored"} Flow session '${input.sessionId}'.`,
						source: found.source,
						active: found.active,
						path: found.path,
						archivePath: found.archivePath ?? null,
						archivedAt: found.archivedAt ?? null,
						session: found.active
							? summarizedSession
							: { ...summarizedSession, nextCommand },
						nextCommand,
					});
				},
			),
		}),

		flow_session_activate: tool({
			description: "Activate a stored Flow session by id",
			args: FlowSessionActivateArgsShape,
			execute: withParsedArgs(
				FlowSessionActivateArgsSchema,
				async (input, context) => {
					const session = await activateSession(
						resolveSessionRoot(context),
						input.sessionId,
					);

					if (!session) {
						return toJson({
							status: "missing_session",
							summary: `No stored Flow session exists for id '${input.sessionId}'.`,
							nextCommand: FLOW_HISTORY_COMMAND,
						});
					}

					return toJson({
						status: "ok",
						summary: `Activated Flow session: ${session.goal}`,
						session: summarizeSession(session).session,
						nextCommand: FLOW_STATUS_COMMAND,
					});
				},
			),
		}),

		flow_plan_start: tool({
			description: "Create or refresh the active Flow planning session",
			args: FlowPlanStartArgsShape,
			execute: withParsedArgs(
				FlowPlanStartArgsSchema,
				async (input, context) => {
					const sessionRoot = resolveSessionRoot(context);
					const existing = await loadSession(sessionRoot);

					if (!input.goal && !existing) {
						return toJson({
							status: "missing_goal",
							summary: "Provide a goal to create a new Flow plan.",
							nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
						});
					}

					const goal = input.goal ?? existing?.goal;
					if (!goal) {
						return toJson({
							status: "missing_goal",
							summary: "Provide a goal to create a new Flow plan.",
							nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
						});
					}
					const isNewGoal = Boolean(
						existing && input.goal && input.goal !== existing.goal,
					);
					const planningOptions = input.repoProfile
						? { repoProfile: input.repoProfile }
						: undefined;
					const base =
						!existing || existing.status === "completed" || isNewGoal
							? createSession(goal, planningOptions)
							: existing.goal === goal
								? {
										...existing,
										planning: {
											...existing.planning,
											repoProfile:
												input.repoProfile ?? existing.planning.repoProfile,
										},
									}
								: {
										...existing,
										goal,
										status: "planning" as const,
										approval: "pending" as const,
										plan: null,
										planning: {
											...existing.planning,
											repoProfile:
												input.repoProfile ?? existing.planning.repoProfile,
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

					const session = await saveSessionState(sessionRoot, base);
					await syncSessionArtifacts(sessionRoot, session);
					return toJson({
						status: "ok",
						summary: `Planning session ready for goal: ${session.goal}`,
						session: summarizeSession(session).session,
					});
				},
			),
		}),

		flow_auto_prepare: tool({
			description: "Classify a flow-auto invocation",
			args: FlowAutoPrepareArgsShape,
			execute: withParsedArgs(
				FlowAutoPrepareArgsSchema,
				async (input, context) => {
					const trimmed = (input.argumentString ?? "").trim();
					const session = await loadSession(resolveSessionRoot(context));
					const isResume = trimmed === "" || trimmed === "resume";
					const resumableSession =
						session && session.status !== "completed" ? session : null;

					if (isResume) {
						if (!resumableSession) {
							return toJson({
								status: "missing_goal",
								mode: "missing_goal",
								summary:
									"No active Flow session exists. Provide a goal to start a new autonomous run.",
								nextCommand: FLOW_AUTO_WITH_GOAL_COMMAND,
							});
						}

						return toJson({
							status: "ok",
							mode: "resume",
							goal: resumableSession.goal,
							summary: `Resuming active Flow goal: ${resumableSession.goal}`,
							nextCommand: FLOW_AUTO_RESUME_COMMAND,
						});
					}

					return toJson({
						status: "ok",
						mode: "start_new_goal",
						goal: trimmed,
						summary: `Starting a new autonomous Flow goal: ${trimmed}`,
						nextCommand: FLOW_STATUS_COMMAND,
					});
				},
			),
		}),

		flow_reset_session: tool({
			description: "Archive and clear the active Flow session",
			args: FlowStatusArgsShape,
			execute: withParsedArgs(FlowStatusArgsSchema, async (_input, context) => {
				const archived = await archiveSession(resolveSessionRoot(context));
				return toJson({
					status: "ok",
					summary: archived
						? "Archived and cleared the active Flow session."
						: "No active Flow session existed.",
					archivedSessionId: archived?.sessionId ?? null,
					archivedTo: archived?.archivedTo ?? null,
					nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
				});
			}),
		}),
	};
}
