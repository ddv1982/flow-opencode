/**
 * flow_session: session lifecycle and history in one tool
 * (activate | close | history | show), replacing flow_session_activate,
 * flow_session_close, flow_history, and flow_history_show.
 */
import {
	historyResponse,
	missingStoredSessionResponse,
	storedSessionResponse,
} from "../../../runtime/application";
import { FLOW_STATUS_COMMAND } from "../../../runtime/constants";
import { tool } from "../sdk";
import {
	nextCommandForHistory,
	nextCommandForMissingStoredSession,
	nextCommandForResetSession,
	nextCommandForStoredSession,
} from "./next-command-policy";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowSessionArgsSchema,
	FlowSessionArgsShape,
	type ToolContext,
} from "./schemas";
import {
	executeToolWorkspaceAction,
	inspectToolWorkspace,
	readToolSessionValue,
	recordToolMetadata,
} from "./shared";
import { openCodeToolDescription } from "./tool-registry";

async function activateSession(context: ToolContext, sessionId: string) {
	recordToolMetadata(context, `Activate ${sessionId}`, { sessionId });
	return executeToolWorkspaceAction(context, "activate_session", {
		sessionId,
		nextCommand: FLOW_STATUS_COMMAND,
		missingNextCommand: nextCommandForMissingStoredSession(),
	});
}

async function closeSession(
	context: ToolContext,
	kind: "completed" | "deferred" | "abandoned",
	summary: string | undefined,
) {
	recordToolMetadata(context, `Close Flow session (${kind})`, {
		closureKind: kind,
	});
	return executeToolWorkspaceAction(context, "close_session", {
		kind,
		...(summary ? { summary } : {}),
		nextCommand: nextCommandForResetSession(),
	});
}

async function showSessionHistory(context: ToolContext) {
	const history = await readToolSessionValue(
		context,
		"list_session_history",
		undefined,
	);
	const response = historyResponse(history, nextCommandForHistory(history));
	recordToolMetadata(context, "Flow history", response.metadata);
	return response.payload;
}

async function showStoredSession(context: ToolContext, sessionId: string) {
	const found = await readToolSessionValue(context, "load_history_session", {
		sessionId,
	});
	recordToolMetadata(context, `Show session ${sessionId}`, {
		sessionId,
		source: found?.source ?? null,
		active: found?.active ?? false,
	});

	if (!found) {
		return missingStoredSessionResponse(
			sessionId,
			nextCommandForMissingStoredSession(),
		);
	}

	const workspace = inspectToolWorkspace(context);
	return await storedSessionResponse(
		sessionId,
		found,
		nextCommandForStoredSession(sessionId, found),
		workspace,
	);
}

export function createSessionTool() {
	return {
		flow_session: tool({
			description: openCodeToolDescription("flow_session"),
			args: FlowSessionArgsShape,
			execute: withParsedArgs(
				FlowSessionArgsSchema,
				async (input, context: ToolContext) => {
					switch (input.action) {
						case "activate": {
							if (!input.sessionId) {
								throw new Error(
									"sessionId is required when action is 'activate'.",
								);
							}
							return activateSession(context, input.sessionId);
						}
						case "close": {
							if (!input.kind) {
								throw new Error("kind is required when action is 'close'.");
							}
							return closeSession(context, input.kind, input.summary);
						}
						case "history":
							return showSessionHistory(context);
						case "show": {
							if (!input.sessionId) {
								throw new Error("sessionId is required when action is 'show'.");
							}
							return showStoredSession(context, input.sessionId);
						}
					}
				},
			),
		}),
	};
}
