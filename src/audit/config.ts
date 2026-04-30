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

const FLOW_REVIEW_COMMANDS = {
	"flow-review": {
		description:
			"Run a read-only repository review with calibrated depth claims",
		agent: "flow-control",
		template: FLOW_REVIEW_COMMAND_TEMPLATE,
	},
} satisfies Record<string, FlowCommandConfig>;

export function createFlowAuditConfigEntries() {
	const command = Object.fromEntries(
		Object.entries(FLOW_REVIEW_COMMANDS).map(([name, item]) => [
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
