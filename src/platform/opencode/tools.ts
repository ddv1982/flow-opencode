import { z } from "zod";
import { errorResponse } from "../../application/flow-response.js";
import type { PreparedValidation } from "../../application/prepare-validation.js";
import type { RecoveryController } from "../../application/recovery-policy.js";
import {
	FeatureCompleteInputSchema,
	FeatureResetInputSchema,
	PlanAmendInputSchema,
	PlanApproveInputSchema,
	PlanSaveInputSchema,
	ReviewStartInputSchema,
	RunStartInputSchema,
	SessionCloseInputSchema,
	StatusInputSchema,
	ValidationStartInputSchema,
	type ValidationStartRequest,
} from "../../application/schema.js";
import { statusReport } from "../../application/session-projection.js";
import {
	type FlowCodingModel,
	type FlowReviewerConfiguration,
	flowModelStatus,
	flowReviewerStatus,
} from "../../config-shared.js";
import { requestAuthority } from "../../domain/request-evidence.js";
import { FLOW_GUIDANCE_IDS, getFlowGuidance } from "../../guidance/catalog.js";
import { createWorkspaceFlowService } from "../../infrastructure/fs/workspace-flow-service.js";
import { resolveWorkspaceRoot } from "../../infrastructure/fs/workspace-paths.js";
import type {
	AutoContinuationSnapshot,
	AutoTimingSnapshot,
	AutoValidationOrigin,
	ProcessLocalAutoContinuationSupport,
} from "./auto-drive.js";
import {
	defineFlowTool,
	type FlowToolContext,
	type FlowToolResponse,
	type FlowTools,
} from "./flow-tool.js";
import type { ValidationCaptureCoordinator } from "./validation-capture.js";

type WorkspaceFlowService = ReturnType<typeof createWorkspaceFlowService>;

type ToolOptions = Readonly<{
	recovery?: RecoveryController;
	onRecoveryOutcome?: (outcome: unknown) => Promise<void>;
	validation: ValidationCaptureCoordinator;
	prepareValidation: (
		workspace: string,
		input: ValidationStartRequest,
	) => Promise<PreparedValidation>;
	autoTimingSnapshot?: (() => AutoTimingSnapshot | null) | undefined;
	autoContinuationSnapshot?: (
		hostSessionId: string,
	) => AutoContinuationSnapshot | null;
	validationOrigin?: (
		hostSessionId: string,
		assistantId: string,
		prepared: Pick<
			AutoValidationOrigin,
			| "featureId"
			| "runId"
			| "sourceDigest"
			| "command"
			| "scope"
			| "hostPlatform"
			| "intent"
			| "declaredPlatform"
			| "assertions"
		>,
	) => AutoValidationOrigin | null;
	autoContinuationSupport?:
		| (() => ProcessLocalAutoContinuationSupport)
		| undefined;
	reviewerConfiguration?: FlowReviewerConfiguration | undefined;
	readReviewerConfiguration?: () => FlowReviewerConfiguration;
	readPlanningModel?: () => string | undefined;
	readCodingModel?: (sessionID: string) => FlowCodingModel | undefined;
	runtimeIdentity?:
		| Readonly<{ packageVersion: string; pluginEntrySha256: string }>
		| undefined;
}>;

function toolError(error: unknown): FlowToolResponse {
	return errorResponse(error);
}

function bestEffort<Value>(read: () => Value): Value | undefined {
	try {
		return read();
	} catch {
		return undefined;
	}
}

function withAutoContext(
	response: FlowToolResponse,
	options: ToolOptions,
	view?: string,
	sessionID?: string,
): FlowToolResponse {
	let workflowData = response.workflowData;
	const reviewer =
		options.readReviewerConfiguration?.() ?? options.reviewerConfiguration;
	if (reviewer) {
		workflowData = {
			...workflowData,
			reviewerConfiguration: flowReviewerStatus(reviewer),
		};
	}
	workflowData = {
		...workflowData,
		modelConfiguration: flowModelStatus(
			options.readPlanningModel?.(),
			sessionID ? options.readCodingModel?.(sessionID) : undefined,
			reviewer,
		),
	};
	if (options.runtimeIdentity)
		workflowData = {
			...workflowData,
			runtimeIdentity: options.runtimeIdentity,
		};
	const timing =
		view === "detail"
			? bestEffort(() => options.autoTimingSnapshot?.())
			: undefined;
	if (timing) workflowData = { ...workflowData, autoTiming: timing };
	const continuation = sessionID
		? bestEffort(() => options.autoContinuationSnapshot?.(sessionID))
		: undefined;
	if (continuation) workflowData = { ...workflowData, autoDrive: continuation };
	const support = bestEffort(() => options.autoContinuationSupport?.());
	if (support === "supported" || support === "unsupported") {
		workflowData = {
			...workflowData,
			autoContinuation: {
				scope: "current-plugin-process",
				support,
				...(support === "unsupported"
					? {
							reason: "host-request-attribution-unavailable",
							recovery: "Drive each feature with /flow-run.",
						}
					: {}),
			},
		};
	}
	return workflowData === response.workflowData
		? response
		: { ...response, workflowData };
}

export function createTools(options: ToolOptions): FlowTools {
	async function execute<T extends FlowToolResponse>(
		context: FlowToolContext,
		handler: (flow: WorkspaceFlowService) => Promise<T>,
	): Promise<FlowToolResponse> {
		try {
			return await handler(
				createWorkspaceFlowService(
					resolveWorkspaceRoot(context),
					options.recovery?.guard({
						hostSessionId: context.sessionID,
						messageId: context.messageID,
						agent: context.agent,
					}),
				),
			);
		} catch (error) {
			return toolError(error);
		}
	}

	function executeMutation<T extends FlowToolResponse>(
		context: FlowToolContext,
		validation: ValidationCaptureCoordinator,
		handler: (flow: WorkspaceFlowService) => Promise<T>,
	): Promise<FlowToolResponse> {
		validation.cancel(context.sessionID);
		return execute(context, handler);
	}

	function executeReviewerMutation<T extends FlowToolResponse>(
		context: FlowToolContext,
		handler: (flow: WorkspaceFlowService) => Promise<T>,
		replayHandler: (flow: WorkspaceFlowService) => Promise<T>,
	): Promise<FlowToolResponse> {
		if (context.agent !== "flow-reviewer") {
			return execute(context, replayHandler);
		}
		return execute(context, handler);
	}

	return {
		flow_guidance: defineFlowTool({
			description: "Load one concise package-owned Flow guide.",
			schema: z.object({ id: z.enum(FLOW_GUIDANCE_IDS) }),
			execute: async ({ id }) => getFlowGuidance(id).content,
		}),
		flow_status: defineFlowTool({
			description:
				"Read compact, execution, detail, reviewer state, or bounded reviewer-evidence pages.",
			schema: StatusInputSchema,
			execute: (args, context) =>
				execute(context, async (workspace) => {
					const response = await workspace.status(args);
					if (
						"recovery" in response.workflowData &&
						options.onRecoveryOutcome
					) {
						try {
							await options.onRecoveryOutcome(response.workflowData.recovery);
						} catch {}
					}
					const workflowData =
						"projection" in response.workflowData
							? {
									...response.workflowData,
									statusReport: statusReport(response.workflowData.projection),
									...(options.recovery
										? {
												recovery: options.recovery.snapshot(context.sessionID),
												recoveryStatus: options.recovery.snapshot(
													context.sessionID,
												),
												...("recovery" in response.workflowData
													? { recovery: response.workflowData.recovery }
													: {}),
											}
										: {}),
								}
							: response.workflowData;
					return withAutoContext(
						{
							...response,
							workflowData,
						},
						options,
						args.request.view,
						context.sessionID,
					);
				}),
		}),
		flow_plan_save: defineFlowTool({
			description: "Create or replace the active draft plan.",
			schema: PlanSaveInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.planSave(args, requestAuthority(context.sessionID)),
				),
		}),
		flow_plan_approve: defineFlowTool({
			description: "Approve the current draft plan.",
			schema: PlanApproveInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.planApprove(args, requestAuthority(context.sessionID)),
				),
		}),
		flow_plan_amend: defineFlowTool({
			description:
				"Record a same-goal reversible prerequisite repair after a failed canonical gate, without an amendment count limit. This does not change the approved plan or bypass review.",
			schema: PlanAmendInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.planAmend(args),
				),
		}),
		flow_run_start: defineFlowTool({
			description: "Start one runnable approved feature.",
			schema: RunStartInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.runStart(args),
				),
		}),
		flow_validation_start: defineFlowTool({
			description:
				"Arm host observation for the exact next shell command; its result is recorded directly in Session v5.",
			schema: ValidationStartInputSchema,
			execute: async (args, context) => {
				try {
					const workspace = resolveWorkspaceRoot(context);
					const prepared = await options.prepareValidation(
						workspace,
						args.request,
					);
					await context.assertCurrent?.();
					return {
						status: "ok",
						summary: "Validation armed for the exact next shell command.",
						workflowData: {
							capture: options.validation.arm(
								context.sessionID,
								workspace,
								prepared,
								options.validationOrigin?.(
									context.sessionID,
									context.messageID,
									prepared,
								) ?? null,
							),
							command: prepared.command,
							scope: prepared.scope,
							intent: prepared.intent,
						},
					};
				} catch (error) {
					return toolError(error);
				}
			},
		}),
		flow_review_start: defineFlowTool({
			description:
				"Create one independent review assignment using current applicable validation.",
			schema: ReviewStartInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.reviewStart(args),
				),
		}),
		flow_feature_complete: defineFlowTool({
			description:
				"Submit a pending review result; only the reviewer may create a new completion, while exact accepted requests remain replayable for an active Session v5 workflow.",
			schema: FeatureCompleteInputSchema,
			execute: (args, context) =>
				executeReviewerMutation(
					context,
					(workspace) => workspace.featureComplete(args),
					(workspace) => workspace.featureCompleteReplay(args),
				),
		}),
		flow_feature_reset: defineFlowTool({
			description:
				"Reset dependents and optionally start one exact next run atomically.",
			schema: FeatureResetInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.featureReset(args),
				),
		}),
		flow_session_close: defineFlowTool({
			description: "Close and archive a session in one convergent operation.",
			schema: SessionCloseInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.sessionClose(args),
				),
		}),
	};
}

export async function registerFlowTools(
	ctx: {
		tool: Pick<import("./sdk.js").PluginContext["tool"], "transform">;
		permission: Pick<import("./sdk.js").PluginContext["permission"], "assert">;
		location: Pick<import("./sdk.js").PluginContext["location"], "directory">;
	},
	tools: FlowTools,
	beforeTool: (context: import("./sdk.js").ToolContext) => Promise<void>,
) {
	const directory = resolveWorkspaceRoot({ directory: ctx.location.directory });
	return ctx.tool.transform((editor) => {
		for (const [name, definition] of Object.entries(tools)) {
			editor.remove(name);
			editor.add({
				name,
				description: definition.description,
				input: definition.input,
				options: { codemode: false, permission: name },
				execute: async (input: unknown, context) => {
					const request =
						input && typeof input === "object" && "request" in input
							? input.request
							: null;
					const resources: string[] = [];
					if (request && typeof request === "object") {
						for (const key of [
							"featureId",
							"nextFeatureId",
							"sessionId",
						] as const) {
							const value = Reflect.get(request, key);
							if (typeof value === "string") resources.push(value);
						}
					}
					if (
						input &&
						typeof input === "object" &&
						"id" in input &&
						typeof input.id === "string"
					)
						resources.push(input.id);
					await ctx.permission.assert({
						sessionID: context.sessionID,
						agent: context.agent,
						action: name,
						resources: resources.length ? resources : [directory],
						source: {
							type: "tool",
							messageID: context.messageID,
							id: context.id,
						},
					});
					await beforeTool(context);
					if (context.signal.aborted)
						throw new Error("Flow tool execution was cancelled.");
					const value = await definition.execute(input, {
						sessionID: context.sessionID,
						messageID: context.messageID,
						callID: context.id,
						agent: context.agent,
						directory,
						abort: context.signal,
						assertCurrent: () => beforeTool(context),
					});
					return {
						content: [
							{
								type: "text",
								text:
									typeof value === "string"
										? value
										: JSON.stringify(value, null, 2),
							},
						],
					};
				},
			});
		}
	});
}
