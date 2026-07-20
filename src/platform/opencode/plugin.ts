import { FLOW_CORE_COMMANDS } from "../../config-shared.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
} from "../../infrastructure/fs/workspace-validation.js";
import { resolveFlowPluginVersion } from "../../version.js";
import { createConfigHook } from "./config.js";
import {
	createFlowPluginInstanceId,
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	type FlowLeadershipHandle,
	registerFlowPluginInstance,
} from "./leadership.js";
import { createFlowLog } from "./logging.js";
import type { Hooks, Plugin } from "./sdk.js";
import { createTools } from "./tools.js";
import { ValidationCaptureCoordinator } from "./validation-capture.js";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type CommandOutput = Parameters<
	NonNullable<Hooks["command.execute.before"]>
>[1];
type Part = CommandOutput["parts"][number];
type TextPart = Extract<Part, { type: "text" }>;
type SubtaskPart = Extract<Part, { type: "subtask" }> & { command?: string };

function isFlowCommand(command: string): command is FlowCommandName {
	return Object.hasOwn(FLOW_CORE_COMMANDS, command);
}

function commandPrompt(command: FlowCommandName, args: string): string {
	return FLOW_CORE_COMMANDS[command].template.replaceAll(
		"$ARGUMENTS",
		() => args,
	);
}

function textPart(text: string, synthetic = false): Part {
	return {
		type: "text",
		text,
		...(synthetic ? { synthetic: true } : {}),
	} as TextPart;
}

function rewriteManagerCommand(
	command: FlowCommandName,
	args: string,
	output: CommandOutput,
): void {
	if (output.parts.some((part) => part.type === "subtask")) {
		throw new Error("Flow manager commands cannot contain subtask parts.");
	}
	const preserved = output.parts.filter((part) => part.type !== "text");
	output.parts.splice(
		0,
		output.parts.length,
		textPart(
			args.trim() ? `Flow ${command}: ${args.trim()}` : `Flow ${command}`,
		),
		textPart(commandPrompt(command, args), true),
		...preserved,
	);
}

function rewriteReviewerCommand(
	command: FlowCommandName,
	args: string,
	output: CommandOutput,
): void {
	if (output.parts.length !== 1 || output.parts[0]?.type !== "subtask") {
		throw new Error(`/${command} requires exactly one reviewer subtask.`);
	}
	const subtask = output.parts[0] as SubtaskPart;
	const config = FLOW_CORE_COMMANDS[command];
	if (!config.subtask || subtask.agent !== config.agent) {
		throw new Error(
			`/${command} must dispatch to '${config.subtask ? config.agent : "none"}'.`,
		);
	}
	if (subtask.command?.replace(/^\/+/, "") !== command) {
		throw new Error(`/${command} subtask identity did not match.`);
	}
	subtask.prompt = commandPrompt(command, args);
}

function createCommandHook(
	assertOperational: (action: string) => void,
): NonNullable<Hooks["command.execute.before"]> {
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommand(command)) return;
		assertOperational(`execute /${command}`);
		if (FLOW_CORE_COMMANDS[command].subtask) {
			rewriteReviewerCommand(command, input.arguments, output);
		} else {
			rewriteManagerCommand(command, input.arguments, output);
		}
	};
}

type FlowTools = NonNullable<Hooks["tool"]>;

function guardTools(
	tools: FlowTools,
	leadership: FlowLeadershipHandle,
): FlowTools {
	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => [
			name,
			{
				...definition,
				execute: async (...args: Parameters<typeof definition.execute>) => {
					if (!leadership.isOperational()) {
						return JSON.stringify({
							status: "error",
							summary:
								"Flow is disabled because more than one runtime is registered for this project.",
							workflowData: { runtimeGuard: leadership.query() },
						});
					}
					return definition.execute(...args);
				},
			},
		]),
	) as FlowTools;
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = createFlowLog(ctx);
	const version = resolveFlowPluginVersion();
	const leadership = registerFlowPluginInstance(ctx.worktree ?? ctx.directory, {
		packageName: "opencode-plugin-flow",
		version,
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: createFlowPluginInstanceId(),
	});
	const initial = leadership.query();
	log(
		initial.operational ? "info" : "error",
		`Flow ${version}: ${initial.message}`,
	);

	const validation = new ValidationCaptureCoordinator({
		persistObservation: persistWorkspaceValidation,
	});
	const tools = createTools(ctx, {
		validation,
		prepareValidation: prepareWorkspaceValidation,
	});

	return {
		config: createConfigHook(ctx, {
			assertOperational: (action) => leadership.assertOperational(action),
		}),
		tool: guardTools(tools, leadership),
		"command.execute.before": createCommandHook((action) =>
			leadership.assertOperational(action),
		),
		event: async (input) => {
			const event = input.event as {
				type?: string;
				properties?: { sessionID?: unknown };
			};
			if (event.type !== "session.idle" && event.type !== "session.compacted") {
				return;
			}
			const sessionID = event.properties?.sessionID;
			if (typeof sessionID === "string") validation.cancel(sessionID);
		},
		"tool.execute.before": async (input, output) => {
			validation.observeToolBefore(input, output);
		},
		"tool.execute.after": async (input, output) => {
			try {
				await validation.observeToolAfter(input, output);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log("error", "Flow validation capture failed closed.", { message });
				output.output = `${output.output}\n\n[flow-validation-error] ${message}`;
			}
		},
		dispose: async () => {
			leadership.release();
		},
	} satisfies Hooks;
};

export default FlowPlugin;
