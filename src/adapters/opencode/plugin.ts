import { FLOW_CORE_COMMANDS } from "../../config-shared";
import {
	formatFlowSkillSetupWarning,
	resolveFlowPluginVersion,
	runFlowSkillSync,
} from "../../distribution/sync";
import { loadSession } from "../../runtime/workspace";
import { createConfigHook } from "./config";
import { createFlowLog } from "./logging";
import type { Hooks, Plugin, ToolContext } from "./sdk";
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

async function compactSessionFacts(
	context: Pick<ToolContext, "worktree" | "directory">,
): Promise<string | null> {
	const root = context.worktree ?? context.directory;
	if (!root) return null;
	try {
		const session = await loadSession(root);
		if (!session) return null;
		return [
			"Flow session facts:",
			`- goal: ${session.goal}`,
			`- status: ${session.status}`,
			`- approval: ${session.approval}`,
			`- active feature: ${session.activeFeatureId ?? "none"}`,
			`- progress: ${
				session.plan?.features.filter(
					(feature) => feature.status === "completed",
				).length ?? 0
			}/${session.plan?.features.length ?? 0}`,
			"Call flow_status before any Flow action.",
		].join("\n");
	} catch {
		return null;
	}
}

function createSystemTransformHook(
	ctx: Pick<ToolContext, "worktree" | "directory">,
): NonNullable<Hooks["experimental.chat.system.transform"]> {
	return async (_input, output) => {
		const setupWarning = formatFlowSkillSetupWarning();
		if (setupWarning) output.system.push(setupWarning);
		const facts = await compactSessionFacts(ctx);
		if (facts) output.system.push(facts);
	};
}

function isFlowCommandName(command: string): command is FlowCommandName {
	return command in FLOW_CORE_COMMANDS;
}

function renderFlowCommandTemplate(
	command: FlowCommandName,
	args: string,
): string {
	return FLOW_CORE_COMMANDS[command].template.replaceAll("$ARGUMENTS", args);
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
		const setupWarning = formatFlowSkillSetupWarning();
		replaceFlowCommandParts(
			output,
			setupWarning ?? renderFlowCommandTemplate(command, input.arguments),
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
		"experimental.chat.system.transform": createSystemTransformHook(ctx),
		"experimental.session.compacting": async (_input, output) => {
			const setupWarning = formatFlowSkillSetupWarning();
			if (setupWarning)
				output.context = [...(output.context ?? []), setupWarning];
			const facts = await compactSessionFacts(ctx);
			if (!facts) return;
			output.context = [...(output.context ?? []), facts];
		},
	};
};

export default FlowPlugin;
