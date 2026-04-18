import type { Plugin } from "@opencode-ai/plugin";
import { createConfigHook } from "./config";
import { loadSession } from "./runtime/session";
import { createTools } from "./tools";
import type { ToolContext } from "./tools/schemas";

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
		hooks: {
			"experimental.session.compacting": async (
				_input: unknown,
				context: ToolContext,
				output: { context?: string[]; prompt?: string },
			) => {
				const session = await loadSession(
					context.directory ?? context.worktree ?? process.cwd(),
				);
				if (!session) {
					return;
				}

				const phase =
					session.status === "planning"
						? "planning"
						: session.status === "completed"
							? "complete"
							: session.execution.lastReviewerDecision &&
									session.execution.lastReviewerDecision.status !== "approved"
								? "review"
								: "execution";

				const summary = `Flow session context: goal "${session.goal}" | phase: ${phase}`;
				output.context = [...(output.context ?? []), summary];
			},
		},
	};
};

export default FlowPlugin;
