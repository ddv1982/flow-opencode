/**
 * Session tool boundary: lifecycle/close tool registrations only.
 * Keep response envelopes in responses.ts and next-command routing in
 * next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";
import { closeSession } from "../../runtime/session";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowSessionCloseArgsSchema,
	FlowSessionCloseArgsShape,
	type ToolContext,
} from "../schemas";
import { nextCommandForResetSession } from "./next-command-policy";
import { closeSessionResponse } from "./responses";
import { recordToolMetadata, resolveToolSessionRoot } from "./shared";

export function createLifecycleSessionTools() {
	return {
		flow_session_close: tool({
			description:
				"Close the active Flow session as completed, deferred, or abandoned",
			args: FlowSessionCloseArgsShape,
			execute: withParsedArgs(
				FlowSessionCloseArgsSchema,
				async (input, context: ToolContext) => {
					const completed = await closeSession(
						resolveToolSessionRoot(context),
						input.kind,
						input.summary,
					);
					recordToolMetadata(context, `Close Flow session (${input.kind})`, {
						completedSessionId: completed?.sessionId ?? null,
						closureKind: input.kind,
					});
					return closeSessionResponse(completed, nextCommandForResetSession());
				},
			),
		}),
	};
}
