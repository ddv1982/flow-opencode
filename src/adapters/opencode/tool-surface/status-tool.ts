/**
 * flow_status: session state, workspace readiness checks, and the suggested
 * next step in one read-only tool (replaces flow_status + flow_doctor +
 * flow_auto_prepare).
 */

import {
	detectPreNpmFlowPlugin,
	inspectFlowCommandAgentSyncState,
	inspectFlowSkillSyncState,
	resolveFlowHomeDir,
	resolveFlowPluginVersion,
} from "../../../distribution/skill-sync";
import {
	buildInstallCheck,
	buildWorkspaceReadiness,
	statusResponse,
} from "../../../runtime/application";
import { projectTaskProgress } from "../../../runtime/summary-projections";
import { tool } from "../sdk";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowStatusArgsSchema,
	FlowStatusArgsShape,
	type ToolContext,
} from "./schemas";
import {
	inspectToolWorkspace,
	readToolSessionValue,
	recordToolMetadata,
} from "./shared";
import { openCodeToolDescription } from "./tool-registry";

function buildOpenCodeInstallCheck() {
	return buildInstallCheck({
		detectPreNpmFlowPlugin,
		inspectFlowCommandAgentSyncState,
		inspectFlowSkillSyncState,
		resolveFlowHomeDir,
		resolveFlowPluginVersion,
	});
}

export function createStatusTool() {
	return {
		flow_status: tool({
			description: openCodeToolDescription("flow_status"),
			args: FlowStatusArgsShape,
			execute: withParsedArgs(
				FlowStatusArgsSchema,
				async (input, context: ToolContext) => {
					const session = await readToolSessionValue(
						context,
						"load_status_session",
						undefined,
					);
					const workspace = inspectToolWorkspace(context);
					const readiness = await buildWorkspaceReadiness(context, session, {
						buildInstallCheck: buildOpenCodeInstallCheck,
					});
					const taskProgress = session ? projectTaskProgress(session) : [];
					recordToolMetadata(context, "Flow status", {
						sessionId: session?.id ?? null,
						status: session?.status ?? "missing",
						approval: session?.approval ?? null,
						activeFeatureId: session?.execution.activeFeatureId ?? null,
						view: input.view ?? "detailed",
						readiness: readiness.status,
						taskProgressCount: taskProgress.length,
						activeTaskCount: taskProgress.filter(
							(row) => row.status === "active",
						).length,
						blockedTaskCount: taskProgress.filter(
							(row) =>
								row.status === "blocked" ||
								row.status === "needs_fix" ||
								row.status === "needs_input",
						).length,
						workspaceRoot: workspace.root,
						workspaceMutationAllowed: workspace.mutationAllowed,
					});
					return await statusResponse(
						session,
						input.view ?? "detailed",
						workspace,
						readiness,
					);
				},
			),
		}),
	};
}
