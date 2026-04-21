/**
 * Session tool boundary: status/doctor/history/lookup/activation tool registrations only.
 * Keep runtime response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";
import {
	buildDoctorReport,
	executeDispatchedSessionWorkspaceAction,
	historyResponse,
	missingStoredSessionResponse,
	runDispatchedSessionReadAction,
	statusResponse,
	storedSessionResponse,
} from "../../runtime/application";
import { FLOW_STATUS_COMMAND } from "../../runtime/constants";
import { withParsedArgs } from "../parsed-tool";
import type { FlowDoctorArgs } from "../schemas";
import {
	FlowDoctorArgsSchema,
	FlowDoctorArgsShape,
	FlowHistoryArgsSchema,
	FlowHistoryArgsShape,
	FlowHistoryShowArgsSchema,
	FlowHistoryShowArgsShape,
	FlowSessionActivateArgsSchema,
	FlowSessionActivateArgsShape,
	FlowStatusArgsSchema,
	FlowStatusArgsShape,
	type ToolContext,
} from "../schemas";
import {
	nextCommandForHistory,
	nextCommandForMissingStoredSession,
	nextCommandForStoredSession,
} from "./next-command-policy";
import { inspectToolWorkspace, recordToolMetadata } from "./shared";

function recordSessionLookupMetadata(
	context: ToolContext,
	sessionId: string,
	found: Awaited<
		ReturnType<typeof runDispatchedSessionReadAction<"load_history_session">>
	>["value"],
) {
	recordToolMetadata(context, `Show session ${sessionId}`, {
		sessionId,
		source: found?.source ?? null,
		active: found?.active ?? false,
	});
}

export function createHistorySessionTools() {
	return {
		flow_status: tool({
			description: "Show the active Flow session summary",
			args: FlowStatusArgsShape,
			execute: withParsedArgs(
				FlowStatusArgsSchema,
				async (input, context: ToolContext) => {
					const session = (
						await runDispatchedSessionReadAction(
							context,
							"load_status_session",
							undefined,
						)
					).value;
					const workspace = inspectToolWorkspace(context);
					recordToolMetadata(context, "Flow status", {
						sessionId: session?.id ?? null,
						status: session?.status ?? "missing",
						approval: session?.approval ?? null,
						activeFeatureId: session?.execution.activeFeatureId ?? null,
						view: input.view ?? "detailed",
						workspaceRoot: workspace.root,
						workspaceMutationAllowed: workspace.mutationAllowed,
					});
					return statusResponse(session, input.view ?? "detailed", workspace);
				},
			),
		}),

		flow_doctor: tool({
			description:
				"Run non-destructive readiness checks for Flow in the current workspace",
			args: FlowDoctorArgsShape,
			execute: withParsedArgs(
				FlowDoctorArgsSchema,
				async (input: FlowDoctorArgs, context: ToolContext) => {
					recordToolMetadata(context, "Flow doctor", {
						view: input.view ?? "detailed",
					});
					return buildDoctorReport(
						context,
						input.view ? { view: input.view } : {},
					);
				},
			),
		}),

		flow_history: tool({
			description: "Show active, stored, and completed Flow session history",
			args: FlowHistoryArgsShape,
			execute: withParsedArgs(
				FlowHistoryArgsSchema,
				async (_input, context: ToolContext) => {
					const history = (
						await runDispatchedSessionReadAction(
							context,
							"list_session_history",
							undefined,
						)
					).value;
					const response = historyResponse(
						history,
						nextCommandForHistory(history),
					);
					recordToolMetadata(context, "Flow history", response.metadata);
					return response.payload;
				},
			),
		}),

		flow_history_show: tool({
			description:
				"Show a specific active, stored, or completed Flow session by id",
			args: FlowHistoryShowArgsShape,
			execute: withParsedArgs(
				FlowHistoryShowArgsSchema,
				async (input, context: ToolContext) => {
					const found = (
						await runDispatchedSessionReadAction(
							context,
							"load_history_session",
							{ sessionId: input.sessionId },
						)
					).value;
					recordSessionLookupMetadata(context, input.sessionId, found);

					if (!found) {
						return missingStoredSessionResponse(
							input.sessionId,
							nextCommandForMissingStoredSession(),
						);
					}

					return storedSessionResponse(
						input.sessionId,
						found,
						nextCommandForStoredSession(input.sessionId, found),
					);
				},
			),
		}),

		flow_session_activate: tool({
			description: "Activate a stored Flow session by id",
			args: FlowSessionActivateArgsShape,
			execute: withParsedArgs(
				FlowSessionActivateArgsSchema,
				async (input, context: ToolContext) => {
					recordToolMetadata(context, `Activate ${input.sessionId}`, {
						sessionId: input.sessionId,
					});
					return executeDispatchedSessionWorkspaceAction(
						context,
						"activate_session",
						{
							sessionId: input.sessionId,
							nextCommand: FLOW_STATUS_COMMAND,
							missingNextCommand: nextCommandForMissingStoredSession(),
						},
					);
				},
			),
		}),
	};
}
