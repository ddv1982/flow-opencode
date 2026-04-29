type ToolDefinitionOutput = {
	description: string;
	parameters: unknown;
};

const FLOW_AUDIT_TOOL_DESCRIPTION_GUIDANCE: Record<string, string> = {
	flow_audit_write_report: `## Use when
- Use after producing a read-only audit report when you want Flow to persist normalized JSON and Markdown audit artifacts.
- Provide the audit report as the JSON string field \`reportJson\`.

## Avoid when
- Do not use for partial notes, free-form scratch text, or implementation progress updates.

## Returns
- Persists a normalized audit artifact bundle and returns the report directory plus JSON/Markdown paths.`,
	flow_audit_compare: `## Use when
- Use to compare two persisted audit reports and summarize what changed in coverage, findings, and validation posture.

## Avoid when
- Do not use for ad hoc text diffs or when one side is not a saved Flow audit artifact.

## Returns
- Returns a structured comparison payload or a clear missing-report response.`,
};

export function applyFlowAuditToolDefinitionGuidance(
	toolID: string,
	output: ToolDefinitionOutput,
): void {
	const guidance = FLOW_AUDIT_TOOL_DESCRIPTION_GUIDANCE[toolID];
	if (!guidance) return;
	output.description = `${output.description}\n\n${guidance}`;
}
