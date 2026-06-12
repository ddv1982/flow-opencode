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
	"flow-doctor": {
		description: "Check Flow readiness for the current workspace",
		template:
			"Call flow_status (detailed) and report the readiness checks with any remediation steps.",
	},
	"flow-history": {
		description: "Inspect stored Flow session history",
		template:
			"Call flow_session with action 'history' and summarize the sessions.",
	},
	"flow-session": {
		description: "Activate, close, list, or show a Flow session",
		template:
			"Call flow_session with the requested action (activate, close, history, or show): $ARGUMENTS",
	},
	"flow-reset": {
		description: "Reset a Flow feature to pending",
		template:
			"Call flow_feature_complete with reset=true for feature: $ARGUMENTS",
	},
	"flow-review": {
		description: "Run a read-only Flow review with a fresh context",
		agent: "flow-reviewer",
		subtask: true,
		template: "Load the `flow-review` skill and review: $ARGUMENTS",
	},
} satisfies Record<string, FlowCommandConfig>;
