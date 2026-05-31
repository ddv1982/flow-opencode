import { applyFlowAuditConfig } from "../../audit/config";
import {
	FLOW_READ_ONLY_PERMISSION,
	FLOW_REASONING,
	type FlowAgentConfig,
} from "../../config-shared";
import {
	FLOW_AUTO_AGENT_PROMPT,
	FLOW_CONTROL_AGENT_PROMPT,
	FLOW_PLANNER_AGENT_PROMPT,
	FLOW_PLANNING_RESEARCHER_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_WORKER_AGENT_PROMPT,
} from "../../prompts/agents";
import {
	FLOW_AUTO_COMMAND_TEMPLATE,
	FLOW_DOCTOR_COMMAND_TEMPLATE,
	FLOW_HISTORY_COMMAND_TEMPLATE,
	FLOW_PLAN_COMMAND_TEMPLATE,
	FLOW_RESET_COMMAND_TEMPLATE,
	FLOW_RUN_COMMAND_TEMPLATE,
	FLOW_SESSION_COMMAND_TEMPLATE,
	FLOW_STATUS_COMMAND_TEMPLATE,
} from "../../prompts/commands";

type MutableConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

type FlowCommandConfig = {
	description: string;
	agent: string;
	template: string;
};

function createReadOnlyPrimaryAgent(
	description: string,
	prompt: string,
	mode: FlowAgentConfig["mode"] = "primary",
	reasoningEffort?: FlowAgentConfig["reasoningEffort"],
): FlowAgentConfig {
	return {
		mode,
		description,
		prompt,
		permission: FLOW_READ_ONLY_PERMISSION,
		...(reasoningEffort ? { reasoningEffort } : {}),
	};
}

const FLOW_CORE_AGENTS = {
	"flow-planning-researcher": createReadOnlyPrimaryAgent(
		"Research repo evidence for phase-correct Flow planning without mutating runtime state.",
		FLOW_PLANNING_RESEARCHER_AGENT_PROMPT,
		"all",
		FLOW_REASONING.deep,
	),
	"flow-planner": {
		mode: "all",
		description:
			"Create and refine compact Flow plans grounded in repo evidence.",
		prompt: FLOW_PLANNER_AGENT_PROMPT,
		reasoningEffort: FLOW_REASONING.deep,
		permission: {
			edit: "deny",
			bash: "deny",
			task: {
				"*": "deny",
				"flow-planning-researcher": "allow",
			},
		},
	},
	"flow-worker": {
		mode: "all",
		description:
			"Execute one approved Flow feature with focused validation and review.",
		prompt: FLOW_WORKER_AGENT_PROMPT,
		reasoningEffort: FLOW_REASONING.fast,
		permission: {
			task: {
				"*": "deny",
				"flow-reviewer": "allow",
			},
		},
	},
	"flow-auto": {
		mode: "primary",
		description:
			"Coordinate Flow planning, execution, review, and recovery autonomously.",
		prompt: FLOW_AUTO_AGENT_PROMPT,
		reasoningEffort: FLOW_REASONING.balanced,
		permission: {
			task: {
				"*": "deny",
				"flow-planning-researcher": "allow",
				"flow-planner": "allow",
				"flow-worker": "allow",
				"flow-reviewer": "allow",
			},
		},
	},
	"flow-reviewer": createReadOnlyPrimaryAgent(
		"Review Flow work and decide whether it may advance.",
		FLOW_REVIEWER_AGENT_PROMPT,
		"all",
		FLOW_REASONING.deep,
	),
	"flow-control": createReadOnlyPrimaryAgent(
		"Inspect or reset Flow runtime state without executing work.",
		FLOW_CONTROL_AGENT_PROMPT,
		"primary",
		FLOW_REASONING.fast,
	),
} satisfies Record<string, FlowAgentConfig>;

const FLOW_CORE_COMMANDS = {
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
		...(agent.permission
			? {
					permission: {
						...agent.permission,
						...(agent.permission.task
							? { task: { ...agent.permission.task } }
							: {}),
					},
				}
			: {}),
	};
}

export function createFlowCoreConfigEntries() {
	const agent = Object.fromEntries(
		Object.entries(FLOW_CORE_AGENTS).map(([name, item]) => [
			name,
			cloneAgentConfig(item),
		]),
	);
	const command = Object.fromEntries(
		Object.entries(FLOW_CORE_COMMANDS).map(([name, item]) => [
			name,
			{ ...item },
		]),
	);
	return { agent, command };
}

function applyFlowCoreConfig(config: MutableConfig): void {
	const entries = createFlowCoreConfigEntries();
	config.agent = {
		...(config.agent ?? {}),
		...entries.agent,
	};
	config.command = {
		...(config.command ?? {}),
		...entries.command,
	};
}

export function applyFlowConfig(config: MutableConfig): void {
	applyFlowCoreConfig(config);
	applyFlowAuditConfig(config);
}

export function createConfigHook(_ctx: unknown) {
	return async (config: MutableConfig) => {
		applyFlowConfig(config);
	};
}
