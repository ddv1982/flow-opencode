import { tool } from "@opencode-ai/plugin";
import {
	errorResponse,
	missingSessionResponse,
	withPersistedTransition,
} from "../runtime/application";
import { FLOW_PLAN_WITH_GOAL_COMMAND } from "../runtime/constants";
import type { WorkerResult } from "../runtime/schema";
import { summarizeSession } from "../runtime/summary";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	resetFeature,
	selectPlanFeatures,
	startRun,
} from "../runtime/transitions";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowPlanApplyArgsSchema,
	FlowPlanApproveArgsSchema,
	FlowPlanApproveArgsShape,
	FlowPlanSelectArgsSchema,
	FlowPlanSelectArgsShape,
	FlowResetFeatureArgsSchema,
	FlowResetFeatureArgsShape,
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFeatureArgsShape,
	FlowReviewRecordFinalArgsSchema,
	FlowReviewRecordFinalArgsShape,
	FlowRunStartArgsSchema,
	FlowRunStartArgsShape,
	WorkerResultArgsSchema,
	WorkerResultArgsShape,
} from "./schemas";

const flowPlanApplyArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowPlanApplyArgsSchema.shape as any;
const workerResultArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	WorkerResultArgsShape as any;
const flowReviewRecordFeatureArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowReviewRecordFeatureArgsShape as any;
const flowReviewRecordFinalArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowReviewRecordFinalArgsShape as any;

function parseFeatureIds(raw?: string[]): string[] {
	return (raw ?? []).map((value) => value.trim()).filter(Boolean);
}

export function createRuntimeTools() {
	return {
		flow_plan_apply: tool({
			description: "Persist a Flow draft plan into the active session",
			args: flowPlanApplyArgsShape,
			execute: withParsedArgs(
				FlowPlanApplyArgsSchema,
				async (input, context) => {
					const planning =
						input.planning === undefined
							? undefined
							: (Object.fromEntries(
									Object.entries(input.planning).filter(
										([, value]) => value !== undefined,
									),
								) as Parameters<typeof applyPlan>[2]);
					return withPersistedTransition(
						context,
						(session) => applyPlan(session, { ...input.plan }, planning),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Draft plan saved.",
								session: summarizeSession(saved).session,
							}),
							missingResponse: missingSessionResponse(
								"No active Flow planning session exists.",
								FLOW_PLAN_WITH_GOAL_COMMAND,
							),
						},
					);
				},
			),
		}),

		flow_plan_approve: tool({
			description: "Approve the active Flow draft plan",
			args: FlowPlanApproveArgsShape,
			execute: withParsedArgs(
				FlowPlanApproveArgsSchema,
				async (input, context) => {
					return withPersistedTransition(
						context,
						(session) =>
							approvePlan(session, parseFeatureIds(input.featureIds)),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Plan approved.",
								session: summarizeSession(saved).session,
							}),
						},
					);
				},
			),
		}),

		flow_plan_select_features: tool({
			description: "Keep only selected features in the active Flow draft plan",
			args: FlowPlanSelectArgsShape,
			execute: withParsedArgs(
				FlowPlanSelectArgsSchema,
				async (input, context) => {
					return withPersistedTransition(
						context,
						(session) =>
							selectPlanFeatures(session, parseFeatureIds(input.featureIds)),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Draft plan narrowed.",
								session: summarizeSession(saved).session,
							}),
						},
					);
				},
			),
		}),

		flow_run_start: tool({
			description: "Start the next runnable Flow feature",
			args: FlowRunStartArgsShape,
			execute: withParsedArgs(
				FlowRunStartArgsSchema,
				async (input, context) => {
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
			description: "Persist the result of a Flow feature execution",
			args: workerResultArgsShape,
			execute: withParsedArgs(
				WorkerResultArgsSchema,
				async (input, context) => {
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
							onError: (failure) => {
								return errorResponse(failure.message, {
									recovery: failure.recovery,
								});
							},
						},
					);
				},
			),
		}),

		flow_review_record_feature: tool({
			description: "Record the reviewer decision for the active feature",
			args: flowReviewRecordFeatureArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFeatureArgsSchema,
				async (input, context) => {
					return withPersistedTransition(
						context,
						(session) => recordReviewerDecision(session, input),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Reviewer decision recorded.",
								session: summarizeSession(saved).session,
							}),
						},
					);
				},
			),
		}),

		flow_review_record_final: tool({
			description:
				"Record the reviewer decision for final cross-feature validation",
			args: flowReviewRecordFinalArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFinalArgsSchema,
				async (input, context) => {
					return withPersistedTransition(
						context,
						(session) => recordReviewerDecision(session, input),
						{
							getSession: (value) => value,
							onSuccess: (saved) => ({
								status: "ok",
								summary: "Reviewer decision recorded.",
								session: summarizeSession(saved).session,
							}),
						},
					);
				},
			),
		}),

		flow_reset_feature: tool({
			description: "Reset a Flow feature to pending",
			args: FlowResetFeatureArgsShape,
			execute: withParsedArgs(
				FlowResetFeatureArgsSchema,
				async (input, context) => {
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
