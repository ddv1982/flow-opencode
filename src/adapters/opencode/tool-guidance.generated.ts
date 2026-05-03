import {
	getOpenCodeToolProjection,
	openCodeToolCoreSummary,
} from "./tool-projections.generated";

type ToolDefinitionOutput = {
	description: string;
	parameters: unknown;
};

export function applyFlowToolDefinitionGuidance(
	toolID: string,
	output: ToolDefinitionOutput,
): void {
	const projection = getOpenCodeToolProjection(toolID);
	if (!projection) {
		return;
	}

	const additions = [
		projection.definitionGuidance,
		openCodeToolCoreSummary(toolID),
	].filter((value): value is string => Boolean(value));

	if (additions.length === 0) {
		return;
	}

	output.description = `${output.description}\n\n${additions.join("\n\n")}`;
}
