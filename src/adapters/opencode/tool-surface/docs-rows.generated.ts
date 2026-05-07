import { OPENCODE_TOOL_REGISTRY } from "./tool-registry";

// NOTE: kept as *.generated.ts for import stability; docs rows are
// registry-derived and parity-tested in tests/docs-tool-parity.test.ts.

export type FlowToolDocsRow = {
	toolName: string;
	section: string;
	label: string;
	description: string;
};

export const FLOW_TOOL_DOCS_ROWS: readonly FlowToolDocsRow[] =
	OPENCODE_TOOL_REGISTRY.flatMap((entry) =>
		entry.docsRowMetadata
			? [
					{
						toolName: entry.toolName,
						section: entry.docsRowMetadata.section,
						label: entry.docsRowMetadata.label,
						description: entry.hostDescription,
					},
				]
			: [],
	);

export function renderFlowToolDocsRow(row: FlowToolDocsRow): string {
	return `- \`${row.toolName}\` — ${row.description}`;
}
