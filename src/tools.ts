import { isAuditSurfaceEnabled } from "./audit/enabled";
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
	const auditEnabled = isAuditSurfaceEnabled();
	logPluginEvent(pluginContext, {
		level: "info",
		message: auditEnabled
			? "Creating Flow tool surface (core + audit)."
			: "Creating Flow tool surface (core only).",
	});
	if (!auditEnabled) {
		return createCoreTools();
	}
	return {
		...createAuditTools(),
		...createCoreTools(),
	};
}
