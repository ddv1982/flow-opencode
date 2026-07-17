import { compileFlowPromptSurface } from "./prompt-surfaces.js";

export type FlowPermissionConfig = {
	edit?: string;
	bash?: string;
	skill?: string | Record<string, string>;
	task?: Record<string, string>;
	[toolPattern: string]: string | Record<string, string> | undefined;
};

export type FlowAgentConfig = {
	mode: "subagent";
	description: string;
	prompt: string;
	hidden?: boolean;
	model?: string;
	permission?: FlowPermissionConfig;
};

type FlowCommandConfigBase = {
	description: string;
	template: string;
};

export type FlowManagerCommandConfig = FlowCommandConfigBase & {
	agent?: never;
	subtask: false;
};

export type FlowSubtaskCommandConfig = FlowCommandConfigBase & {
	agent: string;
	subtask: true;
};

export type FlowCommandConfig =
	| FlowManagerCommandConfig
	| FlowSubtaskCommandConfig;

export type MutableFlowConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

const FLOW_PUBLIC_COMMAND_TEMPLATES = {
	"flow-auto": compileFlowPromptSurface("flow-auto").text,
	"flow-plan": compileFlowPromptSurface("flow-plan").text,
	"flow-run": compileFlowPromptSurface("flow-run").text,
	"flow-review": compileFlowPromptSurface("flow-review").text,
	"flow-status": compileFlowPromptSurface("flow-status").text,
} as const;

const FLOW_REVIEW_AGENT_INSTRUCTIONS =
	compileFlowPromptSurface("flow-reviewer").text;

function envModel(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function flowWorkerModel(agentName: string): string | undefined {
	const fallback = envModel("OPENCODE_FLOW_WORKER_MODEL");
	if (agentName === "flow-candidate-worker") {
		return envModel("OPENCODE_FLOW_CANDIDATE_WORKER_MODEL") ?? fallback;
	}
	if (agentName === "flow-reviewer" || agentName === "flow-verifier-worker") {
		return envModel("OPENCODE_FLOW_REVIEW_WORKER_MODEL") ?? fallback;
	}
	return envModel("OPENCODE_FLOW_READONLY_WORKER_MODEL") ?? fallback;
}

// Worker permission maps below use tool-name and wildcard keys (`skill`,
// `task`, `flow_*`, `flow_status`) that are NOT in the SDK's simplified
// AgentConfig `permission` type. That mismatch is expected and not a bug:
// OpenCode compiles these keys into its resolved per-agent permission rule list
// and enforces them (the `flow_status` allow follows the `flow_*` deny, so
// status stays readable while every state-changing Flow tool is denied). This
// is proven end-to-end by the read-only-worker isolation assertions in
// tests/live-opencode-smoke.test.ts (FLOW_LIVE_SMOKE=1) — do not "fix" the type
// mismatch by dropping these keys.
export const FLOW_CORE_AGENTS = {
	"flow-reviewer": {
		mode: "subagent",
		hidden: true,
		description: "Internal read-only reviewer for Flow-guided work.",
		prompt: FLOW_REVIEW_AGENT_INSTRUCTIONS,
		permission: {
			edit: "deny",
			bash: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-evidence-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal read-only evidence worker for Flow planning and execution support.",
		prompt: compileFlowPromptSurface("flow-evidence-worker").text,
		permission: {
			edit: "deny",
			bash: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-validation-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal validation worker for Flow check selection and command evidence.",
		prompt: compileFlowPromptSurface("flow-validation-worker").text,
		permission: {
			edit: "deny",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-audit-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal read-only audit worker for refuted or surviving finding candidates.",
		prompt: compileFlowPromptSurface("flow-audit-worker").text,
		permission: {
			edit: "deny",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-candidate-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal candidate implementation worker for isolated Flow worktrees or exact non-overlapping path ownership.",
		prompt: compileFlowPromptSurface("flow-candidate-worker").text,
		permission: {
			edit: "ask",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-verifier-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal verifier worker for checking Flow worker claims against cited evidence.",
		prompt: compileFlowPromptSurface("flow-verifier-worker").text,
		permission: {
			edit: "deny",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
} satisfies Record<string, FlowAgentConfig>;

export const FLOW_CORE_COMMANDS = {
	"flow-auto": {
		description: "Drive the Flow lifecycle against the runtime ledger",
		subtask: false,
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-auto"],
	},
	"flow-plan": {
		description: "Create or approve a Flow plan",
		subtask: false,
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-plan"],
	},
	"flow-run": {
		description: "Run one approved Flow feature",
		subtask: false,
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-run"],
	},
	"flow-review": {
		description: "Run a read-only Flow review",
		agent: "flow-reviewer",
		subtask: true,
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-review"],
	},
	"flow-status": {
		description: "Inspect the active Flow session",
		subtask: false,
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-status"],
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
				const model = flowWorkerModel(name);
				return [
					name,
					{
						...value,
						...(model ? { model } : {}),
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

export function applyFlowConfig(
	config: MutableFlowConfig,
	options?: {
		onCollision?: (kind: "agent" | "command", name: string) => void;
	},
): void {
	const entries = createFlowCoreConfigEntries();
	if (options?.onCollision) {
		for (const name of Object.keys(entries.agent)) {
			if (config.agent && name in config.agent) {
				options.onCollision("agent", name);
			}
		}
		for (const name of Object.keys(entries.command)) {
			if (config.command && name in config.command) {
				options.onCollision("command", name);
			}
		}
	}
	config.agent = { ...(config.agent ?? {}), ...entries.agent };
	config.command = { ...(config.command ?? {}), ...entries.command };
}
