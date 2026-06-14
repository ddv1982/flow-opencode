export type FlowPermissionConfig = {
	edit?: string;
	bash?: string;
	task?: Record<string, string>;
	[toolPattern: string]: string | Record<string, string> | undefined;
};

export type FlowAgentConfig = {
	mode: "subagent";
	description: string;
	prompt: string;
	hidden?: boolean;
	permission?: FlowPermissionConfig;
};

export type FlowCommandConfig = {
	description: string;
	template: string;
	agent?: string;
	subtask?: boolean;
};

export type MutableFlowConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

export const FLOW_CORE_AGENTS = {
	"flow-reviewer": {
		mode: "subagent",
		hidden: true,
		description: "Internal read-only reviewer for Flow-guided work.",
		prompt:
			"Load `flow-review`. Inspect the current work read-only, report findings, and do not mutate Flow state.",
		permission: {
			edit: "deny",
			bash: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
} satisfies Record<string, FlowAgentConfig>;

export const FLOW_CORE_COMMANDS = {
	"flow-auto": {
		description: "Drive Flow skills against the minimal runtime ledger",
		template:
			"Load the `flow` skill and drive the Flow loop until completion or a real blocker: $ARGUMENTS",
	},
	"flow-plan": {
		description: "Create or approve a Flow plan",
		template: "Load the `flow-plan` skill and plan: $ARGUMENTS",
	},
	"flow-run": {
		description: "Run one approved Flow feature",
		template:
			"Load the `flow-run` skill and execute the next approved feature. $ARGUMENTS",
	},
	"flow-review": {
		description: "Run a read-only Flow review",
		agent: "flow-reviewer",
		subtask: true,
		template: "Load the `flow-review` skill and review: $ARGUMENTS",
	},
	"flow-status": {
		description: "Inspect the active Flow session",
		template: "Call flow_status and report the session state and next action.",
	},
} satisfies Record<string, FlowCommandConfig>;

export function createFlowCoreConfigEntries() {
	return {
		agent: Object.fromEntries(
			Object.entries(FLOW_CORE_AGENTS).map(([name, value]) => {
				const permission = value.permission
					? {
							...value.permission,
							...(value.permission.task
								? { task: { ...value.permission.task } }
								: {}),
						}
					: undefined;
				return [
					name,
					{
						...value,
						...(permission ? { permission } : {}),
					},
				];
			}),
		),
		command: Object.fromEntries(
			Object.entries(FLOW_CORE_COMMANDS).map(([name, value]) => [
				name,
				{ ...value },
			]),
		),
	};
}

export function applyFlowConfig(config: MutableFlowConfig): void {
	const entries = createFlowCoreConfigEntries();
	config.agent = { ...(config.agent ?? {}), ...entries.agent };
	config.command = { ...(config.command ?? {}), ...entries.command };
}
