import { getAuditSurfaceState } from "./audit/enabled";
import { createAuditTools } from "./audit/tools";
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
	const audit = getAuditSurfaceState();
	logPluginEvent(pluginContext, {
		level: "info",
		message: !audit.tools
			? "Creating Flow tool surface (core only)."
			: audit.all
				? "Creating Flow tool surface (core + audit)."
				: audit.reportsTool && audit.writeTool
					? "Creating Flow tool surface (core + diagnostic audit tools)."
					: audit.reportsTool
						? "Creating Flow tool surface (core + diagnostic audit reports tool)."
						: "Creating Flow tool surface (core + diagnostic audit write tool).",
	});
	if (!audit.tools) {
		return createCoreTools();
	}
	return {
		...createAuditTools({
			reportsTool: audit.reportsTool,
			writeTool: audit.writeTool,
		}),
		...createCoreTools(),
	};
}
