import { FLOW_CORE_COMMANDS } from "../../config-shared";
import {
	formatFlowSkillSetupWarning,
	resolveFlowPluginVersion,
	runFlowSkillSync,
} from "../../distribution/sync";
import {
	flowSessionProgress,
	loadSession,
	resolveWorkspaceRoot,
} from "../../runtime/workspace";
import { createConfigHook } from "./config";
import { createFlowLog } from "./logging";
import type { Hooks, Part, Plugin } from "./sdk";
import { createTools } from "./tools";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type FlowTextPart = Extract<Part, { type: "text" }>;
type FlowSubtaskPart = Extract<Part, { type: "subtask" }>;

const FLOW_COMMAND_TITLE_SEEDS = {
	"flow-auto": "Flow auto",
	"flow-plan": "Flow plan",
	"flow-run": "Flow run",
	"flow-review": "Flow review",
	"flow-status": "Flow status",
} satisfies Record<FlowCommandName, string>;

const FLOW_COMMAND_TITLE_SEED_MAX_LENGTH = 240;

function isFlowCommandName(command: string): command is FlowCommandName {
	// Object.hasOwn, not `in`: `in` walks the prototype chain, so a user command
	// named `toString`/`constructor` would be misclassified as a Flow command
	// and crash the preflight hook on the undefined template lookup.
	return Object.hasOwn(FLOW_CORE_COMMANDS, command);
}

function renderFlowCommandTemplate(
	command: FlowCommandName,
	args: string,
): string {
	return FLOW_CORE_COMMANDS[command].template.replaceAll(
		"$ARGUMENTS",
		() => args,
	);
}

function renderFlowCommandPreflight(
	command: FlowCommandName,
	args: string,
): string {
	const renderedTemplate = renderFlowCommandTemplate(command, args);
	const setupWarning = formatFlowSkillSetupWarning();
	if (!setupWarning || command === "flow-status") return renderedTemplate;
	return [setupWarning, renderedTemplate].join("\n\n");
}

function renderFlowCommandTitleSeed(
	command: FlowCommandName,
	args: string,
): string {
	const normalizedArgs = args.trim().replace(/\s+/g, " ");
	if (!normalizedArgs) return FLOW_COMMAND_TITLE_SEEDS[command];
	if (normalizedArgs.length <= FLOW_COMMAND_TITLE_SEED_MAX_LENGTH) {
		return `${FLOW_COMMAND_TITLE_SEEDS[command]}: ${normalizedArgs}`;
	}
	const truncatedArgs = `${normalizedArgs.slice(
		0,
		FLOW_COMMAND_TITLE_SEED_MAX_LENGTH - 3,
	)}...`;
	return `${FLOW_COMMAND_TITLE_SEEDS[command]}: ${truncatedArgs}`;
}

function isFlowSubtaskPart(part: Part | undefined): part is FlowSubtaskPart {
	return part?.type === "subtask" && typeof part.prompt === "string";
}

function createFlowTextPart(
	text: string,
	options?: Pick<FlowTextPart, "synthetic">,
): Part {
	return {
		type: "text",
		text,
		...(options?.synthetic ? { synthetic: options.synthetic } : {}),
	} as FlowTextPart;
}

function replaceFlowCommandParts(
	output: Parameters<NonNullable<Hooks["command.execute.before"]>>[1],
	titleSeed: string,
	text: string,
): void {
	const { parts } = output;
	// A subtask-based command (e.g. /flow-review spawning the read-only
	// reviewer) must have the rewritten instructions run INSIDE the subtask,
	// never re-injected into the parent session. Rewrite the subtask prompt in
	// place regardless of sibling parts (attachments), and leave those siblings
	// untouched — otherwise an invocation with an attachment would both keep the
	// stale subtask and run the instructions with the parent's permissions.
	const subtask = parts.find(isFlowSubtaskPart);
	if (subtask) {
		subtask.prompt = text;
		return;
	}
	const preserved = parts.filter((part) => {
		const type = (part as { type?: string }).type;
		return type !== undefined && type !== "text";
	});
	parts.splice(
		0,
		parts.length,
		createFlowTextPart(titleSeed),
		createFlowTextPart(text, { synthetic: true }),
		...preserved,
	);
}

function createCommandPreflightHook(): NonNullable<
	Hooks["command.execute.before"]
> {
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommandName(command)) return;
		replaceFlowCommandParts(
			output,
			renderFlowCommandTitleSeed(command, input.arguments),
			renderFlowCommandPreflight(command, input.arguments),
		);
	};
}

function createCompactionHook(ctx: {
	worktree?: string;
	directory?: string;
}): NonNullable<Hooks["experimental.session.compacting"]> {
	return async (_input, output) => {
		try {
			const root = resolveWorkspaceRoot(ctx);
			const session = await loadSession(root);
			if (!session) return;
			const { completed: completedFeatures, total: totalFeatures } =
				flowSessionProgress(session);
			output.context.push(
				[
					"## Flow session context",
					"An active Flow session exists in this workspace (`.flow/session.json`).",
					`- goal: ${JSON.stringify(session.goal)}`,
					`- status: ${JSON.stringify(session.status)}`,
					`- approval: ${JSON.stringify(session.approval)}`,
					`- activeFeatureId: ${JSON.stringify(session.activeFeatureId)}`,
					`- progress: ${completedFeatures}/${totalFeatures} features completed`,
					"After compaction, call `flow_status` before any Flow action and follow its `nextAction`.",
				].join("\n"),
			);
		} catch {
			// Compaction context is best-effort and must never break compaction.
		}
	};
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = createFlowLog(ctx);
	log("info", "Flow v4 plugin initialized.");
	await runFlowSkillSync(resolveFlowPluginVersion(), log);

	const hooks: Hooks = {
		config: createConfigHook(ctx),
		tool: createTools(ctx),
		"command.execute.before": createCommandPreflightHook(),
	};
	// Contract: default behavior stays hook-free of experimental OpenCode
	// surfaces; compaction context is an explicit opt-in.
	if (process.env.FLOW_EXPERIMENTAL_COMPACTION === "1") {
		hooks["experimental.session.compacting"] = createCompactionHook(ctx);
		log("info", "Flow experimental compaction context enabled.");
	}
	return hooks;
};

export default FlowPlugin;
