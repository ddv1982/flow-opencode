import { errorResponse } from "../../application/flow-response.js";
import {
	FeatureCompleteInputSchema,
	FeatureResetInputSchema,
	PlanApproveInputSchema,
	PlanSaveInputSchema,
	ReviewStartInputSchema,
	RunStartInputSchema,
	SessionCloseInputSchema,
	StatusInputSchema,
	ValidationStartInputSchema,
	type ValidationStartRequest,
} from "../../application/schema.js";
import type { EvidencePlatform } from "../../domain/session.js";
import { FLOW_GUIDANCE_IDS, getFlowGuidance } from "../../guidance/catalog.js";
import { resolveWorkspaceRoot } from "../../infrastructure/fs/workspace.js";
import { createWorkspaceFlowService } from "../../infrastructure/fs/workspace-flow-service.js";
import type {
	AutoContinuationSupport,
	AutoTimingSnapshot,
} from "./auto-drive.js";
import { defineFlowTool } from "./schema-adapter.js";
import { type Hooks, type ToolContext, tool } from "./sdk.js";
import type { ValidationCaptureCoordinator } from "./validation-capture.js";

const host = tool.schema;
type FlowTools = NonNullable<Hooks["tool"]>;
type WorkspaceFlowService = ReturnType<typeof createWorkspaceFlowService>;

type ToolOptions = Readonly<{
	validation: ValidationCaptureCoordinator;
	prepareValidation: (
		workspace: string,
		input: ValidationStartRequest,
	) => Promise<{
		featureId: string;
		runId: string;
		command: string;
		scope: "focused" | "broad";
		sourceDigest: `sha256:${string}`;
		hostPlatform: EvidencePlatform;
		assertions: readonly string[];
		resultsPath: string | undefined;
	}>;
	autoTimingSnapshot?: (() => AutoTimingSnapshot | null) | undefined;
	autoContinuationSupport?: (() => AutoContinuationSupport) | undefined;
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
): FlowToolResponse {
	let workflowData = response.workflowData;
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

async function execute<T extends FlowToolResponse>(
	context: ToolContext,
	handler: (flow: WorkspaceFlowService) => Promise<T>,
): Promise<string> {
	try {
		return json(
			await handler(createWorkspaceFlowService(resolveWorkspaceRoot(context))),
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

export function createTools(_ctx: unknown, options: ToolOptions): FlowTools {
	return {
		flow_guidance: tool({
			description: "Load one concise package-owned Flow guide.",
			args: { id: host.enum(FLOW_GUIDANCE_IDS) },
			execute: async ({ id }) => getFlowGuidance(id).content,
		}),
		flow_status: defineFlowTool({
			description: "Read compact, execution, detail, or reviewer Flow state.",
			schema: StatusInputSchema,
			execute: (args, context) =>
				execute(context, async (workspace) =>
					withAutoContext(
						await workspace.status(args),
						options,
						args.request.view,
					),
				),
		}),
		flow_plan_save: defineFlowTool({
			description: "Create or replace the active draft plan.",
			schema: PlanSaveInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.planSave(args),
				),
		}),
		flow_plan_approve: defineFlowTool({
			description: "Approve the current draft plan.",
			schema: PlanApproveInputSchema,
			execute: (args, context) =>
				executeMutation(context, options.validation, (workspace) =>
					workspace.planApprove(args),
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
							),
							command: prepared.command,
							scope: prepared.scope,
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
