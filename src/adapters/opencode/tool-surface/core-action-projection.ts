import {
	type CoreActionDescriptor,
	type CoreActionName,
	coreActionByName,
} from "../../../core/registry";

export type CoreActionProjectionMetadata = Pick<
	CoreActionDescriptor,
	"emits" | "invariantIds" | "description"
> & {
	name: CoreActionName;
};

function coreActionProjectionMetadata(
	coreActionName: CoreActionName,
): CoreActionProjectionMetadata {
	const coreAction = coreActionByName(coreActionName);
	if (!coreAction) {
		throw new Error(
			`Missing core action registry entry for '${coreActionName}'.`,
		);
	}
	return {
		name: coreAction.name,
		emits: coreAction.emits,
		invariantIds: coreAction.invariantIds,
		description: coreAction.description,
	};
}

export function optionalCoreActionProjectionMetadata(
	coreActionName: CoreActionName | null | undefined,
): CoreActionProjectionMetadata | null {
	return coreActionName ? coreActionProjectionMetadata(coreActionName) : null;
}

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
