import { renderOpenCodeToolCoreSummary } from "./tool-surface/core-action-projection";
import { getOpenCodeToolRegistryEntry } from "./tool-surface/tool-registry";

type ToolDefinitionOutput = {
	description: string;
	parameters: unknown;
};

export function applyFlowToolDefinitionGuidance(
	toolID: string,
	output: ToolDefinitionOutput,
): void {
	const registryEntry = getOpenCodeToolRegistryEntry(toolID);
	if (!registryEntry) {
		return;
	}

	const runtimeAction =
		registryEntry.runtimeActionBinding.kind === "none"
			? undefined
			: registryEntry.runtimeActionBinding.name;
	const additions = [
		registryEntry.definitionGuidance,
		renderOpenCodeToolCoreSummary({
			coreActionName: registryEntry.coreAction,
			runtimeAction,
		}),
	].filter((value): value is string => Boolean(value));

	if (additions.length === 0) {
		return;
	}

	output.description = `${output.description}\n\n${additions.join("\n\n")}`;
}
