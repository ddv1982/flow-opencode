import { CORE_ACTION_REGISTRY, type CoreActionName } from "../../core/registry";
import { FLOW_HOST_TOOL_SURFACE_DESCRIPTORS } from "./tool-surface/descriptors";

// NOTE: kept as *.generated.ts for import stability; projections are descriptor-derived
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

const CORE_ACTIONS_BY_NAME = new Map(
	CORE_ACTION_REGISTRY.map((action) => [action.name, action]),
);

function toOpenCodeToolProjection(
	descriptor: (typeof FLOW_HOST_TOOL_SURFACE_DESCRIPTORS)[number],
): OpenCodeToolProjection {
	const projection: OpenCodeToolProjection = {
		toolName: descriptor.hostToolName,
		hostDescription: descriptor.hostDescription,
	};

	if (descriptor.runtimeActionBinding.kind !== "none") {
		projection.runtimeAction = descriptor.runtimeActionBinding.name;
	}
	if (descriptor.coreAction) {
		projection.coreAction = descriptor.coreAction;
	}
	if (descriptor.promptGuidance) {
		projection.definitionGuidance = descriptor.promptGuidance;
	}

	return projection;
}

export const OPENCODE_TOOL_PROJECTIONS = FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.map(
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
