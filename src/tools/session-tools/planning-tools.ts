/**
 * Session tool boundary: planning/resume classification tool registrations only.
 * Keep runtime response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";
import {
	autoPrepareResponse,
	executeDispatchedSessionWorkspaceAction,
	runDispatchedSessionReadAction,
} from "../../runtime/application";
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
import { recordToolMetadata } from "./shared";

export function createPlanningSessionTools() {
	return {
		flow_plan_start: tool({
			description: "Create or refresh the active Flow planning session",
			args: FlowPlanStartArgsShape,
			execute: withParsedArgs(
				FlowPlanStartArgsSchema,
				async (input, context: ToolContext) => {
					recordToolMetadata(context, "Plan session start", {
						goal: input.goal ?? null,
						repoProfileCount: input.repoProfile?.length ?? 0,
					});
					return executeDispatchedSessionWorkspaceAction(
						context,
						"plan_start",
						{
							...(input.goal ? { goal: input.goal } : {}),
							...(input.repoProfile ? { repoProfile: input.repoProfile } : {}),
							missingGoalNextCommand: nextCommandForMissingGoal(),
						},
					);
				},
			),
		}),

		flow_auto_prepare: tool({
			description: "Classify a flow-auto invocation",
			args: FlowAutoPrepareArgsShape,
			execute: withParsedArgs(
				FlowAutoPrepareArgsSchema,
				async (input, context: ToolContext) => {
					const resumableSession = (
						await runDispatchedSessionReadAction(
							context,
							"load_resumable_session",
							undefined,
						)
					).value;
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
