import {
	resolveFlowPluginVersion,
	runFlowStartupSync,
} from "../../distribution/skill-sync";
import { scheduleFlowUpdateNotice } from "../../distribution/update-notice";
import { createConfigHook } from "./config";
import type { Hooks, Plugin } from "./sdk";
import {
	appendOpenCodeCompactCompactingContext,
	appendOpenCodeCompactSystemContext,
} from "./system-context";
import type { ToolContext } from "./tool-surface/schemas";
import { createTools } from "./tools";

type FlowLogLevel = "debug" | "info" | "warn" | "error";

type PluginLogContext = {
	client?: {
		app?: {
			log(options: {
				body: { service: string; level: FlowLogLevel; message: string };
			}): unknown;
		};
	};
};

// The SDK's app.log is a class method that reads this._client, so it must be
// called through the client object — a detached reference throws on the first
// call and OpenCode reports the whole plugin as failed to load. The entry also
// travels as the request body, not as top-level options. Logging stays
// best-effort: it must never throw into plugin init.
function createFlowLog(
	ctx: unknown,
): (level: FlowLogLevel, message: string) => void {
	const app = (ctx as PluginLogContext).client?.app;
	if (!app) {
		return () => {};
	}
	return (level, message) => {
		try {
			void Promise.resolve(
				app.log({
					body: { service: "opencode-plugin-flow", level, message },
				}),
			).catch(() => {});
		} catch {
			// Host log transport failures must not break Flow.
		}
	};
}

function createFlowSystemTransformHook(
	ctx: Pick<Parameters<Plugin>[0], "worktree" | "directory">,
): NonNullable<Hooks["experimental.chat.system.transform"]> {
	return async (_input, output) => {
		await appendOpenCodeCompactSystemContext(ctx, output);
	};
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = createFlowLog(ctx);
	log("info", "Flow plugin initialized.");

	const pluginVersion = resolveFlowPluginVersion();
	await runFlowStartupSync(pluginVersion, log);
	// Best-effort, non-blocking: OpenCode never re-resolves cached plugin
	// installs, so tell the user when a newer release exists.
	scheduleFlowUpdateNotice(pluginVersion, log);

	return {
		config: createConfigHook(ctx),
		tool: createTools(ctx),
		hooks: {
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
