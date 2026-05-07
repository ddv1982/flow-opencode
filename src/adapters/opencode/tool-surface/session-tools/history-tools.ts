/**
 * Session tool boundary: status/doctor/history/lookup/activation tool registrations only.
 * Keep runtime response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */

import {
	buildDoctorReport,
	historyResponse,
	missingStoredSessionResponse,
	statusResponse,
	storedSessionResponse,
} from "../../../../runtime/application";
import { FLOW_STATUS_COMMAND } from "../../../../runtime/constants";
import { tool } from "../../sdk";
import { withParsedArgs } from "../parsed-tool";
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
	openCodeToolDescription,
	openCodeToolRuntimeActionName,
} from "../tool-registry";
import {
	nextCommandForHistory,
	nextCommandForMissingStoredSession,
	nextCommandForStoredSession,
} from "./next-command-policy";
import {
	executeToolWorkspaceAction,
	inspectToolWorkspace,
	readToolSessionValue,
	recordToolMetadata,
} from "./shared";

function recordSessionLookupMetadata(
	context: ToolContext,
	sessionId: string,
	found: Awaited<
		ReturnType<typeof readToolSessionValue<"load_history_session">>
	>,
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
			description: openCodeToolDescription("flow_status"),
			args: FlowStatusArgsShape,
			execute: withParsedArgs(
				FlowStatusArgsSchema,
				async (input, context: ToolContext) => {
					const session = await readToolSessionValue(
						context,
						openCodeToolRuntimeActionName("flow_status", "read"),
						undefined,
					);
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
			description: openCodeToolDescription("flow_doctor"),
			args: FlowDoctorArgsShape,
			execute: withParsedArgs(
				FlowDoctorArgsSchema,
				async (input, context: ToolContext) => {
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
			description: openCodeToolDescription("flow_history"),
			args: FlowHistoryArgsShape,
			execute: withParsedArgs(
				FlowHistoryArgsSchema,
				async (_input, context: ToolContext) => {
					const history = await readToolSessionValue(
						context,
						openCodeToolRuntimeActionName("flow_history", "read"),
						undefined,
					);
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
			description: openCodeToolDescription("flow_history_show"),
			args: FlowHistoryShowArgsShape,
			execute: withParsedArgs(
				FlowHistoryShowArgsSchema,
				async (input, context: ToolContext) => {
					const found = await readToolSessionValue(
						context,
						openCodeToolRuntimeActionName("flow_history_show", "read"),
						{ sessionId: input.sessionId },
					);
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
			description: openCodeToolDescription("flow_session_activate"),
			args: FlowSessionActivateArgsShape,
			execute: withParsedArgs(
				FlowSessionActivateArgsSchema,
				async (input, context: ToolContext) => {
					recordToolMetadata(context, `Activate ${input.sessionId}`, {
						sessionId: input.sessionId,
					});
					return executeToolWorkspaceAction(
						context,
						openCodeToolRuntimeActionName("flow_session_activate", "workspace"),
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
