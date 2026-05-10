import {
	FLOW_READ_ONLY_PERMISSION,
	FLOW_REASONING,
	type FlowAgentConfig,
} from "../config-shared";
import { FLOW_AUDITOR_AGENT_PROMPT } from "./prompts/agents";
import { FLOW_REVIEW_COMMAND_TEMPLATE } from "./prompts/commands";

type MutableConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

type FlowCommandConfig = {
	description: string;
	agent: string;
	template: string;
};

const FLOW_AUDIT_AGENTS = {
	"flow-auditor": {
		mode: "primary",
		description:
			"Run standalone read-only Flow audits with calibrated coverage.",
		prompt: FLOW_AUDITOR_AGENT_PROMPT,
		permission: FLOW_READ_ONLY_PERMISSION,
		reasoningEffort: FLOW_REASONING.deep,
	},
} satisfies Record<string, FlowAgentConfig>;

const FLOW_REVIEW_COMMANDS = {
	"flow-review": {
		description:
			"Run a read-only repository review with calibrated depth claims",
		agent: "flow-auditor",
		template: FLOW_REVIEW_COMMAND_TEMPLATE,
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

export function createFlowAuditConfigEntries() {
	const agent = Object.fromEntries(
		Object.entries(FLOW_AUDIT_AGENTS).map(([name, item]) => [
			name,
			cloneAgentConfig(item),
		]),
	);
	const command = Object.fromEntries(
		Object.entries(FLOW_REVIEW_COMMANDS).map(([name, item]) => [
			name,
			{ ...item },
		]),
	);
	return { agent, command };
}

export function applyFlowAuditConfig(config: MutableConfig): void {
	const entries = createFlowAuditConfigEntries();
	config.agent = {
		...(config.agent ?? {}),
		...entries.agent,
	};
	config.command = {
		...(config.command ?? {}),
		...entries.command,
	};
}
