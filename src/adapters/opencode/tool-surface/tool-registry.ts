import type { CoreActionName } from "../../../core/registry";
import type {
	SessionMutationActionName,
	SessionReadActionName,
	SessionWorkspaceActionName,
} from "../../../runtime/application";
import {
	FLOW_DEFAULT_TOOL_DOCS_ROW,
	FLOW_PROMPT_GUIDANCE_BY_ID,
} from "./descriptor-guidance";

export type FlowSurfaceKind =
	| "mutation"
	| "read"
	| "workspace"
	| "render"
	| "audit"
	| "prompt-only"
	| "docs-only";

export type FlowSurfaceMutationClass =
	| "none"
	| "planning"
	| "execution"
	| "review"
	| "control";

export type FlowSurfaceMode =
	| "flow-plan"
	| "flow-auto"
	| "flow-run"
	| "flow-planning-researcher"
	| "flow-worker"
	| "flow-reviewer"
	| "flow-control"
	| "flow-review";

export type RuntimeActionBinding =
	| { kind: "none" }
	| { kind: "read"; name: SessionReadActionName }
	| { kind: "workspace"; name: SessionWorkspaceActionName }
	| { kind: "mutation"; name: SessionMutationActionName };

export type OpenCodeToolRegistryEntry = {
	toolName: string;
	surfaceKind: FlowSurfaceKind;
	runtimeActionBinding: RuntimeActionBinding;
	coreAction: CoreActionName | null;
	mutationClass: FlowSurfaceMutationClass;
	allowedModes: readonly FlowSurfaceMode[];
	hostDescription: string;
	definitionGuidance?: string;
	docsRowMetadata?: {
		section: string;
		label: string;
	};
};

export const OPENCODE_TOOL_REGISTRY = [
	{
		toolName: "flow_status",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "load_status_session" },
		coreAction: null,
		mutationClass: "none",
		allowedModes: ["flow-control"],
		hostDescription: "Show the active Flow session summary",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_doctor",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "none" },
		coreAction: null,
		mutationClass: "none",
		allowedModes: ["flow-control"],
		hostDescription:
			"Run non-destructive readiness checks for Flow in the current workspace",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_history",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "list_session_history" },
		coreAction: null,
		mutationClass: "none",
		allowedModes: ["flow-control"],
		hostDescription: "Show active, stored, and completed Flow session history",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_history_show",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "load_history_session" },
		coreAction: null,
		mutationClass: "none",
		allowedModes: ["flow-control"],
		hostDescription:
			"Show a specific active, stored, or completed Flow session by id",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_session_activate",
		surfaceKind: "workspace",
		runtimeActionBinding: { kind: "workspace", name: "activate_session" },
		coreAction: null,
		mutationClass: "control",
		allowedModes: ["flow-control"],
		hostDescription: "Activate a stored Flow session by id",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_plan_start",
		surfaceKind: "workspace",
		runtimeActionBinding: { kind: "workspace", name: "plan_start" },
		coreAction: "start_workflow",
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		hostDescription: "Create or refresh the active Flow planning session",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_plan_start,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_auto_prepare",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "load_resumable_session" },
		coreAction: null,
		mutationClass: "none",
		allowedModes: ["flow-auto"],
		hostDescription:
			"Classify a flow-auto invocation and report attachment materialization requirements",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_attachments_materialize",
		surfaceKind: "workspace",
		runtimeActionBinding: { kind: "none" },
		coreAction: null,
		mutationClass: "execution",
		allowedModes: ["flow-auto"],
		hostDescription:
			"Import captured PNG, JPEG, WebP, GIF, or AVIF OpenCode attachments into a safe workspace path",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_session_close",
		surfaceKind: "workspace",
		runtimeActionBinding: { kind: "workspace", name: "close_session" },
		coreAction: null,
		mutationClass: "control",
		allowedModes: ["flow-control"],
		hostDescription:
			"Close the active Flow session as completed, deferred, or abandoned",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_plan_context_record",
		surfaceKind: "mutation",
		runtimeActionBinding: {
			kind: "mutation",
			name: "record_planning_context",
		},
		coreAction: "record_planning_context",
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		hostDescription:
			"Persist repo profile, research, implementation approach, and optional planning decisions into the active Flow session from a JSON payload",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_plan_context_record,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_plan_apply",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "apply_plan" },
		coreAction: "apply_plan",
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		hostDescription:
			"Persist a Flow draft plan into the active session from a JSON payload",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_plan_apply,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_plan_approve",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "approve_plan" },
		coreAction: "approve_plan",
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		hostDescription: "Approve the active Flow draft plan",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_plan_select_features",
		surfaceKind: "mutation",
		runtimeActionBinding: {
			kind: "mutation",
			name: "select_plan_features",
		},
		coreAction: "select_plan_features",
		mutationClass: "planning",
		allowedModes: ["flow-plan"],
		hostDescription:
			"Keep only selected features in the active Flow draft plan",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_run_start",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "start_run" },
		coreAction: "start_run",
		mutationClass: "execution",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		hostDescription: "Start the next runnable Flow feature",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_run_start,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_run_complete_feature",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "complete_run" },
		coreAction: "complete_run",
		mutationClass: "execution",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		hostDescription:
			"Persist an already-validated Flow feature execution result from a JSON payload",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_run_complete_feature,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_reset_feature",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "reset_feature" },
		coreAction: "reset_feature",
		mutationClass: "execution",
		allowedModes: ["flow-auto", "flow-control"],
		hostDescription: "Reset a Flow feature to pending",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_review_record_feature",
		surfaceKind: "mutation",
		runtimeActionBinding: {
			kind: "mutation",
			name: "record_feature_review",
		},
		coreAction: "record_reviewer_decision",
		mutationClass: "review",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		hostDescription:
			"Record an already-validated reviewer decision for the active feature from a JSON payload",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_review_record_feature,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_review_record_final",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "record_final_review" },
		coreAction: "record_reviewer_decision",
		mutationClass: "review",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		hostDescription:
			"Record an already-validated reviewer decision for final cross-feature validation from a JSON payload",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_review_record_final,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
	{
		toolName: "flow_review_render",
		surfaceKind: "render",
		runtimeActionBinding: { kind: "none" },
		coreAction: null,
		mutationClass: "none",
		allowedModes: ["flow-control", "flow-review"],
		hostDescription:
			"Render a structured Flow review ledger into a human-readable report, structured JSON, or both",
		definitionGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_review_render,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
	},
] as const satisfies readonly OpenCodeToolRegistryEntry[];

type OpenCodeToolRegistryUnion = (typeof OPENCODE_TOOL_REGISTRY)[number];

type OpenCodeToolRegistryEntryByName<ToolName extends OpenCodeToolName> =
	Extract<OpenCodeToolRegistryUnion, { toolName: ToolName }>;

export type OpenCodeToolName = OpenCodeToolRegistryUnion["toolName"];
export type RuntimeBoundOpenCodeToolName = Extract<
	OpenCodeToolRegistryUnion,
	{
		runtimeActionBinding: {
			kind: Exclude<RuntimeActionBinding["kind"], "none">;
		};
	}
>["toolName"];

type RuntimeActionNameForTool<
	ToolName extends RuntimeBoundOpenCodeToolName,
	Kind extends Exclude<RuntimeActionBinding["kind"], "none">,
> = Extract<
	OpenCodeToolRegistryEntryByName<ToolName>["runtimeActionBinding"],
	{ kind: Kind }
>["name"];

export const OPENCODE_TOOL_NAMES_FROM_REGISTRY = OPENCODE_TOOL_REGISTRY.map(
	(entry) => entry.toolName,
);

export function getOpenCodeToolRegistryEntry(
	toolName: string,
): OpenCodeToolRegistryEntry | null {
	return (
		OPENCODE_TOOL_REGISTRY.find((entry) => entry.toolName === toolName) ?? null
	);
}

export function openCodeToolDescription(toolName: string): string {
	const entry = getOpenCodeToolRegistryEntry(toolName);
	if (!entry) {
		throw new Error(`Missing OpenCode tool registry entry for '${toolName}'.`);
	}
	return entry.hostDescription;
}

export function openCodeToolRuntimeBinding(
	toolName: RuntimeBoundOpenCodeToolName,
): Exclude<RuntimeActionBinding, { kind: "none" }> {
	const entry = getOpenCodeToolRegistryEntry(toolName);
	if (!entry || entry.runtimeActionBinding.kind === "none") {
		throw new Error(`Missing runtime action binding for '${toolName}'.`);
	}
	return entry.runtimeActionBinding;
}

export function openCodeToolRuntimeActionName<
	ToolName extends RuntimeBoundOpenCodeToolName,
	Kind extends Exclude<RuntimeActionBinding["kind"], "none">,
>(
	toolName: ToolName,
	expectedKind: Kind,
): RuntimeActionNameForTool<ToolName, Kind> {
	const binding = openCodeToolRuntimeBinding(toolName);
	if (binding.kind !== expectedKind) {
		throw new Error(
			`OpenCode tool '${toolName}' is bound to '${binding.kind}', expected '${expectedKind}'.`,
		);
	}
	return binding.name as RuntimeActionNameForTool<ToolName, Kind>;
}
