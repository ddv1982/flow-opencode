import { FLOW_CORE_COMMANDS } from "../../config-shared";
import {
	formatFlowSkillSetupWarning,
	resolveFlowPluginVersion,
	runFlowSkillSync,
} from "../../distribution/sync";
import { createConfigHook } from "./config";
import { createFlowLog } from "./logging";
import type { Hooks, Part, Plugin } from "./sdk";
import { createTools } from "./tools";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type FlowTextPart = Extract<Part, { type: "text" }>;
type FlowSubtaskPart = Extract<Part, { type: "subtask" }>;

const FLOW_COMMAND_TITLE_SEEDS = {
	"flow-auto": "Flow auto",
	"flow-plan": "Flow plan",
	"flow-run": "Flow run",
	"flow-review": "Flow review",
	"flow-status": "Flow status",
} satisfies Record<FlowCommandName, string>;

const FLOW_COMMAND_TITLE_SEED_MAX_LENGTH = 240;

function isFlowCommandName(command: string): command is FlowCommandName {
	return command in FLOW_CORE_COMMANDS;
}

function renderFlowCommandTemplate(
	command: FlowCommandName,
	args: string,
): string {
	return FLOW_CORE_COMMANDS[command].template.replaceAll(
		"$ARGUMENTS",
		() => args,
	);
}

function renderFlowCommandPreflight(
	command: FlowCommandName,
	args: string,
): string {
	const renderedTemplate = renderFlowCommandTemplate(command, args);
	const setupWarning = formatFlowSkillSetupWarning();
	if (!setupWarning || command === "flow-status") return renderedTemplate;
	return [setupWarning, renderedTemplate].join("\n\n");
}

function renderFlowCommandTitleSeed(
	command: FlowCommandName,
	args: string,
): string {
	const normalizedArgs = args.trim().replace(/\s+/g, " ");
	if (!normalizedArgs) return FLOW_COMMAND_TITLE_SEEDS[command];
	if (normalizedArgs.length <= FLOW_COMMAND_TITLE_SEED_MAX_LENGTH) {
		return `${FLOW_COMMAND_TITLE_SEEDS[command]}: ${normalizedArgs}`;
	}
	const truncatedArgs = `${normalizedArgs.slice(
		0,
		FLOW_COMMAND_TITLE_SEED_MAX_LENGTH - 3,
	)}...`;
	return `${FLOW_COMMAND_TITLE_SEEDS[command]}: ${truncatedArgs}`;
}

function isFlowSubtaskPart(part: Part | undefined): part is FlowSubtaskPart {
	return part?.type === "subtask" && typeof part.prompt === "string";
}

function createFlowTextPart(
	text: string,
	options?: Pick<FlowTextPart, "synthetic">,
): Part {
	return {
		type: "text",
		text,
		...(options?.synthetic ? { synthetic: options.synthetic } : {}),
	} as FlowTextPart;
}

function replaceFlowCommandParts(
	output: Parameters<NonNullable<Hooks["command.execute.before"]>>[1],
	titleSeed: string,
	text: string,
): void {
	const { parts } = output;
	const subtask = parts[0];
	if (parts.length === 1 && isFlowSubtaskPart(subtask)) {
		subtask.prompt = text;
		return;
	}
	const preserved = parts.filter((part) => {
		const type = (part as { type?: string }).type;
		return type !== undefined && type !== "text";
	});
	parts.splice(
		0,
		parts.length,
		createFlowTextPart(titleSeed),
		createFlowTextPart(text, { synthetic: true }),
		...preserved,
	);
}

function createCommandPreflightHook(): NonNullable<
	Hooks["command.execute.before"]
> {
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommandName(command)) return;
		replaceFlowCommandParts(
			output,
			renderFlowCommandTitleSeed(command, input.arguments),
			renderFlowCommandPreflight(command, input.arguments),
		);
	};
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = createFlowLog(ctx);
	log("info", "Flow v4 plugin initialized.");
	await runFlowSkillSync(resolveFlowPluginVersion(), log);

	return {
		config: createConfigHook(ctx),
		tool: createTools(ctx),
		"command.execute.before": createCommandPreflightHook(),
	};
};

export default FlowPlugin;
