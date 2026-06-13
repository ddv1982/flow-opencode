export type FlowReasoningEffort = "low" | "medium" | "high";

export type FlowPermissionConfig = {
	edit?: string;
	bash?: string;
	external_directory?: string;
	task?: Record<string, string>;
} & {
	// OpenCode per-agent permissions accept glob patterns against tool names
	// (e.g. "flow_*": "deny"), which platform-enforces read-only subagents.
	[toolPattern: string]: string | Record<string, string> | undefined;
};

export type FlowAgentConfig = {
	mode: "primary" | "all";
	description: string;
	prompt: string;
	permission?: FlowPermissionConfig;
	reasoningEffort?: FlowReasoningEffort;
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

export const FLOW_REASONING = {
	fast: "low",
	balanced: "medium",
	deep: "high",
} as const satisfies Record<string, FlowReasoningEffort>;

export const FLOW_CORE_AGENTS = {
	"flow-reviewer": {
		mode: "all",
		description: "Review Flow work read-only and record a reviewer decision.",
		prompt:
			"You are the Flow reviewer. Load the `flow-review` skill, review the requested work read-only, then record your decision with flow_review_record.",
		reasoningEffort: FLOW_REASONING.deep,
		// Read-only is platform-enforced: no edits, no shell, no subagents, and
		// no Flow tools except status reads and recording the review decision.
		permission: {
			edit: "deny",
			bash: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
			flow_review_record: "allow",
		},
	},
} satisfies Record<string, FlowAgentConfig>;

export const FLOW_CORE_COMMANDS = {
	"flow-plan": {
		description: "Create, update, or approve a Flow plan",
		template: "Load the `flow-plan` skill and plan: $ARGUMENTS",
	},
	"flow-run": {
		description: "Run one approved Flow feature",
		template:
			"Load the `flow-run` skill and execute the next approved Flow feature. $ARGUMENTS",
	},
	"flow-auto": {
		description:
			"Drive the Flow loop autonomously until completion or a real blocker",
		template:
			"Load the `flow` skill and drive the Flow loop (status, plan, run, review) until completion or a real blocker: $ARGUMENTS",
	},
	"flow-status": {
		description: "Inspect the active Flow session and workspace readiness",
		template:
			"Call flow_status (detailed) and report session state, readiness checks, and the suggested next step.",
	},
	"flow-review": {
		description: "Run a read-only Flow review with a fresh context",
		agent: "flow-reviewer",
		subtask: true,
		template: "Load the `flow-review` skill and review: $ARGUMENTS",
	},
} satisfies Record<string, FlowCommandConfig>;

// Commands retired in v3.1: each was either a duplicate of /flow-status or a
// thin wrapper over a single tool call the skills already teach (flow_session
// history/activate/close/show, flow_feature_complete reset). Startup sync and
// uninstall remove the Flow-owned files earlier releases synced for them.
export const RETIRED_FLOW_COMMANDS = [
	"flow-doctor",
	"flow-history",
	"flow-reset",
	"flow-session",
] as const;

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

export function applyFlowConfig(config: MutableFlowConfig): void {
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
