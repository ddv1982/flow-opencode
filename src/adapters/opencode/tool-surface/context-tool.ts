/**
 * flow_context: read-only context pack inspection for planning, execution,
 * review, and release handoffs.
 */

import { statusResponse, toJson } from "../../../runtime/application";
import { buildContextPackProjection } from "../../../runtime/context-pack";
import { buildProjectStructureMap } from "../../../runtime/project-structure-map";
import { tool } from "../sdk";
import { withParsedArgs } from "./parsed-tool";
import {
	FlowContextArgsSchema,
	FlowContextArgsShape,
	type ToolContext,
} from "./schemas";
import {
	inspectToolWorkspace,
	readToolSessionValue,
	recordToolMetadata,
} from "./shared";
import { openCodeToolDescription } from "./tool-registry";

type ContextView = "summary" | "features" | "full";

function summarizeContextPack(
	contextPack: ReturnType<typeof buildContextPackProjection>,
) {
	return {
		sessionId: contextPack.sessionId,
		goal: contextPack.goal,
		workflowProfile: contextPack.workflowProfile,
		contextQuality: contextPack.quality,
		workflowReadiness: contextPack.workflowReadiness,
		contextTraceability: {
			plannedTargetCount: contextPack.traceability.plannedTargetCount,
			changedArtifactCount: contextPack.traceability.changedArtifactCount,
			validationCommandCount: contextPack.traceability.validationCommandCount,
			unplannedChangedArtifactCount:
				contextPack.traceability.unplannedChangedArtifacts.length,
			reviewedFeatureCount: contextPack.traceability.reviewedFeatureCount,
		},
		contextDiagnostics: contextPack.diagnostics,
		projectStructure: contextPack.projectStructure
			? {
					rootName: contextPack.projectStructure.rootName,
					entryCount: contextPack.projectStructure.entryCount,
					truncated: contextPack.projectStructure.truncated,
					ignoreSources: contextPack.projectStructure.ignoreSources,
					focus: contextPack.projectStructure.focus,
					entries: contextPack.projectStructure.entries.slice(0, 40),
				}
			: null,
	};
}

function contextPayload(
	contextPack: ReturnType<typeof buildContextPackProjection>,
	view: ContextView,
) {
	if (view === "full") {
		return contextPack;
	}
	if (view === "features") {
		return {
			...summarizeContextPack(contextPack),
			features: contextPack.traceability.features,
		};
	}
	return summarizeContextPack(contextPack);
}

export function createContextTool() {
	return {
		flow_context: tool({
			description: openCodeToolDescription("flow_context"),
			args: FlowContextArgsShape,
			execute: withParsedArgs(
				FlowContextArgsSchema,
				async (input, context: ToolContext) => {
					const session = await readToolSessionValue(
						context,
						"load_status_session",
						undefined,
					);
					const view = input.view ?? "summary";
					const workspace = inspectToolWorkspace(context);
					if (!session) {
						recordToolMetadata(context, "Flow context", {
							status: "missing_session",
							view,
							workspaceRoot: workspace.root,
						});
						return statusResponse(session, "compact", workspace);
					}

					const includeProjectStructure =
						input.includeProjectStructure ?? view !== "features";
					const projectStructure =
						includeProjectStructure && workspace.root
							? await buildProjectStructureMap(workspace.root, session)
							: undefined;
					const contextPack = buildContextPackProjection(session, {
						projectStructure,
					});
					recordToolMetadata(context, "Flow context", {
						sessionId: session.id,
						status: session.status,
						view,
						contextQualityScore: contextPack.quality.score,
						workflowReadinessState: contextPack.workflowReadiness.state,
						projectStructureEntryCount:
							contextPack.projectStructure?.entryCount ?? 0,
						workspaceRoot: workspace.root,
					});
					return toJson({
						status: "ok",
						summary: `Flow context ${view} view for session '${session.id}'.`,
						view,
						context: contextPayload(contextPack, view),
						workspaceRoot: workspace.root,
						workspace,
					});
				},
			),
		}),
	};
}
