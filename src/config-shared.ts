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

export const FLOW_REASONING = {
	fast: "low",
	balanced: "medium",
	deep: "high",
} as const satisfies Record<string, FlowReasoningEffort>;

export const FLOW_READ_ONLY_PERMISSION = {
	edit: "deny",
	bash: "deny",
	task: {
		"*": "deny",
	},
} as const satisfies FlowPermissionConfig;
