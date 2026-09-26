import type { FlowService } from "../../application/flow-service.js";
import type {
	RecoveryController,
	RecoverySettings,
} from "../../application/recovery-policy.js";
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
		recovery?: RecoveryController;
		defaultRecovery?: () => RecoverySettings | null;
		showRefusal?: (message: string) => Promise<void>;
	}>,
): CommandHook {
	const { assertOperational, autoDrive, flow, recovery } = options;
	let generation = 0;
	let invocation: { host: string; generation: number } | null = null;
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommand(command)) return;
		const action = input.arguments.trim();
		const stopping =
			command === "flow-auto" && /^(?:stop|cancel)$/i.test(action);
		let cancelledPending = false;
		if (command === "flow-auto" && !stopping) {
			invocation = { host: input.sessionID, generation: ++generation };
			autoDrive.clear();
			recovery?.revoke();
		} else if (invocation?.host === input.sessionID) {
			cancelledPending = true;
			invocation = null;
			generation++;
			recovery?.revoke(input.sessionID);
			autoDrive.deactivate(input.sessionID);
		}
		const entryGeneration = generation;
		const assertCurrent = () => {
			if (generation !== entryGeneration)
				throw new Error("Flow command was superseded.");
		};
		const parsed =
			command === "flow-auto"
				? parseRecoveryCommand(input.arguments)
				: { goal: input.arguments, settings: null, explicit: false };
		if (command === "flow-auto" && /^(?:stop|cancel)$/i.test(action)) {
			const confirmed = output.parts.some(
				(part) => part.type === "text" && part.text === AUTO_STOPPED,
			);
			recovery?.revoke(input.sessionID);
			const response =
				autoDrive.deactivate(input.sessionID) || cancelledPending || confirmed
					? AUTO_STOPPED
					: "No Flow auto lease was active in this OpenCode session.";
			output.parts[0] = asHostTextPart(textPart(response));
			output.parts.length = 1;
			return;
		}
		try {
			assertOperational(`execute /${command}`);
			const settings =
				command === "flow-auto" && !parsed.explicit
					? (options.defaultRecovery?.() ?? null)
					: parsed.settings;
			if (settings) {
				if (!recovery) throw new Error("Recovery is unavailable in this host.");
				recovery.activate(input.sessionID, settings);
			} else recovery?.revoke(input.sessionID);
			if (command === "flow-auto" || command === "flow-plan") {
				const evidence = requestEvidenceAnchor(parsed.goal, input.sessionID);
				if (evidence) {
					await flow.status({ request: { view: "compact" } });
					assertCurrent();
					await flow.requestAnchor({ goal: parsed.goal, evidence });
					assertCurrent();
				}
			}
			assertCurrent();
			rewriteCommand(command, parsed.goal, output);
			if (command !== "flow-auto")
				return void autoDrive.deactivate(input.sessionID);
			const metadata = await autoDrive.activate(input.sessionID);
			assertCurrent();
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
				throw new Error("/flow-auto is missing its synthetic instruction.");
			}
			instruction.metadata = { ...instruction.metadata, ...metadata };
		} catch (error) {
			if (
				command === "flow-auto" &&
				invocation?.host === input.sessionID &&
				invocation.generation === entryGeneration
			) {
				invocation = null;
				recovery?.revoke(input.sessionID);
				autoDrive.deactivate(input.sessionID);
			}
			if (
				command === "flow-auto" &&
				error instanceof Error &&
				error.message.startsWith("Delegated recovery is unavailable.")
			) {
				try {
					await options.showRefusal?.(error.message);
				} catch {}
			}
			throw error;
		}
	};
}

export function parseRecoveryCommand(args: string): {
	goal: string;
	settings: RecoverySettings | null;
	explicit: boolean;
} {
	let rest = args.trim();
	const fields = new Map<string, string>();
	while (rest.startsWith("--recovery")) {
		const match = /^(--recovery(?:-calls|-usd)?)=([^\s]+)(?:\s+|$)/.exec(rest);
		if (!match?.[1] || !match[2] || fields.has(match[1]))
			throw new Error("Invalid recovery command options.");
		fields.set(match[1], match[2]);
		rest = rest.slice(match[0].length);
	}
	if (!fields.size) return { goal: args, settings: null, explicit: false };
	const mode = fields.get("--recovery"),
		calls = fields.get("--recovery-calls"),
		usd = fields.get("--recovery-usd");
	if (mode === "off" && fields.size === 1)
		return { goal: rest, settings: null, explicit: true };
	if (
		(mode !== "shadow" && mode !== "delegated") ||
		!calls ||
		!/^\d+$/.test(calls) ||
		!usd ||
		!/^\d+(\.\d+)?$/.test(usd)
	)
		throw new Error(
			"Recovery requires --recovery=off or --recovery=shadow|delegated with --recovery-calls=N and --recovery-usd=X.",
		);
	return {
		goal: rest,
		settings: { mode, maxCalls: Number(calls), maxUsd: Number(usd) },
		explicit: true,
	};
}
