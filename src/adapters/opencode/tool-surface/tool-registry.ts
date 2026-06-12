import {
	CANONICAL_RUNTIME_TOOL_NAMES,
	type CanonicalRuntimeToolName,
} from "../../../runtime/constants";

export type OpenCodeToolName = CanonicalRuntimeToolName;

export type OpenCodeToolRegistryEntry = {
	toolName: OpenCodeToolName;
	hostDescription: string;
};

const OPENCODE_TOOL_DESCRIPTIONS: Record<OpenCodeToolName, string> = {
	flow_status:
		"Show the active Flow session state, workspace readiness checks, and the suggested next step",
	flow_plan_save:
		"Create or refresh the active Flow planning session and persist planning context and/or a draft plan from a JSON payload",
	flow_plan_approve:
		"Approve the active Flow draft plan, optionally narrowing it to a dependency-consistent feature subset",
	flow_run_start: "Start the next runnable Flow feature",
	flow_feature_complete:
		"Persist an already-validated Flow feature execution result, or reset a feature to pending with reset=true",
	flow_review_record:
		"Record an already-validated reviewer decision (scope: feature or final) from a JSON payload",
	flow_session:
		"Manage Flow sessions: activate or close a session, list history, or show a stored session by id",
};

export const OPENCODE_TOOL_REGISTRY: readonly OpenCodeToolRegistryEntry[] =
	CANONICAL_RUNTIME_TOOL_NAMES.map((toolName) => ({
		toolName,
		hostDescription: OPENCODE_TOOL_DESCRIPTIONS[toolName],
	}));

export const OPENCODE_TOOL_NAMES_FROM_REGISTRY: readonly OpenCodeToolName[] =
	OPENCODE_TOOL_REGISTRY.map((entry) => entry.toolName);

export function getOpenCodeToolRegistryEntry(
	toolName: string,
): OpenCodeToolRegistryEntry | null {
	return (
		OPENCODE_TOOL_REGISTRY.find((entry) => entry.toolName === toolName) ?? null
	);
}

export function openCodeToolDescription(toolName: OpenCodeToolName): string {
	const entry = getOpenCodeToolRegistryEntry(toolName);
	if (!entry) {
		throw new Error(`Missing OpenCode tool registry entry for '${toolName}'.`);
	}
	return entry.hostDescription;
}
