import { CORE_ACTION_REGISTRY, type CoreActionName } from "../../core/registry";

export type OpenCodeToolProjection = {
	toolName: string;
	/** Exact current runtime/workspace action invoked by the adapter tool. */
	runtimeAction?: string;
	/** Item-1 workflow-core action projected for generated host guidance. */
	coreAction?: CoreActionName;
	hostDescription: string;
	definitionGuidance?: string;
};

const CORE_ACTIONS_BY_NAME = new Map(
	CORE_ACTION_REGISTRY.map((action) => [action.name, action]),
);

export const OPENCODE_TOOL_PROJECTIONS = [
	{
		toolName: "flow_status",
		hostDescription: "Show the active Flow session summary",
	},
	{
		toolName: "flow_doctor",
		hostDescription:
			"Run non-destructive readiness checks for Flow in the current workspace",
	},
	{
		toolName: "flow_history",
		hostDescription: "Show active, stored, and completed Flow session history",
	},
	{
		toolName: "flow_history_show",
		hostDescription:
			"Show a specific active, stored, or completed Flow session by id",
	},
	{
		toolName: "flow_session_activate",
		runtimeAction: "activate_session",
		hostDescription: "Activate a stored Flow session by id",
	},
	{
		toolName: "flow_plan_start",
		runtimeAction: "plan_start",
		coreAction: "start_workflow",
		hostDescription: "Create or refresh the active Flow planning session",
		definitionGuidance: `## Use when
- Use first when creating or refreshing a Flow planning session from a user goal.

## Avoid when
- Do not use for plan approval, feature execution, or review persistence.

## Returns
- Returns the active planning session state and the next canonical planning step.`,
	},
	{
		toolName: "flow_auto_prepare",
		hostDescription: "Classify a flow-auto invocation",
	},
	{
		toolName: "flow_session_close",
		runtimeAction: "close_session",
		hostDescription:
			"Close the active Flow session as completed, deferred, or abandoned",
	},
	{
		toolName: "flow_plan_context_record",
		runtimeAction: "record_planning_context",
		coreAction: "record_planning_context",
		hostDescription:
			"Persist repo profile, research, implementation approach, and optional planning decisions into the active Flow session from a JSON payload",
		definitionGuidance: `## Use when
- Use to persist repo profile, stackProfile, standardsProfile, research findings, implementation approach, or planning decisions that justify the plan.
- Provide the planning-context fields directly as this tool's arguments.

## Avoid when
- Do not embed this context inside the plan payload when the runtime has dedicated planning fields.

## Returns
- Updates the active planning context so downstream Flow summaries expose the same evidence.`,
	},
	{
		toolName: "flow_plan_apply",
		runtimeAction: "apply_plan",
		coreAction: "apply_plan",
		hostDescription:
			"Persist a Flow draft plan into the active session from a JSON payload",
		definitionGuidance: `## Use when
- Use after you have a draft plan that already matches the Flow planning contract.
- Provide the full \`{ plan, planning? }\` payload directly as this tool's arguments.

## Avoid when
- Do not use to store free-form notes or partial execution results.

## Returns
- Returns the canonical runtime response for the applied draft, including approval guidance.`,
	},
	{
		toolName: "flow_plan_approve",
		runtimeAction: "approve_plan",
		coreAction: "approve_plan",
		hostDescription: "Approve the active Flow draft plan",
	},
	{
		toolName: "flow_plan_select_features",
		runtimeAction: "select_plan_features",
		coreAction: "select_plan_features",
		hostDescription:
			"Keep only selected features in the active Flow draft plan",
	},
	{
		toolName: "flow_run_start",
		runtimeAction: "start_run",
		coreAction: "start_run",
		hostDescription: "Start the next runnable Flow feature",
		definitionGuidance: `## Use when
- Use first for execution to start the next runnable feature or a specific approved feature id.

## Avoid when
- Do not call this after implementation is already complete; use completion tools instead.

## Returns
- Returns the canonical runtime response describing the active feature or why nothing is runnable.`,
	},
	{
		toolName: "flow_run_complete_feature",
		runtimeAction: "complete_run",
		coreAction: "complete_run",
		hostDescription:
			"Persist an already-validated Flow feature execution result from a JSON payload",
		definitionGuidance: `## Use when
- Use only after the required validation for the current path is complete: targeted validation plus feature review for normal features, or broad validation plus the final review required by deliveryPolicy.finalReviewPolicy (detailed cross-feature by default) for the completion path.
- Provide the full worker result fields directly as this tool's arguments.

## Avoid when
- Do not use for partial progress, speculative status updates, or before review is clean.

## Returns
- Persists a worker result and returns the canonical runtime completion response.`,
	},
	{
		toolName: "flow_reset_feature",
		runtimeAction: "reset_feature",
		coreAction: "reset_feature",
		hostDescription: "Reset a Flow feature to pending",
	},
	{
		toolName: "flow_review_record_feature",
		runtimeAction: "record_feature_review",
		coreAction: "record_reviewer_decision",
		hostDescription:
			"Record an already-validated reviewer decision for the active feature from a JSON payload",
		definitionGuidance: `## Use when
- Use to persist a reviewer decision for the current feature after the review is already complete.
- Provide the full reviewer decision fields directly as this tool's arguments.

## Avoid when
- Do not use to ask for review or to record final cross-feature approval.

## Returns
- Returns the canonical runtime response for the feature-level approval gate.`,
	},
	{
		toolName: "flow_review_record_final",
		runtimeAction: "record_final_review",
		coreAction: "record_reviewer_decision",
		hostDescription:
			"Record an already-validated reviewer decision for final cross-feature validation from a JSON payload",
		definitionGuidance: `## Use when
- Use to persist the final reviewer decision required by deliveryPolicy.finalReviewPolicy on the final completion path.
- Provide the full reviewer decision fields directly as this tool's arguments.

## Avoid when
- Do not use for normal feature reviews or before broad final validation and the runtime-owned final review required by deliveryPolicy.finalReviewPolicy are complete.

## Returns
- Returns the canonical runtime response for the final approval gate.`,
	},
	{
		toolName: "flow_review_render",
		hostDescription:
			"Render a structured Flow review ledger into a human-readable report, structured JSON, or both",
		definitionGuidance: `## Use when
- Use after you have a complete structured review ledger and want a deterministic human-readable report.
- Provide the full review ledger fields directly as this tool's arguments.
- Use \`view: human\` for the default user-facing report, \`structured\` for raw JSON, or \`both\` to append structured details after the readable report.

## Avoid when
- Do not use before the review findings and coverage ledger are complete.
- Do not handcraft the final prose when this renderer can produce the deterministic report for you.

## Returns
- Returns a rendered review report string, not a Flow runtime session mutation response.`,
	},
] as const satisfies readonly OpenCodeToolProjection[];

export const OPENCODE_TOOL_NAMES = OPENCODE_TOOL_PROJECTIONS.map(
	(projection) => projection.toolName,
);

export function getOpenCodeToolProjection(
	toolName: string,
): OpenCodeToolProjection | null {
	return (
		OPENCODE_TOOL_PROJECTIONS.find(
			(projection) => projection.toolName === toolName,
		) ?? null
	);
}

export function openCodeToolDescription(toolName: string): string {
	const projection = getOpenCodeToolProjection(toolName);
	if (!projection) {
		throw new Error(`Missing OpenCode tool projection for '${toolName}'.`);
	}
	return projection.hostDescription;
}

export function openCodeToolCoreSummary(toolName: string): string | null {
	const projection = getOpenCodeToolProjection(toolName);
	if (!projection?.coreAction) {
		return null;
	}
	const action = CORE_ACTIONS_BY_NAME.get(projection.coreAction);
	if (!action) {
		return null;
	}

	return [
		"## Core registry projection",
		projection.runtimeAction
			? `- Adapter action: \`${projection.runtimeAction}\``
			: null,
		`- Core action: \`${action.name}\` — ${action.description}`,
		`- Emits: ${action.emits.map((event) => `\`${event}\``).join(", ")}`,
		`- Invariants: ${action.invariantIds.map((id) => `\`${id}\``).join(", ")}`,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}
