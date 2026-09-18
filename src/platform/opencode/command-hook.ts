import type { FlowService } from "../../application/flow-service.js";
import { FLOW_CORE_COMMANDS } from "../../config-shared.js";
import { requestEvidenceAnchor } from "../../domain/request-evidence.js";
import type { AutoDriveCoordinator } from "./auto-drive.js";
import type { Hooks } from "./sdk.js";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type CommandHook = NonNullable<Hooks["command.execute.before"]>;
type CommandOutput = Parameters<CommandHook>[1];
type Part = CommandOutput["parts"][number];
type TextPart = Extract<Part, { type: "text" }>;
// Host assigns id, sessionID and messageID after the command hook returns.
type DraftTextPart = Omit<TextPart, "id" | "sessionID" | "messageID">;
const AUTO_STOPPED = "Flow auto stopped.";
function isFlowCommand(command: string): command is FlowCommandName {
	return Object.hasOwn(FLOW_CORE_COMMANDS, command);
}
export function textPart(
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
export function createCommandHook(
	options: Readonly<{
		assertOperational: (action: string) => void;
		autoDrive: AutoDriveCoordinator;
		flow: FlowService;
	}>,
): CommandHook {
	const { assertOperational, autoDrive, flow } = options;
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
