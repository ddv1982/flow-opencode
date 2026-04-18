import { tool } from "@opencode-ai/plugin";
import {
	errorResponse,
	missingSessionResponse,
	withPersistedTransition,
	withSession,
} from "../runtime/application";
import { FLOW_PLAN_WITH_GOAL_COMMAND } from "../runtime/constants";
import {
	normalizeReviewerDecision,
	normalizeWorkerResult,
} from "../runtime/contract-normalization";
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
	FlowRawPayloadArgsSchema,
	FlowRawPayloadArgsShape,
	FlowResetFeatureArgsSchema,
	FlowResetFeatureArgsShape,
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFeatureArgsShape,
	FlowReviewRecordFinalArgsSchema,
	FlowReviewRecordFinalArgsShape,
	FlowRunStartArgsSchema,
	FlowRunStartArgsShape,
	type ToolContext,
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
const flowRawPayloadArgsShape =
	// biome-ignore lint/suspicious/noExplicitAny: tool() is typed against the plugin's bundled Zod types while these shapes are sourced from the repo/runtime copy.
	FlowRawPayloadArgsShape as any;

function parseFeatureIds(raw?: string[]): string[] {
	return (raw ?? []).map((value) => value.trim()).filter(Boolean);
}

function toReviewerDecisionInput(
	input: ReturnType<typeof normalizeReviewerDecision> extends
		| { ok: true; value: infer TValue }
		| { ok: false; error: string }
		? TValue
		: never,
) {
	return {
		scope: input.scope,
		status: input.status,
		summary: input.summary,
		blockingFindings: input.blockingFindings ?? [],
		followUps: input.followUps ?? [],
		suggestedValidation: input.suggestedValidation ?? [],
		...(input.scope === "feature" ? { featureId: input.featureId } : {}),
	};
}

export function createRuntimeTools() {
	return {
		flow_plan_apply: tool({
			description: "Persist a Flow draft plan into the active session",
			args: flowPlanApplyArgsShape,
			execute: withParsedArgs(
				FlowPlanApplyArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Apply draft plan",
						metadata: {
							sessionId: null,
							featureCount: input.plan.features.length,
						},
					});
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
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Approve plan",
						metadata: {
							sessionId: null,
							approvedCount: parseFeatureIds(input.featureIds).length || null,
						},
					});
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
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Narrow plan",
						metadata: {
							sessionId: null,
							selectedCount: parseFeatureIds(input.featureIds).length,
						},
					});
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
			description:
				"Low-level/internal: persist an already-validated Flow feature execution result",
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
			description:
				"Low-level/internal: record an already-validated reviewer decision for the active feature",
			args: flowReviewRecordFeatureArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFeatureArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Reviewer ${input.status} ${input.featureId}`,
						metadata: {
							sessionId: null,
							featureId: input.featureId,
							status: input.status,
						},
					});
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

		flow_review_record_feature_from_raw: tool({
			description:
				"Normalize a raw reviewer payload and record the decision for the active feature",
			args: flowRawPayloadArgsShape,
			execute: withParsedArgs(
				FlowRawPayloadArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Normalize feature reviewer payload",
						metadata: {
							sessionId: null,
						},
					});
					return withSession(context, async (session) => {
						const activeFeatureId = session.execution.activeFeatureId;
						const normalized = normalizeReviewerDecision(
							input.raw,
							"feature",
							activeFeatureId ?? undefined,
						);
						if (!normalized.ok) {
							context.metadata?.({
								title: "Reviewer payload invalid",
								metadata: {
									sessionId: session.id,
									featureId: activeFeatureId,
								},
							});
							return JSON.stringify(
								errorResponse(normalized.error, {
									recovery: {
										errorCode: normalized.kind,
										resolutionHint:
											"Re-emit exactly one valid reviewer JSON object for the active feature and retry.",
										recoveryStage: "record_review",
										prerequisite: "reviewer_result_required",
										requiredArtifact: "feature_reviewer_decision",
										nextCommand: "Retry reviewer output with clean JSON.",
										nextRuntimeTool: "flow_review_record_feature_from_raw",
										retryable: true,
									},
								}),
								null,
								2,
							);
						}
						const decisionInput = toReviewerDecisionInput(normalized.value);

						context.metadata?.({
							title: `Reviewer ${decisionInput.status} ${
								decisionInput.scope === "feature"
									? decisionInput.featureId
									: "feature"
							}`,
							metadata: {
								sessionId: session.id,
								featureId:
									decisionInput.scope === "feature"
										? decisionInput.featureId
										: null,
								status: decisionInput.status,
							},
						});

						return withPersistedTransition(
							context,
							(current) => recordReviewerDecision(current, decisionInput),
							{
								getSession: (value) => value,
								onSuccess: (saved) => ({
									status: "ok",
									summary: "Reviewer decision recorded.",
									session: summarizeSession(saved).session,
								}),
							},
						);
					});
				},
			),
		}),

		flow_review_record_final: tool({
			description:
				"Low-level/internal: record an already-validated reviewer decision for final cross-feature validation",
			args: flowReviewRecordFinalArgsShape,
			execute: withParsedArgs(
				FlowReviewRecordFinalArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: `Final reviewer ${input.status}`,
						metadata: {
							sessionId: null,
							status: input.status,
						},
					});
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

		flow_review_record_final_from_raw: tool({
			description:
				"Normalize a raw reviewer payload and record the final reviewer decision",
			args: flowRawPayloadArgsShape,
			execute: withParsedArgs(
				FlowRawPayloadArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Normalize final reviewer payload",
						metadata: {
							sessionId: null,
						},
					});
					return withSession(context, async (session) => {
						const normalized = normalizeReviewerDecision(input.raw, "final");
						if (!normalized.ok) {
							context.metadata?.({
								title: "Final reviewer payload invalid",
								metadata: {
									sessionId: session.id,
								},
							});
							return JSON.stringify(
								errorResponse(normalized.error, {
									recovery: {
										errorCode: normalized.kind,
										resolutionHint:
											"Re-emit exactly one valid final-reviewer JSON object and retry.",
										recoveryStage: "record_review",
										prerequisite: "reviewer_result_required",
										requiredArtifact: "final_reviewer_decision",
										nextCommand: "Retry final reviewer output with clean JSON.",
										nextRuntimeTool: "flow_review_record_final_from_raw",
										retryable: true,
									},
								}),
								null,
								2,
							);
						}

						const decisionInput = toReviewerDecisionInput(normalized.value);
						context.metadata?.({
							title: `Final reviewer ${decisionInput.status}`,
							metadata: {
								sessionId: session.id,
								status: decisionInput.status,
							},
						});

						return withPersistedTransition(
							context,
							(current) => recordReviewerDecision(current, decisionInput),
							{
								getSession: (value) => value,
								onSuccess: (saved) => ({
									status: "ok",
									summary: "Reviewer decision recorded.",
									session: summarizeSession(saved).session,
								}),
							},
						);
					});
				},
			),
		}),

		flow_run_complete_feature_from_raw: tool({
			description:
				"Normalize a raw worker payload and persist the result of a Flow feature execution",
			args: flowRawPayloadArgsShape,
			execute: withParsedArgs(
				FlowRawPayloadArgsSchema,
				async (input, context: ToolContext) => {
					context.metadata?.({
						title: "Normalize worker payload",
						metadata: {
							sessionId: null,
						},
					});
					return withSession(context, async (session) => {
						const normalized = normalizeWorkerResult(
							input.raw,
							session.execution.activeFeatureId ?? undefined,
						);
						if (!normalized.ok) {
							context.metadata?.({
								title: "Worker payload invalid",
								metadata: {
									sessionId: session.id,
									featureId: session.execution.activeFeatureId,
								},
							});
							return JSON.stringify(
								errorResponse(normalized.error, {
									recovery: {
										errorCode: normalized.kind,
										resolutionHint:
											"Re-emit exactly one valid worker JSON object for the active feature and retry.",
										recoveryStage: "retry_completion",
										prerequisite: "completion_payload_rebuild_required",
										requiredArtifact: "feature_review_payload",
										nextCommand: "Retry worker output with clean JSON.",
										nextRuntimeTool: "flow_run_complete_feature_from_raw",
										retryable: true,
									},
								}),
								null,
								2,
							);
						}

						context.metadata?.({
							title: `Complete ${normalized.value.featureResult.featureId}`,
							metadata: {
								sessionId: session.id,
								featureId: normalized.value.featureResult.featureId,
								status: normalized.value.status,
							},
						});

						return withPersistedTransition(
							context,
							(current) =>
								completeRun(current, normalized.value as WorkerResult),
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
					});
				},
			),
		}),

		flow_reset_feature: tool({
			description: "Reset a Flow feature to pending",
			args: FlowResetFeatureArgsShape,
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
