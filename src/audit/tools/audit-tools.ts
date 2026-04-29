/**
 * Audit tool boundary: audit artifact export only.
 */
import { tool } from "@opencode-ai/plugin";
import {
	errorResponse,
	InvalidFlowWorkspaceRootError,
	parseToolArgs,
	toJson,
} from "../../runtime/application";
import { parseStrictJsonObject } from "../../runtime/json/strict-object";
import { ensureMutableWorkspacePermission } from "../../tools/mutable-workspace-permission";
import type { ToolContext } from "../../tools/schemas";
import { recordToolMetadata } from "../../tools/session-tools/shared";
import type { AuditReportArgs } from "../schema";
import {
	FlowAuditWriteReportArgsSchema,
	FlowAuditWriteReportArgsShape,
} from "./schemas";

function workspaceErrorResponse(error: InvalidFlowWorkspaceRootError) {
	return toJson(
		errorResponse(error.summary, {
			workspaceRoot: error.details.root,
			workspace: error.details,
			remediation: error.remediation,
		}),
	);
}

function invalidJsonResponse(): string {
	return toJson(
		errorResponse(
			"Tool argument validation failed: reportJson: Expected a valid JSON string payload.",
		),
	);
}

async function parseAuditReportArgs(
	args: unknown,
): Promise<
	{ ok: true; value: AuditReportArgs } | { ok: false; response: string }
> {
	const { AuditReportBaseSchema, AuditReportSchema } = await import(
		"../schema"
	);
	const parsePayload = (input: unknown) =>
		AuditReportSchema.safeParse(input).success
			? AuditReportSchema.parse(input)
			: AuditReportBaseSchema.strict().parse(input);
	const transportParsed = parseToolArgs(FlowAuditWriteReportArgsSchema, args);
	if (transportParsed.ok) {
		const payload = parseStrictJsonObject(
			transportParsed.value.reportJson,
			"reportJson JSON string",
		);
		if (!payload.ok) {
			return { ok: false, response: invalidJsonResponse() };
		}
		return { ok: true, value: parsePayload(payload.value) };
	}
	try {
		const legacyValue = (args as { report?: unknown } | null)?.report;
		return {
			ok: true,
			value:
				legacyValue === undefined
					? parsePayload(args)
					: parsePayload(legacyValue),
		};
	} catch {
		return { ok: false, response: transportParsed.response };
	}
}

export function createAuditSessionTools() {
	return {
		flow_audit_write_report: tool({
			description:
				"Persist a normalized Flow audit report as JSON and Markdown artifacts from a JSON payload",
			args: FlowAuditWriteReportArgsShape,
			execute: async (args: unknown, context: ToolContext) => {
				const parsed = await parseAuditReportArgs(args);
				if (!parsed.ok) {
					return parsed.response;
				}
				try {
					recordToolMetadata(context, "Write audit report", {
						requestedDepth: parsed.value.requestedDepth,
						achievedDepth: parsed.value.achievedDepth,
						discoveredSurfaceCount: parsed.value.discoveredSurfaces.length,
						findingCount: parsed.value.findings?.length ?? 0,
					});
					await ensureMutableWorkspacePermission(context);
					const application = await import("../application");
					return application.executeDispatchedAuditWorkspaceAction(
						context,
						"write_audit_report",
						{ report: parsed.value },
					);
				} catch (error) {
					if (error instanceof InvalidFlowWorkspaceRootError) {
						return workspaceErrorResponse(error);
					}
					throw error;
				}
			},
		}),
	};
}
