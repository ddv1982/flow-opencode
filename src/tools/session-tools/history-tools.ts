/**
 * Session tool boundary: history/lookup/activation tool registrations only.
 * Keep response envelopes in responses.ts and next-command routing in
 * next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";
import { toJson } from "../../runtime/application";
import { FLOW_STATUS_COMMAND } from "../../runtime/constants";
import {
	activateSession,
	listSessionHistory,
	loadSession,
	loadStoredSession,
} from "../../runtime/session";
import { summarizeSession } from "../../runtime/summary";
import { withParsedArgs } from "../parsed-tool";
import {
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
import {
	historyResponse,
	missingStoredSessionResponse,
	statusResponse,
	storedSessionResponse,
} from "./responses";
import { recordToolMetadata, resolveToolSessionRoot } from "./shared";

function recordSessionLookupMetadata(
	context: ToolContext,
	sessionId: string,
	found: Awaited<ReturnType<typeof loadStoredSession>>,
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
				async (_input, context: ToolContext) => {
					const session = await loadSession(resolveToolSessionRoot(context));
					recordToolMetadata(context, "Flow status", {
						sessionId: session?.id ?? null,
						status: session?.status ?? "missing",
						approval: session?.approval ?? null,
						activeFeatureId: session?.execution.activeFeatureId ?? null,
					});
					return statusResponse(session);
				},
			),
		}),

		flow_history: tool({
			description: "Show active, stored, and completed Flow session history",
			args: FlowHistoryArgsShape,
			execute: withParsedArgs(
				FlowHistoryArgsSchema,
				async (_input, context: ToolContext) => {
					const history = await listSessionHistory(
						resolveToolSessionRoot(context),
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
			description:
				"Show a specific active, stored, or completed Flow session by id",
			args: FlowHistoryShowArgsShape,
			execute: withParsedArgs(
				FlowHistoryShowArgsSchema,
				async (input, context: ToolContext) => {
					const found = await loadStoredSession(
						resolveToolSessionRoot(context),
						input.sessionId,
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
			description: "Activate a stored Flow session by id",
			args: FlowSessionActivateArgsShape,
			execute: withParsedArgs(
				FlowSessionActivateArgsSchema,
				async (input, context: ToolContext) => {
					const session = await activateSession(
						resolveToolSessionRoot(context),
						input.sessionId,
					);
					recordToolMetadata(context, `Activate ${input.sessionId}`, {
						sessionId: input.sessionId,
					});

					if (!session) {
						return missingStoredSessionResponse(
							input.sessionId,
							nextCommandForMissingStoredSession(),
						);
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
	};
}
