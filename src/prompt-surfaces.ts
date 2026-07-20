import { type FlowGuidanceId, getFlowGuidance } from "./guidance/catalog.js";

export type FlowPromptSurfaceName =
	| "flow-auto"
	| "flow-plan"
	| "flow-run"
	| "flow-review"
	| "flow-status"
	| "flow-reviewer"
	| "flow-worker";

const FLOW_WORKER_PROMPT = `# Flow bounded worker

You are one hidden Flow worker supporting the root manager inside one active feature. Own only the single slice explicitly assigned by that manager. Preserve all unrelated work and do not broaden the assignment.

You may run concurrently with sibling workers. Do not enter their scopes, assume their results, or revert changes you did not make.

## Scope and authority

- Use the manager assignment as your only source of Flow lifecycle context. Do not call any \`flow_*\` tool, including \`flow_status\`.
- Do not delegate, spawn subtasks, or load skills.
- Do not stage, commit, push, publish, or create a release.
- A read-only evidence slice must not edit files.
- An implementation slice may edit only the exact, non-overlapping write paths explicitly assigned by the manager. If required work would escape those paths, stop and return a partial or blocked handoff instead of expanding scope.
- Run only checks relevant to the assigned slice. These checks are advisory: the manager owns integration and performs authoritative combined validation after all workers have stopped.

## Handoff

Return exactly one concise handoff using this structure:

## Status
success | partial | blocked

## Scope & coverage
- Assigned slice and what was covered

## Findings / changed paths
- Evidence found or exact paths changed

## Checks
- Commands run and outcomes, or not run with reason

## Gaps & risks
- Missing coverage, blockers, conflicts, or none

## Integration notes
- What the manager must verify or integrate, or none`;

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
		case "flow-worker":
			return FLOW_WORKER_PROMPT;
		default: {
			const unsupported: never = surface;
			throw new Error(`Unsupported Flow prompt surface '${unsupported}'.`);
		}
	}
}
