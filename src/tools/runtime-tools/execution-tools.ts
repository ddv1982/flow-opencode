import { tool } from "@opencode-ai/plugin";
import {
	errorResponse,
	missingSessionResponse,
	withPersistedTransition,
} from "../../runtime/application";
import { FLOW_PLAN_WITH_GOAL_COMMAND } from "../../runtime/constants";
import type { WorkerResult } from "../../runtime/schema";
import { summarizeSession } from "../../runtime/summary";
import { completeRun, resetFeature, startRun } from "../../runtime/transitions";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowResetFeatureArgsSchema,
	FlowRunStartArgsSchema,
	type ToolContext,
	WorkerResultArgsSchema,
} from "../schemas";
import { flowRunStartArgsShape, workerResultArgsShape } from "./shared";

export function createExecutionRuntimeTools() {
	return {
		flow_run_start: tool({
			description: "Start the next runnable Flow feature",
			args: flowRunStartArgsShape,
			execute: withParsedArgs(
				FlowRunStartArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: input.featureId ? `Start ${input.featureId}` : "Start next",
						metadata: {
							sessionId: null,
							featureId: input.featureId ?? null,
							reason: null,
						},
					});
					return withPersistedTransition(
						context,
						(session) => startRun(session, input.featureId),
						{
							getSession: (value) => value.session,
							onSuccess: (saved, value) => {
								const summary = summarizeSession(saved);

								return {
									status:
										value.reason === "complete"
											? "complete"
											: value.feature
												? "ok"
												: "blocked",
									summary: summary.summary,
									session: summary.session,
									feature: value.feature,
									reason: value.reason,
								};
							},
							missingResponse: missingSessionResponse(
								"No active Flow session exists.",
								FLOW_PLAN_WITH_GOAL_COMMAND,
							),
						},
					);
				},
			),
		}),

		flow_run_complete_feature: tool({
			description: "Persist an already-validated Flow feature execution result",
			args: workerResultArgsShape,
			execute: withParsedArgs(
				WorkerResultArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Complete ${input.featureResult?.featureId ?? "feature"}`,
						metadata: {
							sessionId: null,
							featureId: input.featureResult?.featureId ?? null,
							status: input.status,
						},
					});
					return withPersistedTransition(
						context,
						(session) => completeRun(session, input as WorkerResult),
						{
							getSession: (value) => value,
							onSuccess: (saved) => {
								const summary = summarizeSession(saved);

								return {
									status: "ok",
									summary: summary.summary,
									session: summary.session,
								};
							},
							onError: (failure) =>
								errorResponse(failure.message, {
									recovery: failure.recovery,
								}),
						},
					);
				},
			),
		}),

		flow_reset_feature: tool({
			description: "Reset a Flow feature to pending",
			args:
				// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
				FlowResetFeatureArgsSchema.shape as any,
			execute: withParsedArgs(
				FlowResetFeatureArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Reset ${input.featureId}`,
						metadata: {
							sessionId: null,
							featureId: input.featureId,
						},
					});
					return withPersistedTransition(
						context,
						(session) => resetFeature(session, input.featureId),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: `Reset feature '${input.featureId}'.`,
								session: summarizeSession(saved).session,
							}),
						},
					);
				},
			),
		}),
	};
}
