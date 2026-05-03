/**
 * Session tool boundary: lifecycle/close tool registrations only.
 * Keep runtime response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */
import { tool } from "../../sdk";
import { openCodeToolDescription } from "../../tool-projections.generated";

import type { RuntimeActionBinding } from "../descriptors";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowSessionCloseArgsSchema,
	FlowSessionCloseArgsShape,
	type ToolContext,
} from "../schemas";
import { nextCommandForResetSession } from "./next-command-policy";
import { executeToolWorkspaceAction, recordToolMetadata } from "./shared";

export const FLOW_LIFECYCLE_TOOL_RUNTIME_BINDINGS = {
	flow_session_close: { kind: "workspace", name: "close_session" },
} as const satisfies Record<
	string,
	Extract<RuntimeActionBinding, { kind: "workspace" }>
>;

export function createLifecycleSessionTools() {
	return {
		flow_session_close: tool({
			description: openCodeToolDescription("flow_session_close"),
			args: FlowSessionCloseArgsShape,
			execute: withParsedArgs(
				FlowSessionCloseArgsSchema,
				async (input, context: ToolContext) => {
					recordToolMetadata(context, `Close Flow session (${input.kind})`, {
						closureKind: input.kind,
					});
					return executeToolWorkspaceAction(
						context,
						FLOW_LIFECYCLE_TOOL_RUNTIME_BINDINGS.flow_session_close.name,
						{
							kind: input.kind,
							...(input.summary ? { summary: input.summary } : {}),
							nextCommand: nextCommandForResetSession(),
						},
					);
				},
			),
		}),
	};
}
