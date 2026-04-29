import {
	FLOW_AUDIT_COMMAND_TEMPLATE,
	FLOW_AUDITS_COMMAND_TEMPLATE,
} from "./prompts/commands";

type MutableConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

type FlowCommandConfig = {
	description: string;
	agent: string;
	template: string;
};

const FLOW_AUDIT_COMMANDS = {
	"flow-audit": {
		description:
			"Run a read-only repository audit with calibrated depth claims",
		agent: "flow-control",
		template: FLOW_AUDIT_COMMAND_TEMPLATE,
	},
	"flow-audits": {
		description:
			"Inspect or compare saved Flow audit report history and details",
		agent: "flow-control",
		template: FLOW_AUDITS_COMMAND_TEMPLATE,
	},
} satisfies Record<string, FlowCommandConfig>;

export function createFlowAuditConfigEntries() {
	const command = Object.fromEntries(
		Object.entries(FLOW_AUDIT_COMMANDS).map(([name, item]) => [
			name,
			{ ...item },
		]),
	);
	return { agent: {}, command };
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
