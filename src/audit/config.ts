import {
	FLOW_READ_ONLY_PERMISSION,
	FLOW_READ_ONLY_TOOLS,
} from "../config-shared";
import { FLOW_AUDITOR_AGENT_PROMPT } from "./prompts/agents";
import {
	FLOW_AUDIT_COMMAND_TEMPLATE,
	FLOW_AUDITS_COMMAND_TEMPLATE,
} from "./prompts/commands";

type MutableConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

type FlowPermissionConfig = {
	edit?: string;
	bash?: string;
	external_directory?: string;
};

type FlowAgentConfig = {
	mode: "primary";
	description: string;
	prompt: string;
	permission?: FlowPermissionConfig;
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

const FLOW_AUDIT_AGENTS = {
	"flow-auditor": createReadOnlyPrimaryAgent(
		"Perform calibrated read-only repository audits with explicit coverage accounting.",
		FLOW_AUDITOR_AGENT_PROMPT,
	),
} satisfies Record<string, FlowAgentConfig>;

const FLOW_AUDIT_COMMANDS = {
	"flow-audit": {
		description:
			"Run a read-only repository audit with calibrated depth claims",
		agent: "flow-auditor",
		template: FLOW_AUDIT_COMMAND_TEMPLATE,
	},
	"flow-audits": {
		description:
			"Inspect or compare saved Flow audit report history and details",
		agent: "flow-control",
		template: FLOW_AUDITS_COMMAND_TEMPLATE,
	},
} satisfies Record<string, FlowCommandConfig>;

function cloneAgentConfig(agent: FlowAgentConfig) {
	return {
		...agent,
		...(agent.tools ? { tools: { ...agent.tools } } : {}),
		...(agent.permission ? { permission: { ...agent.permission } } : {}),
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
		Object.entries(FLOW_AUDIT_COMMANDS).map(([name, item]) => [
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
