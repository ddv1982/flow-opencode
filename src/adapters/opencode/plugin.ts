import {
	resolveFlowPluginVersion,
	runFlowStartupSync,
} from "../../distribution/skill-sync";
import { createConfigHook } from "./config";
import type { Hooks, Plugin } from "./sdk";
import {
	appendOpenCodeCompactCompactingContext,
	appendOpenCodeCompactSystemContext,
} from "./system-context";
import { applyFlowToolDefinitionGuidance } from "./tool-guidance.generated";
import type { ToolContext } from "./tool-surface/schemas";
import { createTools } from "./tools";

type PluginLogContext = {
	client?: {
		app?: {
			log(entry: {
				level: "info" | "warn" | "error";
				message: string;
				[key: string]: unknown;
			}): void;
		};
	};
};

const flowToolDefinitionHook: NonNullable<Hooks["tool.definition"]> = async (
	input,
	output,
) => {
	if (!input.toolID.startsWith("flow_")) {
		return;
	}
	applyFlowToolDefinitionGuidance(input.toolID, output);
};

function createFlowSystemTransformHook(
	ctx: Pick<Parameters<Plugin>[0], "worktree" | "directory">,
): NonNullable<Hooks["experimental.chat.system.transform"]> {
	return async (_input, output) => {
		await appendOpenCodeCompactSystemContext(ctx, output);
	};
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = (ctx as PluginLogContext).client?.app?.log;
	log?.({
		level: "info",
		message: "Flow plugin initialized.",
	});

	await runFlowStartupSync(resolveFlowPluginVersion(), (level, message) => {
		log?.({ level, message });
	});

	return {
		config: createConfigHook(ctx),
		tool: createTools(ctx),
		hooks: {
			"tool.definition": flowToolDefinitionHook,
			"experimental.chat.system.transform": createFlowSystemTransformHook(ctx),
			"experimental.session.compacting": async (
				_input: unknown,
				context: ToolContext,
				output: { context?: string[]; prompt?: string },
			) => {
				await appendOpenCodeCompactCompactingContext(context, output);
			},
		},
	};
};

export default FlowPlugin;
