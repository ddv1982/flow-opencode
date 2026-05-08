/**
 * Session tool boundary: planning/resume classification tool registrations only.
 * Keep runtime response shaping in the runtime/application boundary and
 * next-command routing in next-command-policy.ts.
 */

import {
	type AutoPrepareAttachmentGuidance,
	autoPrepareResponse,
} from "../../../../runtime/application";
import {
	describeFlowAttachmentAvailability,
	type FlowAttachmentAvailabilitySnapshot,
} from "../../attachment-store";
import { tool } from "../../sdk";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowAutoPrepareArgsSchema,
	FlowAutoPrepareArgsShape,
	FlowPlanStartArgsSchema,
	FlowPlanStartArgsShape,
	type ToolContext,
} from "../schemas";
import {
	openCodeToolDescription,
	openCodeToolRuntimeActionName,
} from "../tool-registry";
import {
	autoPreparePolicy,
	nextCommandForMissingGoal,
} from "./next-command-policy";
import {
	executeToolWorkspaceAction,
	readToolSessionValue,
	recordToolMetadata,
} from "./shared";

const FLOW_AUTO_ATTACHMENT_DESTINATION_DIRECTORY = "assets/flow-attachments";

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
						openCodeToolRuntimeActionName("flow_plan_start", "workspace"),
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
						openCodeToolRuntimeActionName("flow_auto_prepare", "read"),
						undefined,
					);
					const navigation = autoPreparePolicy(
						input.argumentString,
						resumableSession,
					);
					const attachmentGuidance = autoPrepareAttachmentGuidance(
						describeFlowAttachmentAvailability({
							sessionId: context.sessionID,
							messageId: context.messageID,
						}),
					);
					const response = autoPrepareResponse(
						navigation.mode,
						navigation.goal,
						navigation.nextCommand,
						resumableSession,
						attachmentGuidance,
					);
					recordToolMetadata(context, `Flow auto (${response.metadata.mode})`, {
						mode: response.metadata.mode,
						goal: response.metadata.goal,
						attachmentStatus: response.metadata.attachmentStatus,
						attachmentMaterializationRequired:
							response.metadata.attachmentMaterializationRequired,
					});
					return response.payload;
				},
			),
		}),
	};
}

function autoPrepareAttachmentGuidance(
	snapshot: FlowAttachmentAvailabilitySnapshot,
): AutoPrepareAttachmentGuidance {
	return {
		status: snapshot.status,
		source: snapshot.source,
		supportedFormats: snapshot.supportedFormats,
		unsupportedFormats: ["SVG"],
		materializationRequired: snapshot.materializationRequired,
		materialize: snapshot.materializationRequired
			? {
					tool: "flow_attachments_materialize",
					args: {
						destinationDirectory: FLOW_AUTO_ATTACHMENT_DESTINATION_DIRECTORY,
					},
					requiredBefore: ["planning", "repo_inspection", "task_handoff"],
					useImplicitCurrentBatch: true,
				}
			: null,
		attachments: snapshot.attachments.map((attachment) => ({
			id: attachment.id,
			...(attachment.filename ? { filename: attachment.filename } : {}),
			mime: attachment.mime,
		})),
		skipped: snapshot.skipped,
		reason: snapshot.reason,
	};
}
