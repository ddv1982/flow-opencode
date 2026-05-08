import { join } from "node:path";
import { toJson } from "../../../../runtime/application";
import {
	isFlowAttachmentAbortError,
	materializeFlowAttachments,
	resolveDestinationDirectory,
} from "../../attachment-materialization";
import {
	describeSupportedAttachmentFormats,
	selectFlowAttachments,
} from "../../attachment-store";
import { tool } from "../../sdk";
import {
	ensureMutableWorkspacePermission,
	resolveMutableToolWorkspace,
} from "../mutable-workspace-permission";
import { withParsedArgs } from "../parsed-tool";
import {
	FlowAttachmentsMaterializeArgsSchema,
	FlowAttachmentsMaterializeArgsShape,
	type ToolContext,
} from "../schemas";
import { openCodeToolDescription } from "../tool-registry";
import { recordToolMetadata } from "./shared";

type AttachmentMaterializeStatus = "ok" | "partial" | "error";

type AttachmentToolResponse = {
	status: AttachmentMaterializeStatus;
	summary: string;
	imported: unknown[];
	skipped: unknown[];
};

export function createAttachmentSessionTools() {
	return {
		flow_attachments_materialize: tool({
			description: openCodeToolDescription("flow_attachments_materialize"),
			args: FlowAttachmentsMaterializeArgsShape,
			execute: withParsedArgs(
				FlowAttachmentsMaterializeArgsSchema,
				async (input, context: ToolContext) => {
					const supportedFormats = describeSupportedAttachmentFormats();
					const respond = (
						response: AttachmentToolResponse,
						metadata: Record<string, unknown> = {},
					) => {
						recordToolMetadata(context, "Attachment materialization", {
							status: response.status,
							importedCount: response.imported.length,
							skippedCount: response.skipped.length,
							supportedFormats,
							...metadata,
						});
						return toJson(response);
					};

					if (context.agent !== "flow-auto") {
						return respond({
							status: "error",
							summary:
								"flow_attachments_materialize requires a flow-auto tool context.",
							imported: [],
							skipped: [],
						});
					}
					if (!context.sessionID) {
						return respond({
							status: "error",
							summary:
								"flow_attachments_materialize requires an OpenCode sessionID to scope captured attachments.",
							imported: [],
							skipped: [],
						});
					}

					const selection = selectFlowAttachments({
						sessionId: context.sessionID,
						messageId: context.messageID,
						selectors: input.attachments,
					});
					if (selection.selected.length === 0) {
						return respond(
							{
								status: "error",
								summary: "No attachments were materialized.",
								imported: [],
								skipped: selection.skipped,
							},
							{ destinationDirectory: input.destinationDirectory },
						);
					}

					const resolvedWorkspace = resolveMutableToolWorkspace(context);
					let destinationDirectory: string;
					try {
						destinationDirectory = resolveDestinationDirectory(
							resolvedWorkspace.root,
							input.destinationDirectory,
						);
					} catch (error) {
						return respond(
							{
								status: "error",
								summary: "No attachments were materialized.",
								imported: [],
								skipped: [
									{
										reason:
											error instanceof Error
												? error.message
												: "Attachment destination is invalid.",
									},
								],
							},
							{ destinationDirectory: input.destinationDirectory },
						);
					}

					const workspaceRoot = await ensureMutableWorkspacePermission(
						context,
						resolvedWorkspace,
					);
					await context.ask?.({
						permission: "edit",
						patterns: [join(destinationDirectory, "**")],
						always: [join(destinationDirectory, "**")],
						metadata: {
							workspaceRoot,
							destinationDirectory,
							reason:
								"Flow is about to materialize captured OpenCode attachments into workspace files.",
						},
					});

					const result = await materializeFlowAttachments({
						attachments: selection.selected,
						destinationDirectory: input.destinationDirectory,
						workspaceRoot,
						abort: context.abort,
					}).catch((error: unknown) => {
						if (context.abort?.aborted || isFlowAttachmentAbortError(error)) {
							throw error;
						}
						return {
							imported: [],
							skipped: [
								{
									reason:
										error instanceof Error
											? error.message
											: "Attachment materialization failed.",
								},
							],
						};
					});
					const skipped = [...selection.skipped, ...result.skipped];
					const status = attachmentMaterializeStatus(
						result.imported.length,
						skipped.length,
					);
					return respond(
						{
							status,
							summary: attachmentMaterializeSummary(
								result.imported.length,
								skipped.length,
							),
							imported: result.imported,
							skipped,
						},
						{ destinationDirectory },
					);
				},
			),
		}),
	};
}

function attachmentMaterializeStatus(
	importedCount: number,
	skippedCount: number,
): AttachmentMaterializeStatus {
	return importedCount === 0 ? "error" : skippedCount > 0 ? "partial" : "ok";
}

function attachmentMaterializeSummary(
	importedCount: number,
	skippedCount: number,
): string {
	return importedCount === 0
		? "No attachments were materialized."
		: skippedCount > 0
			? `Materialized ${importedCount} attachment(s); skipped ${skippedCount}.`
			: `Materialized ${importedCount} attachment(s).`;
}
