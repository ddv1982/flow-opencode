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
	/** Current OpenCode agent-iteration limit (`maxSteps` is deprecated). */
	steps?: number;
	permission?: FlowPermissionConfig;
};

export type FlowHarnessProfile = "control" | "standard" | "assurance";
export type FlowHarnessRolloutMode = "control" | "observe" | "enforce";

export type FlowHarnessRuntimeConfig = {
	profile: FlowHarnessProfile;
	rolloutMode: FlowHarnessRolloutMode;
	warnings: string[];
};

type FlowEnvironment = Readonly<Record<string, string | undefined>>;

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

function envValue(env: FlowEnvironment, name: string): string | undefined {
	const value = env[name]?.trim();
	return value ? value : undefined;
}

function flowWorkerClass(
	agentName: string,
): "candidate" | "review" | "readonly" {
	if (agentName === "flow-candidate-worker") {
		return "candidate";
	}
	if (agentName === "flow-reviewer" || agentName === "flow-verifier-worker") {
		return "review";
	}
	return "readonly";
}

function classEnvironmentName(
	workerClass: ReturnType<typeof flowWorkerClass>,
	suffix: "MODEL" | "STEPS",
): string {
	return `OPENCODE_FLOW_${workerClass.toUpperCase()}_WORKER_${suffix}`;
}

function flowWorkerModel(
	agentName: string,
	env: FlowEnvironment,
): string | undefined {
	const fallback = envValue(env, "OPENCODE_FLOW_WORKER_MODEL");
	return (
		envValue(env, classEnvironmentName(flowWorkerClass(agentName), "MODEL")) ??
		fallback
	);
}

function parseWorkerSteps(
	value: string | undefined,
	name: string,
	warnings: string[],
): number | undefined {
	if (value === undefined) return undefined;
	if (!/^[1-9][0-9]{0,3}$/.test(value)) {
		warnings.push(
			`${name} must be an integer from 1 through 1000; ignoring it.`,
		);
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > 1_000) {
		warnings.push(
			`${name} must be an integer from 1 through 1000; ignoring it.`,
		);
		return undefined;
	}
	return parsed;
}

function flowWorkerSteps(
	agentName: string,
	env: FlowEnvironment,
	warnings: string[],
): number | undefined {
	const specificName = classEnvironmentName(
		flowWorkerClass(agentName),
		"STEPS",
	);
	const specific = envValue(env, specificName);
	if (specific !== undefined) {
		return parseWorkerSteps(specific, specificName, warnings);
	}
	return parseWorkerSteps(
		envValue(env, "OPENCODE_FLOW_WORKER_STEPS"),
		"OPENCODE_FLOW_WORKER_STEPS",
		warnings,
	);
}

export function resolveFlowHarnessRuntimeConfig(
	env: FlowEnvironment = process.env,
): FlowHarnessRuntimeConfig {
	const warnings: string[] = [];
	const rawProfile = envValue(env, "OPENCODE_FLOW_HARNESS_PROFILE");
	let profile: FlowHarnessProfile = "standard";
	if (
		rawProfile === "control" ||
		rawProfile === "standard" ||
		rawProfile === "assurance"
	) {
		profile = rawProfile;
	} else if (rawProfile !== undefined) {
		profile = "control";
		warnings.push(
			"OPENCODE_FLOW_HARNESS_PROFILE must be control, standard, or assurance; using control.",
		);
	}

	const rawRollout = envValue(env, "OPENCODE_FLOW_ROLLOUT_MODE");
	let rolloutMode: FlowHarnessRolloutMode = "observe";
	if (
		rawRollout === "control" ||
		rawRollout === "observe" ||
		rawRollout === "enforce"
	) {
		rolloutMode = rawRollout;
	} else if (rawRollout !== undefined) {
		rolloutMode = "control";
		warnings.push(
			"OPENCODE_FLOW_ROLLOUT_MODE must be control, observe, or enforce; using control.",
		);
	}
	return { profile, rolloutMode, warnings };
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
			flow_validation_start: "allow",
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
			flow_audit_render: "allow",
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

export function createFlowCoreConfigEntries(options?: {
	env?: FlowEnvironment;
	onWarning?: (warning: string) => void;
}) {
	const env = options?.env ?? process.env;
	const warnings: string[] = [];
	const entries = {
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
				const model = flowWorkerModel(name, env);
				const steps = flowWorkerSteps(name, env, warnings);
				return [
					name,
					{
						...value,
						...(model ? { model } : {}),
						...(steps ? { steps } : {}),
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
	for (const warning of new Set(warnings)) options?.onWarning?.(warning);
	return entries;
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
