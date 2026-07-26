import { compileFlowPromptSurface } from "./prompt-surfaces.js";

type FlowPermissionConfig = {
	edit?: string | Record<string, string>;
	bash?: string | Record<string, string>;
	skill?: string | Record<string, string>;
	task?: Record<string, string>;
	[toolPattern: string]: string | Record<string, string> | undefined;
};

type FlowAgentConfig = {
	mode: "subagent";
	description: string;
	prompt: string;
	hidden?: boolean;
	model?: string;
	steps?: number;
	permission?: FlowPermissionConfig;
};

type CommandBase = { description: string; template: string };
type FlowCommandConfig =
	| (CommandBase & { subtask: false; agent?: never })
	| (CommandBase & { subtask: true; agent: string });

export type MutableFlowConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

type FlowEnvironment = Readonly<Record<string, string | undefined>>;

export const FLOW_CORE_AGENTS = {
	"flow-reviewer": {
		mode: "subagent",
		hidden: true,
		description:
			"Independent workspace-read-only reviewer that submits one Flow result.",
		prompt: compileFlowPromptSurface("flow-reviewer"),
		permission: {
			edit: "deny",
			bash: "deny",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
			flow_feature_complete: "allow",
		},
	},
	"flow-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Bounded worker for one read-only evidence or exact-scope implementation slice.",
		prompt: compileFlowPromptSurface("flow-worker"),
		permission: {
			edit: {
				"*": "allow",
				".flow": "deny",
				".flow/**": "deny",
				".git": "deny",
				".git/**": "deny",
			},
			bash: "deny",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
		},
	},
} satisfies Record<string, FlowAgentConfig>;

export const FLOW_CORE_COMMANDS = {
	"flow-auto": {
		description: "Drive one authorized Flow goal end to end",
		subtask: false,
		template: compileFlowPromptSurface("flow-auto"),
	},
	"flow-plan": {
		description: "Plan-only or advanced Flow planning",
		subtask: false,
		template: compileFlowPromptSurface("flow-plan"),
	},
	"flow-run": {
		description: "Advanced or recovery execution of one Flow feature",
		subtask: false,
		template: compileFlowPromptSurface("flow-run"),
	},
	"flow-review": {
		description: "Run one independent workspace-read-only Flow review",
		agent: "flow-reviewer",
		subtask: true,
		template: compileFlowPromptSurface("flow-review"),
	},
	"flow-status": {
		description: "Advanced or recovery inspection of Flow state",
		subtask: false,
		template: compileFlowPromptSurface("flow-status"),
	},
} satisfies Record<string, FlowCommandConfig>;

function envValue(env: FlowEnvironment, name: string): string | undefined {
	const value = env[name]?.trim();
	return value ? value : undefined;
}

function reviewerSteps(
	env: FlowEnvironment,
	onWarning?: (message: string) => void,
) {
	const raw = envValue(env, "OPENCODE_FLOW_REVIEWER_STEPS");
	if (!raw) return undefined;
	if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > 1000) {
		onWarning?.(
			"OPENCODE_FLOW_REVIEWER_STEPS must be an integer from 1 through 1000; ignoring it.",
		);
		return undefined;
	}
	return Number(raw);
}

export function createFlowCoreConfigEntries(options?: {
	env?: FlowEnvironment;
	onWarning?: (warning: string) => void;
}) {
	const env = options?.env ?? process.env;
	const model = envValue(env, "OPENCODE_FLOW_REVIEWER_MODEL");
	const steps = reviewerSteps(env, options?.onWarning);
	return {
		agent: {
			"flow-reviewer": {
				...FLOW_CORE_AGENTS["flow-reviewer"],
				...(model ? { model } : {}),
				...(steps ? { steps } : {}),
				permission: structuredClone(
					FLOW_CORE_AGENTS["flow-reviewer"].permission,
				),
			},
			"flow-worker": {
				...FLOW_CORE_AGENTS["flow-worker"],
				permission: structuredClone(FLOW_CORE_AGENTS["flow-worker"].permission),
			},
		},
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
		onWarning?: (warning: string) => void;
	},
): void {
	const entries = createFlowCoreConfigEntries({
		...(options?.onWarning ? { onWarning: options.onWarning } : {}),
	});
	for (const name of Object.keys(entries.agent)) {
		if (config.agent && name in config.agent)
			options?.onCollision?.("agent", name);
	}
	for (const name of Object.keys(entries.command)) {
		if (config.command && name in config.command)
			options?.onCollision?.("command", name);
	}
	config.agent = { ...(config.agent ?? {}), ...entries.agent };
	config.command = { ...(config.command ?? {}), ...entries.command };
}
