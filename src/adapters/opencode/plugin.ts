import {
	buildFlowAdaptiveSystemContext,
	buildFlowCachedProfileSystemContext,
	FLOW_RUNTIME_CONTEXT_MARKER,
} from "../../prompt-system-context";
import { resolveSessionRoot } from "../../runtime/application";
import { readValidStackStandardsProfileCache } from "../../runtime/application/stack-standards-profile";
import type { PlanningContext } from "../../runtime/schema";
import { loadSession } from "../../runtime/session";
import { createConfigHook } from "./config";
import type { Hooks, Plugin } from "./sdk";
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
		const context =
			session === null
				? buildFlowCachedProfileSystemContext(
						await loadPluginCachedProfile(ctx),
					)
				: buildFlowAdaptiveSystemContext(session);
		if (context.length === 0) {
			return;
		}

		output.system = [...output.system, ...context];
	};
}

async function loadPluginCachedProfile(ctx: {
	worktree?: string;
	directory?: string;
}) {
	try {
		const rootContext = {
			...(ctx.worktree ? { worktree: ctx.worktree } : {}),
			...(ctx.directory ? { directory: ctx.directory } : {}),
		};
		return await readValidStackStandardsProfileCache(
			resolveSessionRoot(rootContext),
			ctx.directory,
		);
	} catch {
		return null;
	}
}

async function loadPluginSession(ctx: {
	worktree?: string;
	directory?: string;
}): Promise<Awaited<ReturnType<typeof loadSession>>> {
	try {
		const rootContext = {
			...(ctx.worktree ? { worktree: ctx.worktree } : {}),
			...(ctx.directory ? { directory: ctx.directory } : {}),
		};
		return await loadSession(resolveSessionRoot(rootContext));
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
				const session = await loadPluginSession(context);
				if (!session) {
					const cachedProfile = await loadPluginCachedProfile(context);
					if (cachedProfile?.stackProfile || cachedProfile?.standardsProfile) {
						output.context = [
							...(output.context ?? []),
							`Flow cached planning profile: stack ${summarizeStackProfile(cachedProfile.stackProfile)} | standards ${cachedProfile.standardsProfile?.localGuidelines.length ?? 0} local source(s), ${cachedProfile.standardsProfile?.rules.length ?? 0} rule(s), ${cachedProfile.standardsProfile?.gaps.length ?? 0} gap(s)`,
						];
					}
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
				const profileSummary =
					session.planning.stackProfile || session.planning.standardsProfile
						? `Flow planning profile: stack ${summarizeStackProfile(session.planning.stackProfile)} | standards ${session.planning.standardsProfile?.localGuidelines.length ?? 0} local source(s), ${session.planning.standardsProfile?.rules.length ?? 0} rule(s), ${session.planning.standardsProfile?.gaps.length ?? 0} gap(s)`
						: null;
				output.context = [
					...(output.context ?? []),
					summary,
					...(profileSummary ? [profileSummary] : []),
				];
			},
		},
	};
};

export default FlowPlugin;

function summarizeStackProfile(
	profile: PlanningContext["stackProfile"] | undefined,
): string {
	if (!profile) {
		return "not recorded";
	}
	const names = [
		...profile.languages,
		...profile.frameworks,
		...profile.runtimes,
		...profile.tools,
	]
		.slice(0, 8)
		.map((item) => item.name);
	return names.length > 0 ? names.join(", ") : "empty";
}
