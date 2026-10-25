import type { SessionPromptInput } from "@opencode/client";
import type { FlowService } from "../../application/flow-service.js";
import type {
	RecoveryController,
	RecoverySettings,
} from "../../application/recovery-policy.js";
import { FLOW_CORE_COMMANDS } from "../../config-shared.js";
import { requestEvidenceAnchor } from "../../domain/request-evidence.js";
import type { AutoDriveCoordinator, AutoGoalIntent } from "./auto-drive.js";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type PreparedFlowCommand = Readonly<{
	name: FlowCommandName;
	goal: string;
	text: string;
	settings: RecoverySettings | null;
	explicit: boolean;
	stopping: boolean;
	intent: AutoGoalIntent;
}>;
const PLAN_ONLY_REQUEST = [
	/\b(?:plan[- ]only|planning[- ]only)\b/i,
	/\b(?:only|just)\s+(?:(?:want|need|draft|write|create|make|prepare|give\s+me|show\s+me)\s+)?(?:(?:a|an|the)\s+)?(?:(?:flow|phased|inspection)\s+)?plan\b/i,
	/\b(?:draft|write|create|make|prepare)\s+(?:a\s+)?(?:flow\s+)?plan\s+only\b/i,
	/\b(?:do not|don't)\s+(?:run|execute|start)\b/i,
	/\b(?:wait|pause|stop)\s+for\s+(?:my\s+)?approval\b/i,
];
const REVIEW_DELIVERABLE =
	/\b(?:review|inspect|audit|analy[sz]e|assess|survey)\b/i;
const PLAN_DELIVERABLE =
	/\b(?:create|draft|write|make|produce|develop|prepare)\s+(?:(?:a|an|the)\s+)?(?:(?:phased|improvement|action|implementation)\s+)?(?:plan|roadmap)\b/i;
const NO_PRODUCT_IMPLEMENTATION =
	/\b(?:do not|don't)\s+implement\b|\bstop\s+before\s+implementation\b/gi;
const PRODUCT_CHANGE =
	/\b(?:implement|fix|repair|refactor|modify|edit|improve|build|apply\s+(?:the\s+)?changes?|update\s+(?:the\s+)?(?:code|deps|dependencies))\b/i;
function autoGoalIntent(goal: string): AutoGoalIntent {
	const request = goal.replace(/`[^`]*`|"[^"]*"|'[^']*'/g, " ");
	if (PLAN_ONLY_REQUEST.some((pattern) => pattern.test(request)))
		return "plan-only";
	const withoutNegation = request.replace(NO_PRODUCT_IMPLEMENTATION, " ");
	if (PRODUCT_CHANGE.test(withoutNegation)) return "uncertain";
	const review = REVIEW_DELIVERABLE.exec(request);
	const plan = PLAN_DELIVERABLE.exec(request);
	if (review && plan && review.index < plan.index)
		return "inspection-deliverable";
	return withoutNegation !== request ? "plan-only" : "uncertain";
}
export function prepareFlowCommand(
	name: FlowCommandName,
	args: string,
): PreparedFlowCommand {
	const parsed =
		name === "flow-auto"
			? parseRecoveryCommand(args)
			: { goal: args, settings: null, explicit: false };
	const stopping =
		name === "flow-auto" && /^(?:stop|cancel)$/i.test(args.trim());
	const template = FLOW_CORE_COMMANDS[name].template
		.split("$ARGUMENTS")
		.join(
			name === "flow-review"
				? parsed.goal
				: "the preceding Flow request in this same input",
		);
	return Object.freeze({
		name,
		...parsed,
		stopping,
		intent: autoGoalIntent(parsed.goal),
		text: stopping
			? "/flow-auto stop"
			: `Flow ${name}${parsed.goal.trim() ? `: ${parsed.goal}` : ""}\n\n${template}`,
	});
}

export function createCommandHook(
	options: Readonly<{
		assertOperational(action: string): void;
		autoDrive: AutoDriveCoordinator;
		flow: FlowService;
		recovery: RecoveryController;
		defaultRecovery?: (() => RecoverySettings | null) | undefined;
	}>,
) {
	return async (
		command: PreparedFlowCommand,
		host: string,
		assertCurrent: () => void,
		invocationToken?: string,
	): Promise<Readonly<Record<string, unknown>> | null> => {
		assertCurrent();
		options.assertOperational(`execute /${command.name}`);
		const { autoDrive, recovery, flow } = options;
		if (command.stopping) {
			recovery.revoke(host);
			autoDrive.deactivate(host, "cancelled");
			return null;
		}
		if (command.name !== "flow-auto") {
			if (command.name === "flow-plan") {
				const evidence = requestEvidenceAnchor(command.goal, host);
				if (evidence) {
					await flow.status({ request: { view: "compact" } });
					assertCurrent();
					await flow.requestAnchor({ goal: command.goal, evidence });
					assertCurrent();
				}
			}
			const token =
				command.name === "flow-run" || command.name === "flow-status"
					? await autoDrive.resumeForCommand(host)
					: null;
			assertCurrent();
			if (!token) {
				recovery.revoke(host);
				autoDrive.deactivate(host);
			}
			return token ? { "opencode-plugin-flow/auto": token } : null;
		}
		autoDrive.clear();
		recovery.activate(
			host,
			command.explicit
				? command.settings
				: (options.defaultRecovery?.() ?? null),
			command.explicit ? "explicit" : "default",
		);
		let newlyAnchoredSessionId: string | null = null;
		const evidence = requestEvidenceAnchor(command.goal, host);
		if (evidence) {
			await flow.status({ request: { view: "compact" } });
			assertCurrent();
			newlyAnchoredSessionId = await flow.requestAnchor({
				goal: command.goal,
				evidence,
			});
			assertCurrent();
		}
		const metadata = await autoDrive.activate(host, command.goal, {
			...(invocationToken === undefined ? {} : { token: invocationToken }),
			newlyAnchoredSessionId,
			intent: command.intent,
		});
		assertCurrent();
		return metadata;
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
	const trailingOff = /(?:^|\s)--recovery=off\s*$/.exec(rest);
	if (trailingOff && !fields.size) {
		const goal = rest.slice(0, trailingOff.index).trim();
		if (!/(?:^|\s)--recovery\S*/.test(goal))
			return { goal, settings: null, explicit: true };
	}
	if (/(?:^|\s)--recovery\S*/.test(rest))
		throw new Error("Invalid recovery command options.");
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

export function nativePromptPayload(
	prompt: import("@opencode/plugin/promise/command").CommandInvocation["prompt"],
): Omit<SessionPromptInput, "sessionID" | "id" | "resume" | "delivery"> {
	return {
		text: prompt.text,
		...(prompt.files === undefined
			? {}
			: {
					files: prompt.files.map((file) => ({
						uri: file.uri,
						...(file.name === undefined ? {} : { name: file.name }),
						...(file.description === undefined
							? {}
							: { description: file.description }),
						...(file.mention === undefined
							? {}
							: { mention: { ...file.mention } }),
					})),
				}),
		...(prompt.agents === undefined
			? {}
			: {
					agents: prompt.agents.map((agent) => ({
						name: agent.name,
						...(agent.mention === undefined
							? {}
							: { mention: { ...agent.mention } }),
					})),
				}),
		...(prompt.skills === undefined
			? {}
			: {
					skills: prompt.skills.map((skill) => ({
						id: skill.id,
						...(skill.mention === undefined
							? {}
							: { mention: { ...skill.mention } }),
					})),
				}),
	};
}

export function flowCommandName(name: string): keyof typeof FLOW_CORE_COMMANDS {
	if (
		name === "flow-auto" ||
		name === "flow-plan" ||
		name === "flow-run" ||
		name === "flow-review" ||
		name === "flow-status"
	)
		return name;
	throw new Error("Unknown Flow command.");
}
