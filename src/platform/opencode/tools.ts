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
import { defineFlowTool } from "./schema-adapter.js";
import { type Hooks, type ToolContext, tool } from "./sdk.js";
import type { ValidationCaptureCoordinator } from "./validation-capture.js";

const host = tool.schema;
type FlowTools = NonNullable<Hooks["tool"]>;
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

function json(value: unknown): string {
	const serialized = JSON.stringify(value, null, 2);
	if (serialized === undefined) {
		throw new Error("Flow tool response could not be serialized.");
	}
	return serialized;
}

type FlowToolResponse = Readonly<{
	status: "ok" | "error";
	summary: string;
	workflowData: object;
}>;

function toolError(error: unknown): string {
	return json(errorResponse(error));
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
	// `unknown` is withheld deliberately: before any assistant message exists it
	// is the absence of a signal, and reporting it invites a caller to relay it as
	// a limitation.
	if (support === "supported" || support === "unsupported") {
		workflowData = {
			...workflowData,
			autoContinuation: {
				scope: "current-plugin-process",
				support,
				...(support === "unsupported"
					? {
							reason: "host-reports-no-assistant-message-parentage",
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
		context: ToolContext,
		handler: (flow: WorkspaceFlowService) => Promise<T>,
	): Promise<string> {
		try {
			return json(
				await handler(
					createWorkspaceFlowService(
						resolveWorkspaceRoot(context),
						options.recovery?.guard({
							hostSessionId: context.sessionID,
							messageId: context.messageID,
							agent: context.agent,
						}),
					),
				),
			);
		} catch (error) {
			return toolError(error);
		}
	}

	function executeMutation<T extends FlowToolResponse>(
		context: ToolContext,
		validation: ValidationCaptureCoordinator,
		handler: (flow: WorkspaceFlowService) => Promise<T>,
	): Promise<string> {
		validation.cancel(context.sessionID);
		return execute(context, handler);
	}

	function executeReviewerMutation<T extends FlowToolResponse>(
		context: ToolContext,
		handler: (flow: WorkspaceFlowService) => Promise<T>,
		replayHandler: (flow: WorkspaceFlowService) => Promise<T>,
	): Promise<string> {
		if (context.agent !== "flow-reviewer") {
			return execute(context, replayHandler);
		}
		return execute(context, handler);
	}

	return {
		flow_guidance: tool({
			description: "Load one concise package-owned Flow guide.",
			args: { id: host.enum(FLOW_GUIDANCE_IDS) },
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
						} catch {
							// A missing TUI cannot change the Flow status result.
						}
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
				"Record at most three same-goal reversible prerequisite repairs after a failed canonical gate. This does not change the approved plan or bypass review.",
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
				"Arm host observation for the exact next Bash command; its result is recorded directly in Session v5.",
			schema: ValidationStartInputSchema,
			execute: async (args, context) => {
				try {
					const workspace = resolveWorkspaceRoot(context);
					const prepared = await options.prepareValidation(
						workspace,
						args.request,
					);
					return json({
						status: "ok",
						summary: "Validation armed for the exact next Bash command.",
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
					});
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
