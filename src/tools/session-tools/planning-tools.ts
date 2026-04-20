/**
 * Session tool boundary: planning/resume classification tool registrations only.
 * Keep response envelopes in responses.ts and next-command routing in
 * next-command-policy.ts.
 */
import { tool } from "@opencode-ai/plugin";
import { toJson } from "../../runtime/application";
import {
	createSession,
	loadSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../../runtime/session";
import { summarizeSession } from "../../runtime/summary";
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
import { autoPrepareResponse, missingGoalResponse } from "./responses";
import {
	recordToolMetadata,
	resolveMutableToolSessionRoot,
	resolveReadableToolSessionRoot,
} from "./shared";

function buildPlannedSession(
	existing: Awaited<ReturnType<typeof loadSession>>,
	goal: string,
	repoProfile?: string[],
) {
	const planningOptions = repoProfile ? { repoProfile } : undefined;
	const isNewGoal = Boolean(existing && goal !== existing.goal);

	if (!existing || existing.status === "completed" || isNewGoal) {
		return createSession(goal, planningOptions);
	}

	return {
		...existing,
		planning: {
			...existing.planning,
			repoProfile: repoProfile ?? existing.planning.repoProfile,
		},
	};
}

export function createPlanningSessionTools() {
	return {
		flow_plan_start: tool({
			description: "Create or refresh the active Flow planning session",
			args: FlowPlanStartArgsShape,
			execute: withParsedArgs(
				FlowPlanStartArgsSchema,
				async (input, context: ToolContext) => {
					const sessionRoot = resolveMutableToolSessionRoot(context);
					const existing = await loadSession(sessionRoot);

					if (!input.goal && !existing) {
						return missingGoalResponse(
							"Provide a goal to create a new Flow plan.",
							nextCommandForMissingGoal(),
						);
					}

					const goal = input.goal ?? existing?.goal;
					if (!goal) {
						return missingGoalResponse(
							"Provide a goal to create a new Flow plan.",
							nextCommandForMissingGoal(),
						);
					}

					const session = await saveSessionState(
						sessionRoot,
						buildPlannedSession(existing, goal, input.repoProfile),
					);
					await syncSessionArtifacts(sessionRoot, session);
					recordToolMetadata(context, `Plan: ${session.goal}`, {
						sessionId: session.id,
						goal: session.goal,
					});
					return toJson({
						status: "ok",
						summary: `Planning session ready for goal: ${session.goal}`,
						session: summarizeSession(session).session,
					});
				},
			),
		}),

		flow_auto_prepare: tool({
			description: "Classify a flow-auto invocation",
			args: FlowAutoPrepareArgsShape,
			execute: withParsedArgs(
				FlowAutoPrepareArgsSchema,
				async (input, context: ToolContext) => {
					const navigation = autoPreparePolicy(
						input.argumentString,
						await loadSession(resolveReadableToolSessionRoot(context)),
					);
					const response = autoPrepareResponse(
						navigation.mode,
						navigation.goal,
						navigation.nextCommand,
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
