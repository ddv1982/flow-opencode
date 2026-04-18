import type { Plugin } from "@opencode-ai/plugin";
import { createConfigHook } from "./config";
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

const FlowPlugin: Plugin = async (ctx) => {
	(ctx as PluginLogContext).client?.app?.log?.({
		level: "info",
		message: "Flow plugin initialized.",
	});

	return {
		config: createConfigHook(ctx),
		tool: createTools(ctx),
	};
};

export default FlowPlugin;
