import { createRuntimeTools } from "./tools/runtime-tools";
import { createSessionTools } from "./tools/session-tools";

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

function logPluginEvent(
	ctx: PluginLogContext,
	entry: {
		level: "info" | "warn" | "error";
		message: string;
		[key: string]: unknown;
	},
) {
	ctx.client?.app?.log?.(entry);
}

export function createCoreTools() {
	return {
		...createSessionTools(),
		...createRuntimeTools(),
	};
}

export function createTools(ctx: unknown) {
	const pluginContext = ctx as PluginLogContext;
	logPluginEvent(pluginContext, {
		level: "info",
		message: "Creating Flow tool surface.",
	});
	return {
		...createCoreTools(),
	};
}
