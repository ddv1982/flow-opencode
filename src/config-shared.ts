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
type ReviewerSettingSource = "plugin-option" | "environment";

type FlowPluginOptions = Readonly<{
	reviewer?: unknown;
}>;

type ExplicitReviewerModel = Readonly<{
	kind: "explicit";
	source: ReviewerSettingSource;
	value: string;
}>;

export type FlowReviewerConfiguration = Readonly<{
	model: ExplicitReviewerModel | Readonly<{ kind: "shared-with-manager" }>;
	steps:
		| Readonly<{
				kind: "explicit";
				source: ReviewerSettingSource;
				value: number;
		  }>
		| Readonly<{ kind: "host-default" }>;
}>;

type FlowReviewerStatus = Readonly<{
	scope: "current-plugin-process";
	model:
		| Readonly<{
				kind: "explicit";
				source: ReviewerSettingSource;
				requested: string;
		  }>
		| Readonly<{
				kind: "shared-manager-model";
				source: "host-default";
				requested: null;
		  }>;
	steps:
		| Readonly<{
				kind: "explicit";
				source: ReviewerSettingSource;
				requested: number;
		  }>
		| Readonly<{
				kind: "host-default";
				source: "host-default";
				requested: null;
		  }>;
	availability: "unverified";
	report: readonly string[];
}>;

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

function pluginReviewerOptions(
	options: FlowPluginOptions | undefined,
	onWarning?: (message: string) => void,
): Record<string, unknown> {
	const reviewer = options?.reviewer;
	if (reviewer === undefined) return {};
	if (
		typeof reviewer !== "object" ||
		reviewer === null ||
		Array.isArray(reviewer)
	) {
		onWarning?.("Flow plugin option reviewer must be an object; ignoring it.");
		return {};
	}
	return Object.fromEntries(Object.entries(reviewer));
}

function pluginReviewerModel(
	reviewer: Record<string, unknown>,
	onWarning?: (message: string) => void,
): string | undefined {
	if (!Object.hasOwn(reviewer, "model")) return undefined;
	const value = reviewer.model;
	if (typeof value !== "string") {
		onWarning?.(
			"Flow plugin option reviewer.model must be a non-empty string; ignoring it.",
		);
		return undefined;
	}
	const model = value.trim();
	if (!model) {
		onWarning?.(
			"Flow plugin option reviewer.model must be a non-empty string; ignoring it.",
		);
		return undefined;
	}
	return model;
}

function pluginReviewerSteps(
	reviewer: Record<string, unknown>,
	onWarning?: (message: string) => void,
): number | undefined {
	if (!Object.hasOwn(reviewer, "steps")) return undefined;
	const value = reviewer.steps;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > 1000
	) {
		onWarning?.(
			"Flow plugin option reviewer.steps must be an integer from 1 through 1000; ignoring it.",
		);
		return undefined;
	}
	return value;
}

export function resolveFlowReviewerConfiguration(options?: {
	env?: FlowEnvironment;
	pluginOptions?: FlowPluginOptions | undefined;
	onWarning?: (warning: string) => void;
}): FlowReviewerConfiguration {
	const env = options?.env ?? process.env;
	const reviewer = pluginReviewerOptions(
		options?.pluginOptions,
		options?.onWarning,
	);
	const configuredModel = pluginReviewerModel(reviewer, options?.onWarning);
	const configuredSteps = pluginReviewerSteps(reviewer, options?.onWarning);
	const environmentModel = configuredModel
		? undefined
		: envValue(env, "OPENCODE_FLOW_REVIEWER_MODEL");
	const environmentSteps =
		configuredSteps === undefined
			? reviewerSteps(env, options?.onWarning)
			: undefined;
	return {
		model: configuredModel
			? { kind: "explicit", source: "plugin-option", value: configuredModel }
			: environmentModel
				? {
						kind: "explicit",
						source: "environment",
						value: environmentModel,
					}
				: { kind: "shared-with-manager" },
		steps:
			configuredSteps !== undefined
				? {
						kind: "explicit",
						source: "plugin-option",
						value: configuredSteps,
					}
				: environmentSteps !== undefined
					? {
							kind: "explicit",
							source: "environment",
							value: environmentSteps,
						}
					: { kind: "host-default" },
	};
}

export function flowReviewerStatus(
	reviewer: FlowReviewerConfiguration,
): FlowReviewerStatus {
	const model =
		reviewer.model.kind === "explicit"
			? {
					kind: "explicit" as const,
					source: reviewer.model.source,
					requested: reviewer.model.value,
				}
			: {
					kind: "shared-manager-model" as const,
					source: "host-default" as const,
					requested: null,
				};
	const steps =
		reviewer.steps.kind === "explicit"
			? {
					kind: "explicit" as const,
					source: reviewer.steps.source,
					requested: reviewer.steps.value,
				}
			: {
					kind: "host-default" as const,
					source: "host-default" as const,
					requested: null,
				};
	return {
		scope: "current-plugin-process",
		model,
		steps,
		availability: "unverified",
		report: [
			reviewer.model.kind === "explicit"
				? "Reviewer selection: explicit."
				: "Reviewer selection: shared manager model.",
			model.kind === "explicit"
				? `Requested reviewer model: ${model.requested} (from ${model.source}).`
				: "Requested reviewer model: none; the reviewer inherits the manager model.",
			reviewer.steps.kind === "host-default"
				? "Requested reviewer step budget: host default."
				: `Requested reviewer step budget: ${reviewer.steps.value} (from ${reviewer.steps.source}).`,
			"Reviewer model availability: unverified; configuration proves only what Flow requested from OpenCode.",
		],
	};
}

const SHARED_REVIEWER_MODEL_NOTICE =
	"Flow: no reviewer model is set, so the independent reviewer runs on the same model as the manager. Independence is stronger with a different model family; use the plugin reviewer.model option or OPENCODE_FLOW_REVIEWER_MODEL.";

export function createFlowCoreConfigEntries(options?: {
	env?: FlowEnvironment;
	pluginOptions?: FlowPluginOptions | undefined;
	reviewerConfiguration?: FlowReviewerConfiguration | undefined;
	onWarning?: (warning: string) => void;
	onNotice?: (notice: string) => void;
}) {
	const reviewer =
		options?.reviewerConfiguration ?? resolveFlowReviewerConfiguration(options);
	const model =
		reviewer.model.kind === "explicit" ? reviewer.model.value : undefined;
	if (!model) options?.onNotice?.(SHARED_REVIEWER_MODEL_NOTICE);
	const steps =
		reviewer.steps.kind === "explicit" ? reviewer.steps.value : undefined;
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
		pluginOptions?: FlowPluginOptions | undefined;
		reviewerConfiguration?: FlowReviewerConfiguration | undefined;
		onCollision?: (kind: "agent" | "command", name: string) => void;
		onWarning?: (warning: string) => void;
		onNotice?: (notice: string) => void;
	},
): void {
	const entries = createFlowCoreConfigEntries({
		...(options?.onWarning ? { onWarning: options.onWarning } : {}),
		...(options?.onNotice ? { onNotice: options.onNotice } : {}),
		...(options?.pluginOptions ? { pluginOptions: options.pluginOptions } : {}),
		...(options?.reviewerConfiguration
			? { reviewerConfiguration: options.reviewerConfiguration }
			: {}),
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
