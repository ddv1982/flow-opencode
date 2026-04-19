/**
 * Session tool boundary: lifecycle/reset tool registrations only.
 * Keep response envelopes in responses.ts and next-command routing in
 * next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";
import { archiveSession } from "../../runtime/session";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowStatusArgsSchema,
	FlowStatusArgsShape,
	type ToolContext,
} from "../schemas";
import { nextCommandForResetSession } from "./next-command-policy";
import { resetSessionResponse } from "./responses";
import { recordToolMetadata, resolveToolSessionRoot } from "./shared";

export function createLifecycleSessionTools() {
	return {
		flow_reset_session: tool({
			description: "Archive and clear the active Flow session",
			args: FlowStatusArgsShape,
			execute: withParsedArgs(
				FlowStatusArgsSchema,
				async (_input, context: ToolContext) => {
					const archived = await archiveSession(
						resolveToolSessionRoot(context),
					);
					recordToolMetadata(context, "Reset Flow session", {
						archivedSessionId: archived?.sessionId ?? null,
					});
					return resetSessionResponse(archived, nextCommandForResetSession());
				},
			),
		}),
	};
}
