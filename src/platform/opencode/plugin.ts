import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dataNote } from "../../application/flow-response.js";
import { FLOW_CORE_COMMANDS } from "../../config-shared.js";
import { requestEvidenceAnchor } from "../../domain/request-evidence.js";
import { createWorkspaceFlowService } from "../../infrastructure/fs/workspace-flow-service.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
	readWorkspaceTestReport,
} from "../../infrastructure/fs/workspace-validation.js";
import { resolveFlowPluginVersion } from "../../version.js";
import { AutoDriveCoordinator } from "./auto-drive.js";
import { createConfigHook } from "./config.js";
import {
	createFlowPluginInstanceId,
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	type FlowLeadershipHandle,
	type FlowLeadershipReason,
	type FlowLeadershipStatus,
	registerFlowPluginInstance,
} from "./leadership.js";
import { createFlowLog } from "./logging.js";
import type { Hooks, Plugin } from "./sdk.js";
import { createTools } from "./tools.js";
import { ValidationCaptureCoordinator } from "./validation-capture.js";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type CommandHook = NonNullable<Hooks["command.execute.before"]>;
type CommandOutput = Parameters<CommandHook>[1];
type Part = CommandOutput["parts"][number];
type TextPart = Extract<Part, { type: "text" }>;
/**
 * A text part as the plugin writes one: the host assigns id, sessionID, and
 * messageID only after the command hook returns.
 */
type DraftTextPart = Omit<TextPart, "id" | "sessionID" | "messageID">;
const MUTATION =
	/^flow_(?:plan_save|plan_approve|run_start|review_start|feature_complete|feature_reset|session_close)$/;
const AUTO_STOPPED = "Flow auto stopped.";
function isFlowCommand(command: string): command is FlowCommandName {
	return Object.hasOwn(FLOW_CORE_COMMANDS, command);
}
function acceptedMutation(tool: string, output: string) {
	if (!MUTATION.test(tool)) return null;
	try {
		const response = JSON.parse(output);
		const data = response.workflowData;
		const closeAccepted =
			tool === "flow_session_close" &&
			response.status === "error" &&
			data?.closeState?.durableAccepted === true;
		const revision = data?.projection?.revision;
		if (
			data?.operation?.replayed !== false ||
			(response.status !== "ok" && !closeAccepted) ||
			typeof revision !== "number" ||
			!Number.isSafeInteger(revision)
		)
			return null;
		const sessionId = data.projection?.sessionId;
		return {
			revision,
			sessionId: typeof sessionId === "string" ? sessionId : undefined,
		};
	} catch {
		return null;
	}
}
function textPart(
	text: string,
	synthetic = false,
	metadata?: Readonly<Record<string, unknown>>,
): DraftTextPart {
	return {
		type: "text",
		text,
		...(synthetic ? { synthetic: true } : {}),
		...(metadata ? { metadata } : {}),
	};
}
/**
 * The command hook's parts are typed with the identity the host assigns after
 * the hook returns, so a part written here is a draft at runtime. This is the
 * one place a draft crosses into the host's array.
 */
function asHostTextPart(part: DraftTextPart): TextPart {
	return part as TextPart;
}
function rewriteCommand(
	command: FlowCommandName,
	args: string,
	output: CommandOutput,
): void {
	const config = FLOW_CORE_COMMANDS[command];
	const promptArgs = config.subtask
		? args
		: "the preceding non-synthetic Flow request";
	const prompt = config.template.split("$ARGUMENTS").join(promptArgs);
	if (!config.subtask) {
		if (output.parts.some((part) => part.type === "subtask"))
			throw new Error("Flow manager commands cannot contain subtask parts.");
		const preserved = output.parts.filter((part) => part.type !== "text");
		output.parts.splice(
			0,
			output.parts.length,
			asHostTextPart(
				textPart(args.trim() ? `Flow ${command}: ${args}` : `Flow ${command}`),
			),
			asHostTextPart(textPart(prompt, true)),
			...preserved,
		);
		return;
	}
	const part = output.parts[0];
	if (output.parts.length !== 1 || part?.type !== "subtask")
		throw new Error(`/${command} requires exactly one reviewer subtask.`);
	if (part.agent !== config.agent)
		throw new Error(`/${command} must dispatch to '${config.agent}'.`);
	// The host's subtask type does not declare `command`, but a command-dispatched
	// subtask carries it at runtime, so its presence is checked, not asserted.
	const declared = "command" in part ? part.command : undefined;
	if (typeof declared !== "string" || declared.replace(/^\/+/, "") !== command)
		throw new Error(`/${command} subtask identity did not match.`);
	part.prompt = prompt;
}
function createCommandHook(
	assertOperational: (action: string) => void,
	autoDrive: AutoDriveCoordinator,
	workspace: string,
): CommandHook {
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommand(command)) return;
		const action = input.arguments.trim();
		if (command === "flow-auto" && /^(?:stop|cancel)$/i.test(action)) {
			const confirmed = output.parts.some(
				(part) => part.type === "text" && part.text === AUTO_STOPPED,
			);
			const response =
				autoDrive.deactivate(input.sessionID) || confirmed
					? AUTO_STOPPED
					: "No Flow auto lease was active in this OpenCode session.";
			output.parts[0] = asHostTextPart(textPart(response));
			output.parts.length = 1;
			return;
		}
		assertOperational(`execute /${command}`);
		if (command === "flow-auto" || command === "flow-plan") {
			const evidence = requestEvidenceAnchor(input.arguments, input.sessionID);
			if (evidence) {
				const flow = createWorkspaceFlowService(workspace);
				await flow.status({ request: { view: "compact" } });
				await flow.requestAnchor({ goal: input.arguments, evidence });
			}
		}
		rewriteCommand(command, input.arguments, output);
		if (command !== "flow-auto")
			return void autoDrive.deactivate(input.sessionID);
		const metadata = await autoDrive.activate(input.sessionID);
		// Preflight, not a gate. The lifecycle works either way; what changes is
		// whether the user is told up front that this host cannot carry the
		// continuation, instead of watching Flow stop after every feature and
		// guessing which of the two it is.
		if (autoDrive.continuationSupport() === "unsupported") {
			output.parts.unshift(
				asHostTextPart(
					textPart(
						"Note: this OpenCode host does not report assistant message parentage, so Flow cannot continue automatically between features here. Each feature still runs normally; drive the next one with /flow-run.",
					),
				),
			);
		}
		const instruction = output.parts.find(
			(part): part is TextPart =>
				part.type === "text" && part.synthetic === true,
		);
		if (!instruction) {
			autoDrive.deactivate(input.sessionID);
			throw new Error("/flow-auto is missing its synthetic instruction.");
		}
		instruction.metadata = { ...instruction.metadata, ...metadata };
	};
}
type FlowTools = NonNullable<Hooks["tool"]>;

/**
 * Tools whose successful output is markdown prose rather than a Flow response
 * envelope. A guard rejection must stay in the same shape the caller is reading,
 * so these get a markdown failure instead of a JSON blob.
 */
const MARKDOWN_TOOLS = new Set(["flow_guidance"]);

/** Actionable recovery for each non-operational leadership reason. */
function guardRecovery(reason: FlowLeadershipReason): string {
	switch (reason) {
		case "duplicate-instances":
			return "Two Flow plugin instances are registered for this project. Remove the duplicate installation so exactly one remains, then restart OpenCode.";
		case "incompatible-registry":
			return "Another Flow build owns an incompatible runtime registry. Align the installed Flow versions, then restart OpenCode.";
		default:
			return "Flow is not registered for this project. Restart OpenCode to re-register, then retry.";
	}
}

function guardRejection(name: string, status: FlowLeadershipStatus): string {
	const recovery = guardRecovery(status.reason);
	if (MARKDOWN_TOOLS.has(name)) {
		return `${status.message}\n\nRecovery: ${recovery}`;
	}
	// The same envelope every other Flow failure uses, so a caller told to read
	// `workflowData.failure.recovery` finds it here too.
	return JSON.stringify({
		status: "error",
		summary: status.message,
		workflowData: {
			dataNote: dataNote(),
			failure: { summary: status.message, recovery },
			runtimeGuard: status,
		},
	});
}

function guardTools(
	tools: FlowTools,
	runtimeGuard: FlowLeadershipHandle,
	autoDrive: AutoDriveCoordinator,
): FlowTools {
	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => [
			name,
			{
				...definition,
				execute: async (...args: Parameters<typeof definition.execute>) => {
					const status = runtimeGuard.query();
					if (!status.operational) return guardRejection(name, status);
					const output = await definition.execute(...args);
					const mutation = acceptedMutation(name, String(output));
					const context = args[1];
					if (mutation)
						autoDrive.observeMutation(
							context.sessionID,
							mutation.revision,
							name === "flow_plan_save" && mutation.revision === 1
								? mutation.sessionId
								: undefined,
							context.messageID,
							name === "flow_review_start",
						);
					return output;
				},
			},
		]),
	) as FlowTools;
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = createFlowLog(ctx);
	const version = resolveFlowPluginVersion();
	const pluginEntrySha256 = `sha256:${createHash("sha256")
		.update(await readFile(fileURLToPath(import.meta.url)))
		.digest("hex")}`;
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
	const level = initial.operational ? "info" : "error";
	log(level, `Flow ${version}: ${initial.message}`);
	const workspace = ctx.worktree ?? ctx.directory;
	const autoDrive = new AutoDriveCoordinator({
		readProjection: async () => {
			const response = await createWorkspaceFlowService(workspace).status({
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
					parts: [textPart(prompt, true, metadata)],
				},
				throwOnError: true,
			});
		},
		onWarning: (message) => log("warn", message),
	});
	const validation = new ValidationCaptureCoordinator({
		persistObservation: persistWorkspaceValidation,
		readReport: readWorkspaceTestReport,
	});
	const tools = createTools(ctx, {
		validation,
		prepareValidation: prepareWorkspaceValidation,
		autoTimingSnapshot: () => autoDrive.timingSnapshot(),
		autoContinuationSupport: () => autoDrive.continuationSupport(),
		runtimeIdentity: { packageVersion: version, pluginEntrySha256 },
	});
	return {
		config: createConfigHook(ctx, {
			assertOperational: (action) => runtimeGuard.assertOperational(action),
		}),
		tool: guardTools(tools, runtimeGuard, autoDrive),
		"command.execute.before": createCommandHook(
			(action) => runtimeGuard.assertOperational(action),
			autoDrive,
			workspace,
		),
		"chat.message": async (input, output) => {
			const observed = await autoDrive.observeMessage(
				input.sessionID,
				{
					agent: output.message.agent,
					model: output.message.model,
				},
				output.parts,
				output.message.id,
			);
			if (observed === "stale-continuation")
				throw new Error("Discarded a stale Flow auto continuation.");
		},
		"experimental.session.compacting": async (input, output) => {
			const context = autoDrive.compactionContext(input.sessionID);
			if (context) output.context.push(context);
		},
		event: async (input) => {
			const event = input.event;
			if (event.type === "message.updated")
				return autoDrive.observeHostMessage(
					event.properties.info.sessionID,
					event.properties.info,
				);
			if (event.type === "message.part.updated")
				return autoDrive.observeHostPart(
					event.properties.part.sessionID,
					event.properties.part,
				);
			if (event.type === "session.deleted" || event.type === "session.error") {
				const sessionID =
					event.type === "session.deleted"
						? event.properties.info.id
						: event.properties.sessionID;
				if (!sessionID) return autoDrive.clear();
				validation.cancel(sessionID);
				return void autoDrive.deactivate(sessionID);
			}
			if (event.type !== "session.idle" && event.type !== "session.compacted")
				return;
			const sessionID = event.properties?.sessionID;
			validation.cancel(sessionID);
			if (event.type === "session.compacted")
				return autoDrive.observeCompaction(sessionID);
			if (runtimeGuard.query().operational) return autoDrive.onIdle(sessionID);
			autoDrive.deactivate(sessionID);
		},
		"tool.execute.before": async (input, output) =>
			validation.observeToolBefore(input, output),
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
