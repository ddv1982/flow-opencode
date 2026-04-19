import {
	FLOW_READ_ONLY_PERMISSION,
	FLOW_READ_ONLY_TOOLS,
} from "./config-shared";
import {
	FLOW_AUTO_AGENT_PROMPT,
	FLOW_CONTROL_AGENT_PROMPT,
	FLOW_PLANNER_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_WORKER_AGENT_PROMPT,
} from "./prompts/agents";
import {
	FLOW_AUTO_COMMAND_TEMPLATE,
	FLOW_DOCTOR_COMMAND_TEMPLATE,
	FLOW_HISTORY_COMMAND_TEMPLATE,
	FLOW_PLAN_COMMAND_TEMPLATE,
	FLOW_RESET_COMMAND_TEMPLATE,
	FLOW_RUN_COMMAND_TEMPLATE,
	FLOW_SESSION_COMMAND_TEMPLATE,
	FLOW_STATUS_COMMAND_TEMPLATE,
} from "./prompts/commands";

type MutableConfig = {
	// OpenCode config merging is intentionally flexible. Keep this boundary broad and
	// clone our injected entries defensively instead of over-constraining caller-owned config.
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

type FlowAgentConfig = {
	mode: "primary";
	description: string;
	prompt: string;
	permission?: typeof FLOW_READ_ONLY_PERMISSION;
	tools?: typeof FLOW_READ_ONLY_TOOLS;
};

type FlowCommandConfig = {
	description: string;
	agent: string;
	template: string;
};

function createReadOnlyPrimaryAgent(
	description: string,
	prompt: string,
): FlowAgentConfig {
	return {
		mode: "primary",
		description,
		prompt,
		permission: FLOW_READ_ONLY_PERMISSION,
		tools: FLOW_READ_ONLY_TOOLS,
	};
}

const FLOW_AGENTS = {
	"flow-planner": createReadOnlyPrimaryAgent(
		"Create and refine compact Flow plans grounded in repo evidence.",
		FLOW_PLANNER_AGENT_PROMPT,
	),
	"flow-worker": {
		mode: "primary",
		description:
			"Execute one approved Flow feature with focused validation and review.",
		prompt: FLOW_WORKER_AGENT_PROMPT,
	},
	"flow-auto": {
		mode: "primary",
		description:
			"Coordinate Flow planning, execution, review, and recovery autonomously.",
		prompt: FLOW_AUTO_AGENT_PROMPT,
	},
	"flow-reviewer": createReadOnlyPrimaryAgent(
		"Review Flow work and decide whether it may advance.",
		FLOW_REVIEWER_AGENT_PROMPT,
	),
	"flow-control": createReadOnlyPrimaryAgent(
		"Inspect or reset Flow runtime state without executing work.",
		FLOW_CONTROL_AGENT_PROMPT,
	),
} satisfies Record<string, FlowAgentConfig>;

const FLOW_COMMANDS = {
	"flow-plan": {
		description: "Create, update, select, or approve a Flow plan",
		agent: "flow-planner",
		template: FLOW_PLAN_COMMAND_TEMPLATE,
	},
	"flow-run": {
		description: "Run one approved Flow feature",
		agent: "flow-worker",
		template: FLOW_RUN_COMMAND_TEMPLATE,
	},
	"flow-auto": {
		description:
			"Coordinate Flow autonomously until completion or a real blocker",
		agent: "flow-auto",
		template: FLOW_AUTO_COMMAND_TEMPLATE,
	},
	"flow-status": {
		description: "Inspect the active Flow session",
		agent: "flow-control",
		template: FLOW_STATUS_COMMAND_TEMPLATE,
	},
	"flow-doctor": {
		description: "Check Flow readiness for the current workspace",
		agent: "flow-control",
		template: FLOW_DOCTOR_COMMAND_TEMPLATE,
	},
	"flow-history": {
		description: "Inspect stored Flow session history",
		agent: "flow-control",
		template: FLOW_HISTORY_COMMAND_TEMPLATE,
	},
	"flow-session": {
		description: "Activate or close a Flow session",
		agent: "flow-control",
		template: FLOW_SESSION_COMMAND_TEMPLATE,
	},
	"flow-reset": {
		description: "Reset a Flow feature",
		agent: "flow-control",
		template: FLOW_RESET_COMMAND_TEMPLATE,
	},
} satisfies Record<string, FlowCommandConfig>;

function cloneAgentConfig(agent: FlowAgentConfig) {
	return {
		...agent,
		...(agent.tools ? { tools: { ...agent.tools } } : {}),
		...(agent.permission ? { permission: { ...agent.permission } } : {}),
	};
}

export function applyFlowConfig(config: MutableConfig): void {
	const clonedAgents = Object.fromEntries(
		Object.entries(FLOW_AGENTS).map(([name, agent]) => [
			name,
			cloneAgentConfig(agent),
		]),
	);
	const clonedCommands = Object.fromEntries(
		Object.entries(FLOW_COMMANDS).map(([name, command]) => [
			name,
			{ ...command },
		]),
	);

	config.agent = {
		...(config.agent ?? {}),
		...clonedAgents,
	};

	config.command = {
		...(config.command ?? {}),
		...clonedCommands,
	};
}

export function createConfigHook(_ctx: unknown) {
	return async (config: MutableConfig) => {
		applyFlowConfig(config);
	};
}
