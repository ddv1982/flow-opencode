import { type FlowGuidanceId, getFlowGuidance } from "./guidance/catalog.js";

export type FlowPromptSurfaceName =
	| "flow-auto"
	| "flow-plan"
	| "flow-run"
	| "flow-review"
	| "flow-status"
	| "flow-reviewer";

function skillBody(id: FlowGuidanceId): string {
	return getFlowGuidance(id)
		.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
		.trim();
}

const MANAGER_COMMANDS = {
	"flow-auto": {
		guidance: "flow",
		action:
			"Drive the Flow lifecycle only within the user's authorized scope. Stop after planning when implementation was not authorized: $ARGUMENTS",
	},
	"flow-plan": {
		guidance: "flow-plan",
		action: "Create or revise the Flow plan for: $ARGUMENTS",
	},
	"flow-run": {
		guidance: "flow-run",
		action: "Execute exactly one approved Flow feature: $ARGUMENTS",
	},
} as const satisfies Record<
	"flow-auto" | "flow-plan" | "flow-run",
	{ guidance: FlowGuidanceId; action: string }
>;

function managerCommand(surface: keyof typeof MANAGER_COMMANDS): string {
	const command = MANAGER_COMMANDS[surface];
	return `${skillBody(command.guidance)}\n\n## Command\n\n${command.action}`;
}

export function compileFlowPromptSurface(
	surface: FlowPromptSurfaceName,
): string {
	switch (surface) {
		case "flow-auto":
		case "flow-plan":
		case "flow-run":
			return managerCommand(surface);
		case "flow-status":
			return 'Call `flow_status { request: { view: "compact" } }` and report the runtime projection plus its next action.';
		case "flow-review":
			return [
				"# Flow review command",
				"",
				"Run this assignment only as the reserved `flow-reviewer`. The reviewer is independent and read-only; it must not edit files or mutate Flow state.",
				"",
				"Assignment: $ARGUMENTS",
			].join("\n");
		case "flow-reviewer":
			return skillBody("flow-review");
		default: {
			const unsupported: never = surface;
			throw new Error(`Unsupported Flow prompt surface '${unsupported}'.`);
		}
	}
}
