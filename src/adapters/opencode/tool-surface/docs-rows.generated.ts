import { FLOW_HOST_TOOL_SURFACE_DESCRIPTORS } from "./descriptors";

// NOTE: kept as *.generated.ts for import stability; docs rows are
// descriptor-derived and parity-tested in tests/docs-tool-parity.test.ts.

export type FlowToolDocsRow = {
	toolName: string;
	section: string;
	label: string;
	description: string;
};

export const FLOW_TOOL_DOCS_ROWS: readonly FlowToolDocsRow[] =
	FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.flatMap((descriptor) =>
		descriptor.docsRowMetadata
			? [
					{
						toolName: descriptor.hostToolName,
						section: descriptor.docsRowMetadata.section,
						label: descriptor.docsRowMetadata.label,
						description: descriptor.hostDescription,
					},
				]
			: [],
	);

export function renderFlowToolDocsRow(row: FlowToolDocsRow): string {
	return `- \`${row.toolName}\` — ${row.description}`;
}
