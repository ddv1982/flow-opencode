/**
 * Session tool boundary: lifecycle/close tool registrations only.
 * Keep runtime response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";

import { withParsedArgs } from "../parsed-tool";
import {
	FlowSessionCloseArgsSchema,
	FlowSessionCloseArgsShape,
	type ToolContext,
} from "../schemas";
import { nextCommandForResetSession } from "./next-command-policy";
import { executeToolWorkspaceAction, recordToolMetadata } from "./shared";

export function createLifecycleSessionTools() {
	return {
		flow_session_close: tool({
			description:
				"Close the active Flow session as completed, deferred, or abandoned",
			args: FlowSessionCloseArgsShape,
			execute: withParsedArgs(
				FlowSessionCloseArgsSchema,
				async (input, context: ToolContext) => {
					recordToolMetadata(context, `Close Flow session (${input.kind})`, {
						closureKind: input.kind,
					});
					return executeToolWorkspaceAction(context, "close_session", {
						kind: input.kind,
						...(input.summary ? { summary: input.summary } : {}),
						nextCommand: nextCommandForResetSession(),
					});
				},
			),
		}),
	};
}
