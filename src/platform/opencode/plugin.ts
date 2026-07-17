import { FLOW_CORE_COMMANDS } from "../../config-shared.js";
import { createConfigHook } from "./config.js";
import { createFlowLog } from "./logging.js";
import type { Hooks, Plugin } from "./sdk.js";
import { createTools } from "./tools.js";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type FlowCommandOutput = Parameters<
	NonNullable<Hooks["command.execute.before"]>
>[1];
type Part = FlowCommandOutput["parts"][number];
type FlowTextPart = Extract<Part, { type: "text" }>;
type FlowSubtaskPart = Extract<Part, { type: "subtask" }>;
type FlowSubtaskPartWithCommand = FlowSubtaskPart & { command?: string };

const FLOW_COMMAND_TITLE_SEEDS = {
	"flow-auto": "Flow auto",
	"flow-plan": "Flow plan",
	"flow-run": "Flow run",
	"flow-review": "Flow review",
	"flow-status": "Flow status",
} satisfies Record<FlowCommandName, string>;

const FLOW_COMMAND_TITLE_SEED_MAX_LENGTH = 240;

function isFlowCommandName(command: string): command is FlowCommandName {
	// Object.hasOwn, not `in`: `in` walks the prototype chain, so a user command
	// named `toString`/`constructor` would be misclassified as a Flow command
	// and crash the preflight hook on the undefined template lookup.
	return Object.hasOwn(FLOW_CORE_COMMANDS, command);
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
	return renderFlowCommandTemplate(command, args);
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
	return part?.type === "subtask";
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

function replaceManagerCommandParts(
	output: FlowCommandOutput,
	titleSeed: string,
	text: string,
): void {
	const { parts } = output;
	if (parts.some(isFlowSubtaskPart)) {
		throw new Error(
			"Flow refused to execute a manager command with an unexpected subtask part.",
		);
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

function replaceSubtaskCommandPrompt(
	command: FlowCommandName,
	output: FlowCommandOutput,
	agent: string,
	text: string,
): void {
	const { parts } = output;
	if (parts.length !== 1 || !isFlowSubtaskPart(parts[0])) {
		throw new Error(
			`Flow refused to execute /${command}: OpenCode must provide exactly one subtask part.`,
		);
	}
	const subtask = parts[0] as FlowSubtaskPartWithCommand;
	if (subtask.agent !== agent) {
		throw new Error(
			`Flow refused to execute /${command}: expected subtask agent '${agent}', received '${subtask.agent}'.`,
		);
	}
	if (subtask.command?.replace(/^\/+/, "") !== command) {
		throw new Error(
			`Flow refused to execute /${command}: subtask command identity did not match.`,
		);
	}
	subtask.prompt = text;
}

function createCommandPreflightHook(): NonNullable<
	Hooks["command.execute.before"]
> {
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommandName(command)) return;
		const config = FLOW_CORE_COMMANDS[command];
		const prompt = renderFlowCommandPreflight(command, input.arguments);
		if (config.subtask) {
			replaceSubtaskCommandPrompt(command, output, config.agent, prompt);
			return;
		}
		replaceManagerCommandParts(
			output,
			renderFlowCommandTitleSeed(command, input.arguments),
			prompt,
		);
	};
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = createFlowLog(ctx);
	log("info", "Flow v5 plugin initialized.");

	const hooks: Hooks = {
		config: createConfigHook(ctx),
		tool: createTools(ctx),
		"command.execute.before": createCommandPreflightHook(),
	};
	return hooks;
};

export default FlowPlugin;
