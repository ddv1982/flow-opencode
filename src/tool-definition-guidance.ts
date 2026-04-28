type ToolDefinitionOutput = {
	description: string;
	parameters: unknown;
};

const FLOW_TOOL_DESCRIPTION_GUIDANCE: Record<string, string> = {
	flow_plan_start: `## Use when
- Use first when creating or refreshing a Flow planning session from a user goal.

## Avoid when
- Do not use for plan approval, feature execution, or review persistence.

## Returns
- Returns the active planning session state and the next canonical planning step.`,
	flow_plan_apply: `## Use when
- Use after you have a draft plan that already matches the Flow planning contract.

## Avoid when
- Do not use to store free-form notes or partial execution results.

## Returns
- Returns the canonical runtime response for the applied draft, including approval guidance.`,
	flow_run_start: `## Use when
- Use first for execution to start the next runnable feature or a specific approved feature id.

## Avoid when
- Do not call this after implementation is already complete; use completion tools instead.

## Returns
- Returns the canonical runtime response describing the active feature or why nothing is runnable.`,
	flow_run_complete_feature: `## Use when
- Use only after the required validation for the current path is complete: targeted validation plus feature review for normal features, or broad validation plus final review for the completion path.

## Avoid when
- Do not use for partial progress, speculative status updates, or before review is clean.

## Returns
- Persists a worker result and returns the canonical runtime completion response.`,
	flow_review_record_feature: `## Use when
- Use to persist a reviewer decision for the current feature after the review is already complete.

## Avoid when
- Do not use to ask for review or to record final cross-feature approval.

## Returns
- Returns the canonical runtime response for the feature-level approval gate.`,
	flow_review_record_final: `## Use when
- Use to persist the final cross-feature reviewer decision on the final completion path.

## Avoid when
- Do not use for normal feature reviews or before broad final validation is complete.

## Returns
- Returns the canonical runtime response for the final approval gate.`,
	flow_plan_context_record: `## Use when
- Use to persist repo profile, research findings, implementation approach, or planning decisions that justify the plan.

## Avoid when
- Do not embed this context inside the plan payload when the runtime has dedicated planning fields.

## Returns
- Updates the active planning context so downstream Flow summaries expose the same evidence.`,
};

export function applyFlowToolDefinitionGuidance(
	toolID: string,
	output: ToolDefinitionOutput,
): void {
	const guidance = FLOW_TOOL_DESCRIPTION_GUIDANCE[toolID];

	if (!guidance) {
		return;
	}

	output.description = `${output.description}\n\n${guidance}`;
}
