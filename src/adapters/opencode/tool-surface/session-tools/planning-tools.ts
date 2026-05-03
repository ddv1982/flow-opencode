/**
 * Session tool boundary: planning/resume classification tool registrations only.
 * Keep runtime response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */

import { autoPrepareResponse } from "../../../../runtime/application";
import { tool } from "../../sdk";
import { openCodeToolDescription } from "../../tool-projections.generated";
import type { RuntimeActionBinding } from "../descriptors";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowAutoPrepareArgsSchema,
	FlowAutoPrepareArgsShape,
	FlowPlanStartArgsSchema,
	FlowPlanStartArgsShape,
	type ToolContext,
} from "../schemas";
import {
	autoPreparePolicy,
	nextCommandForMissingGoal,
} from "./next-command-policy";
import {
	executeToolWorkspaceAction,
	readToolSessionValue,
	recordToolMetadata,
} from "./shared";

export const FLOW_PLANNING_SESSION_TOOL_RUNTIME_BINDINGS = {
	flow_plan_start: { kind: "workspace", name: "plan_start" },
	flow_auto_prepare: { kind: "read", name: "load_resumable_session" },
} as const satisfies Record<
	string,
	| Extract<RuntimeActionBinding, { kind: "read" }>
	| Extract<RuntimeActionBinding, { kind: "workspace" }>
>;

export function createPlanningSessionTools() {
	return {
		flow_plan_start: tool({
			description: openCodeToolDescription("flow_plan_start"),
			args: FlowPlanStartArgsShape,
			execute: withParsedArgs(
				FlowPlanStartArgsSchema,
				async (input, context: ToolContext) => {
					recordToolMetadata(context, "Plan session start", {
						goal: input.goal ?? null,
						repoProfileCount: input.repoProfile?.length ?? 0,
					});
					return executeToolWorkspaceAction(
						context,
						FLOW_PLANNING_SESSION_TOOL_RUNTIME_BINDINGS.flow_plan_start.name,
						{
							...(input.goal ? { goal: input.goal } : {}),
							...(input.repoProfile ? { repoProfile: input.repoProfile } : {}),
							...(context.directory ? { directory: context.directory } : {}),
							missingGoalNextCommand: nextCommandForMissingGoal(),
						},
					);
				},
			),
		}),

		flow_auto_prepare: tool({
			description: openCodeToolDescription("flow_auto_prepare"),
			args: FlowAutoPrepareArgsShape,
			execute: withParsedArgs(
				FlowAutoPrepareArgsSchema,
				async (input, context: ToolContext) => {
					const resumableSession = await readToolSessionValue(
						context,
						FLOW_PLANNING_SESSION_TOOL_RUNTIME_BINDINGS.flow_auto_prepare.name,
						undefined,
					);
					const navigation = autoPreparePolicy(
						input.argumentString,
						resumableSession,
					);
					const response = autoPrepareResponse(
						navigation.mode,
						navigation.goal,
						navigation.nextCommand,
						resumableSession,
					);
					recordToolMetadata(context, `Flow auto (${response.metadata.mode})`, {
						mode: response.metadata.mode,
						goal: response.metadata.goal,
					});
					return response.payload;
				},
			),
		}),
	};
}
