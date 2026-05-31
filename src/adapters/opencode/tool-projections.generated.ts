import type { CoreActionName } from "../../core/registry";
import { renderOpenCodeToolCoreSummary } from "./tool-surface/core-action-projection";
import { OPENCODE_TOOL_REGISTRY } from "./tool-surface/tool-registry";

// NOTE: kept as *.generated.ts for import stability; projections are registry-derived
// and parity-tested in tests/descriptor-family-parity.test.ts.

export type OpenCodeToolProjection = {
	toolName: string;
	/** Exact read/workspace/mutation action invoked by the adapter tool. */
	runtimeAction?: string;
	/** Item-1 workflow-core action projected for generated host guidance. */
	coreAction?: CoreActionName;
	hostDescription: string;
	definitionGuidance?: string;
};

function toOpenCodeToolProjection(
	entry: (typeof OPENCODE_TOOL_REGISTRY)[number],
): OpenCodeToolProjection {
	const projection: OpenCodeToolProjection = {
		toolName: entry.toolName,
		hostDescription: entry.hostDescription,
	};

	if (entry.runtimeActionBinding.kind !== "none") {
		projection.runtimeAction = entry.runtimeActionBinding.name;
	}
	if (entry.coreAction) {
		projection.coreAction = entry.coreAction;
	}
	const definitionGuidance =
		"definitionGuidance" in entry ? entry.definitionGuidance : undefined;
	if (definitionGuidance) {
		projection.definitionGuidance = definitionGuidance;
	}

	return projection;
}

export const OPENCODE_TOOL_PROJECTIONS = OPENCODE_TOOL_REGISTRY.map(
	toOpenCodeToolProjection,
);

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

export function openCodeToolCoreSummary(toolName: string): string | null {
	const projection = getOpenCodeToolProjection(toolName);
	return renderOpenCodeToolCoreSummary({
		coreActionName: projection?.coreAction,
		runtimeAction: projection?.runtimeAction,
	});
}
