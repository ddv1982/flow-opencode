import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { createConfigHook } from "./config";
import {
	buildFlowAdaptiveSystemContext,
	FLOW_RUNTIME_CONTEXT_MARKER,
} from "./prompt-system-context";
import { resolveSessionRoot } from "./runtime/application";
import { loadSession } from "./runtime/session";
import { applyFlowToolDefinitionGuidance } from "./tool-definition-guidance";
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
		if (!ctx.worktree && !ctx.directory) {
			return;
		}
		if (
			output.system.some((entry) =>
				entry.startsWith(FLOW_RUNTIME_CONTEXT_MARKER),
			)
		) {
			return;
		}

		const session = await loadPluginSession(ctx);
		const context = buildFlowAdaptiveSystemContext(session);
		if (context.length === 0) {
			return;
		}

		output.system = [...output.system, ...context];
	};
}

async function loadPluginSession(
	ctx: Pick<Parameters<Plugin>[0], "worktree" | "directory">,
): Promise<Awaited<ReturnType<typeof loadSession>>> {
	try {
		return await loadSession(
			resolveSessionRoot({
				worktree: ctx.worktree,
				directory: ctx.directory,
			}),
		);
	} catch {
		return null;
	}
}

const FlowPlugin: Plugin = async (ctx) => {
	(ctx as PluginLogContext).client?.app?.log?.({
		level: "info",
		message: "Flow plugin initialized.",
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
				if (!context.worktree && !context.directory) {
					return;
				}
				const session = await loadSession(resolveSessionRoot(context));
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
