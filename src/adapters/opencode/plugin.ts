import { FLOW_CORE_COMMANDS } from "../../config-shared";
import {
	formatFlowSkillSetupWarning,
	resolveFlowPluginVersion,
	runFlowSkillSync,
} from "../../distribution/sync";
import { createConfigHook } from "./config";
import { createFlowLog } from "./logging";
import type { Hooks, Plugin } from "./sdk";
import { createTools } from "./tools";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;

type FlowCommandTextPart = {
	type: "text";
	text: string;
	synthetic?: boolean;
};

type FlowCommandSubtaskPart = {
	type: "subtask";
	prompt: string;
};

type FlowCommandPart = FlowCommandTextPart | FlowCommandSubtaskPart;

function isFlowCommandName(command: string): command is FlowCommandName {
	return command in FLOW_CORE_COMMANDS;
}

function renderFlowCommandTemplate(
	command: FlowCommandName,
	args: string,
): string {
	return FLOW_CORE_COMMANDS[command].template.replaceAll("$ARGUMENTS", args);
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

function replaceFlowCommandParts(
	output: Parameters<NonNullable<Hooks["command.execute.before"]>>[1],
	text: string,
): void {
	const parts = output.parts as unknown as FlowCommandPart[];
	const subtask = parts[0];
	if (parts.length === 1 && subtask?.type === "subtask") {
		subtask.prompt = text;
		return;
	}
	parts.splice(0, parts.length, {
		type: "text",
		text,
		synthetic: true,
	});
}

function createCommandPreflightHook(): NonNullable<
	Hooks["command.execute.before"]
> {
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommandName(command)) return;
		replaceFlowCommandParts(
			output,
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
