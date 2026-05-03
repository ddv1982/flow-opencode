import { OPENCODE_TOOL_NAMES } from "./tool-projections.generated";
import { createRuntimeTools } from "./tool-surface/runtime-tools";
import { createSessionTools } from "./tool-surface/session-tools";

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

function orderProjectedTools<T extends Record<string, unknown>>(tools: T): T {
	const toolNames = new Set(Object.keys(tools));
	const projectedNames = new Set<string>(OPENCODE_TOOL_NAMES);
	const missing = OPENCODE_TOOL_NAMES.filter((name) => !toolNames.has(name));
	const extra = [...toolNames].filter((name) => !projectedNames.has(name));

	if (missing.length > 0 || extra.length > 0) {
		throw new Error(
			[
				missing.length > 0
					? `Missing OpenCode tool projection(s): ${missing.join(", ")}`
					: null,
				extra.length > 0
					? `Unprojected OpenCode tool(s): ${extra.join(", ")}`
					: null,
			]
				.filter((message): message is string => message !== null)
				.join("; "),
		);
	}

	return Object.fromEntries(
		OPENCODE_TOOL_NAMES.map((name) => [name, tools[name]]),
	) as T;
}

export function createCoreTools() {
	return orderProjectedTools({
		...createSessionTools(),
		...createRuntimeTools(),
	});
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
