import { FLOW_CORE_COMMANDS } from "../../config-shared.js";
import { flowStatus } from "../../infrastructure/fs/workspace-flow-service.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
} from "../../infrastructure/fs/workspace-validation.js";
import { resolveFlowPluginVersion } from "../../version.js";
import { AutoDriveCoordinator } from "./auto-drive.js";
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

function textPart(
	text: string,
	synthetic = false,
	metadata?: Readonly<Record<string, unknown>>,
): Part {
	return {
		type: "text",
		text,
		...(synthetic ? { synthetic: true } : {}),
		...(metadata ? { metadata } : {}),
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
	autoDrive: AutoDriveCoordinator,
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
		if (command !== "flow-auto") {
			autoDrive.deactivate(input.sessionID);
		} else {
			const metadata = await autoDrive.activate(input.sessionID);
			const instruction = output.parts.find(
				(part): part is TextPart =>
					part.type === "text" && part.synthetic === true,
			);
			if (!instruction) {
				autoDrive.deactivate(input.sessionID);
				throw new Error("/flow-auto is missing its synthetic instruction.");
			}
			instruction.metadata = {
				...(instruction.metadata ?? {}),
				...metadata,
			};
		}
	};
}

type FlowTools = NonNullable<Hooks["tool"]>;

function guardTools(
	tools: FlowTools,
	runtimeGuard: FlowLeadershipHandle,
): FlowTools {
	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => [
			name,
			{
				...definition,
				execute: async (...args: Parameters<typeof definition.execute>) => {
					const status = runtimeGuard.query();
					if (!status.operational) {
						return JSON.stringify({
							status: "error",
							summary: status.message,
							workflowData: { runtimeGuard: status },
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
	const runtimeGuard = registerFlowPluginInstance(
		ctx.worktree ?? ctx.directory,
		{
			packageName: "opencode-plugin-flow",
			version,
			protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
			instanceId: createFlowPluginInstanceId(),
		},
	);
	const initial = runtimeGuard.query();
	log(
		initial.operational ? "info" : "error",
		`Flow ${version}: ${initial.message}`,
	);

	const workspace = ctx.worktree ?? ctx.directory;
	const autoDrive = new AutoDriveCoordinator({
		readProjection: async () => {
			const response = await flowStatus(workspace, {
				request: { view: "compact" },
			});
			if (response.status !== "ok") throw new Error(response.summary);
			const projection = response.workflowData.projection;
			if (projection.view !== "compact")
				throw new Error("Flow auto-drive received a non-compact projection.");
			return {
				sessionId: "sessionId" in projection ? projection.sessionId : undefined,
				status: projection.status,
				revision: projection.revision,
				nextAction: projection.nextAction,
			};
		},
		prompt: async (sessionID, prompt, delivery, metadata) => {
			await ctx.client.session.promptAsync({
				path: { id: sessionID },
				query: { directory: ctx.directory },
				body: {
					agent: delivery.agent,
					model: delivery.model,
					parts: [
						{
							type: "text",
							text: prompt,
							synthetic: true,
							metadata: { ...metadata },
						},
					],
				},
				throwOnError: true,
			});
		},
		onWarning: (message) => log("warn", message),
	});
	const validation = new ValidationCaptureCoordinator({
		persistObservation: persistWorkspaceValidation,
	});
	const tools = createTools(ctx, {
		validation,
		prepareValidation: prepareWorkspaceValidation,
		autoTimingSnapshot: () => autoDrive.timingSnapshot(),
	});

	return {
		config: createConfigHook(ctx, {
			assertOperational: (action) => runtimeGuard.assertOperational(action),
		}),
		tool: guardTools(tools, runtimeGuard),
		"command.execute.before": createCommandHook(
			(action) => runtimeGuard.assertOperational(action),
			autoDrive,
		),
		"chat.message": async (input, output) => {
			const observed = await autoDrive.observeMessage(
				input.sessionID,
				{
					agent: output.message.agent,
					model: output.message.model,
				},
				output.parts,
			);
			if (observed === "stale-continuation") {
				throw new Error("Discarded a stale Flow auto continuation.");
			}
		},
		"experimental.session.compacting": async (input, output) => {
			const context = autoDrive.compactionContext(input.sessionID);
			if (context) output.context.push(context);
		},
		event: async (input) => {
			const event = input.event;
			if (event.type === "session.deleted" || event.type === "session.error") {
				const sessionID =
					event.type === "session.deleted"
						? event.properties.info.id
						: event.properties.sessionID;
				if (sessionID) {
					validation.cancel(sessionID);
					autoDrive.deactivate(sessionID);
				} else {
					autoDrive.clear();
				}
				return;
			}
			if (event.type !== "session.idle" && event.type !== "session.compacted") {
				return;
			}
			const sessionID = event.properties?.sessionID;
			validation.cancel(sessionID);
			if (event.type === "session.idle") {
				if (runtimeGuard.query().operational) {
					await autoDrive.onIdle(sessionID);
				} else {
					autoDrive.deactivate(sessionID);
				}
			}
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
			autoDrive.clear();
			runtimeGuard.release();
		},
	} satisfies Hooks;
};

export default FlowPlugin;
