import { type CoreActionName, coreActionByName } from "../../../core/registry";

export function renderOpenCodeToolCoreSummary(input: {
	coreActionName: CoreActionName | null | undefined;
	runtimeAction?: string | undefined;
}): string | null {
	if (!input.coreActionName) {
		return null;
	}
	const action = coreActionByName(input.coreActionName);
	if (!action) {
		return null;
	}

	return [
		"## Core registry projection",
		input.runtimeAction ? `- Adapter action: \`${input.runtimeAction}\`` : null,
		`- Core action: \`${action.name}\` — ${action.description}`,
		`- Emits: ${action.emits.map((event) => `\`${event}\``).join(", ")}`,
		`- Invariants: ${action.invariantIds.map((id) => `\`${id}\``).join(", ")}`,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}
