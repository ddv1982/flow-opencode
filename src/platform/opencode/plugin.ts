import { createValidationReceiptStore } from "../../application/validation-receipts.js";
import {
	FLOW_CORE_COMMANDS,
	type FlowHarnessRuntimeConfig,
	resolveFlowHarnessRuntimeConfig,
} from "../../config-shared.js";
import { createFileEvidenceArtifactStore } from "../../infrastructure/fs/evidence-artifact-store.js";
import { prepareWorkspaceValidation } from "../../infrastructure/fs/workspace-validation.js";
import { resolveFlowPluginVersion } from "../../version.js";
import { createConfigHook } from "./config.js";
import { createHarnessTools } from "./harness-tools.js";
import {
	createFlowPluginInstanceId,
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	type FlowLeadershipHandle,
	registerFlowPluginInstance,
} from "./leadership.js";
import { createFlowLog } from "./logging.js";
import {
	createFlowHostObservationHooks,
	FlowHostObservationRegistry,
} from "./observation.js";
import {
	OrchestrationAdmissionCoordinator,
	orchestrationPolicy,
} from "./orchestration-admission.js";
import type { Hooks, Plugin } from "./sdk.js";
import { createTools } from "./tools.js";
import { ValidationCaptureCoordinator } from "./validation-capture.js";

type FlowCommandName = keyof typeof FLOW_CORE_COMMANDS;
type FlowCommandOutput = Parameters<
	NonNullable<Hooks["command.execute.before"]>
>[1];
type Part = FlowCommandOutput["parts"][number];
type FlowTextPart = Extract<Part, { type: "text" }>;
type FlowSubtaskPart = Extract<Part, { type: "subtask" }>;
type FlowSubtaskPartWithCommand = FlowSubtaskPart & { command?: string };

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

function renderFlowHarnessRuntimePolicy(
	runtime: FlowHarnessRuntimeConfig,
): string {
	const profilePolicy = {
		control:
			"Keep optional worker passes discretionary and do not add flow_orchestration_admit ceremony solely for this profile.",
		standard:
			"Keep optional evidence, audit, verification, and candidate passes bounded. Call flow_orchestration_admit before each such pass and adapt the proposal to every returned policy reason before dispatch.",
		assurance:
			"Use broader admitted evidence and audit coverage when repository risk merits it. Call flow_orchestration_admit before each optional evidence, audit, verification, or candidate pass and adapt the proposal to every returned policy reason before dispatch.",
	} as const;
	const rolloutPolicy = {
		control:
			"Admission enforcement is disabled; do not treat admission as proof that a pass is useful.",
		observe:
			"Admission is observational. A wouldDeny result does not block dispatch, but revise avoidable policy violations before continuing.",
		enforce:
			"Admission is enforced. Do not dispatch an optional Flow worker unless its exact proposal was admitted.",
	} as const;

	return [
		"## Active Flow harness runtime policy",
		"This trusted plugin footer selects the active profile and overrides conflicting static profile defaults.",
		`- Profile: \`${runtime.profile}\`. ${profilePolicy[runtime.profile]}`,
		`- Rollout: \`${runtime.rolloutMode}\`. ${rolloutPolicy[runtime.rolloutMode]}`,
		"- The lifecycle-required flow-reviewer and flow-validation-worker are not optional orchestration passes and do not use flow_orchestration_admit.",
		"- Validation receipts remain mandatory in every profile: call flow_validation_start, run its exact next Bash command, and pass the returned immutable receipt reference to flow_review_start.",
	].join("\n");
}

function renderFlowCommandPreflight(
	command: FlowCommandName,
	args: string,
	runtime: FlowHarnessRuntimeConfig,
): string {
	return `${renderFlowCommandTemplate(command, args)}\n\n${renderFlowHarnessRuntimePolicy(runtime)}`;
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
	return part?.type === "subtask";
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

function replaceManagerCommandParts(
	output: FlowCommandOutput,
	titleSeed: string,
	text: string,
): void {
	const { parts } = output;
	if (parts.some(isFlowSubtaskPart)) {
		throw new Error(
			"Flow refused to execute a manager command with an unexpected subtask part.",
		);
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

function replaceSubtaskCommandPrompt(
	command: FlowCommandName,
	output: FlowCommandOutput,
	agent: string,
	text: string,
): void {
	const { parts } = output;
	if (parts.length !== 1 || !isFlowSubtaskPart(parts[0])) {
		throw new Error(
			`Flow refused to execute /${command}: OpenCode must provide exactly one subtask part.`,
		);
	}
	const subtask = parts[0] as FlowSubtaskPartWithCommand;
	if (subtask.agent !== agent) {
		throw new Error(
			`Flow refused to execute /${command}: expected subtask agent '${agent}', received '${subtask.agent}'.`,
		);
	}
	if (subtask.command?.replace(/^\/+/, "") !== command) {
		throw new Error(
			`Flow refused to execute /${command}: subtask command identity did not match.`,
		);
	}
	subtask.prompt = text;
}

function createCommandPreflightHook(
	runtime: FlowHarnessRuntimeConfig,
	assertOperational?: (action: string) => void,
): NonNullable<Hooks["command.execute.before"]> {
	return async (input, output) => {
		const command = input.command.replace(/^\/+/, "");
		if (!isFlowCommandName(command)) return;
		assertOperational?.(`execute /${command}`);
		const config = FLOW_CORE_COMMANDS[command];
		const prompt = renderFlowCommandPreflight(
			command,
			input.arguments,
			runtime,
		);
		if (config.subtask) {
			replaceSubtaskCommandPrompt(command, output, config.agent, prompt);
			return;
		}
		replaceManagerCommandParts(
			output,
			renderFlowCommandTitleSeed(command, input.arguments),
			prompt,
		);
	};
}

type FlowTools = NonNullable<Hooks["tool"]>;

function leadershipDiagnostic(handle: FlowLeadershipHandle): string {
	const status = handle.query();
	return JSON.stringify({
		status: "error",
		summary: "Flow runtime activation is not unique.",
		dataNote:
			"Activation identities below are diagnostics only; run activation-check outside OpenCode before changing configuration.",
		workflowData: {
			activation: {
				reason: status.reason,
				role: status.role,
				registeredCount: status.registeredCount,
				diagnosticLeader: status.diagnosticLeader,
				registrations: status.registrations,
				message: status.message,
			},
		},
	});
}

function guardFlowTools(
	tools: FlowTools,
	handle: FlowLeadershipHandle,
): FlowTools {
	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => [
			name,
			{
				...definition,
				execute: async (...args: Parameters<typeof definition.execute>) => {
					if (!handle.isOperational()) return leadershipDiagnostic(handle);
					return definition.execute(...args);
				},
			},
		]),
	) as FlowTools;
}

const FlowPlugin: Plugin = async (ctx) => {
	const log = createFlowLog(ctx);
	const version = resolveFlowPluginVersion();
	const leadership = registerFlowPluginInstance(ctx.directory, {
		packageName: "opencode-plugin-flow",
		version,
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: createFlowPluginInstanceId(),
	});
	const initialLeadership = leadership.query();
	log(
		initialLeadership.operational ? "info" : "error",
		`Flow ${version} plugin initialized. ${initialLeadership.message}`,
		{
			version,
			protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
			instanceId: leadership.identity.instanceId,
			projectDirectory: leadership.scopeId,
			leadershipReason: initialLeadership.reason,
			registeredCount: initialLeadership.registeredCount,
		},
	);

	const observations = new FlowHostObservationRegistry();
	const observationHooks = createFlowHostObservationHooks(observations);
	const runtime = resolveFlowHarnessRuntimeConfig();
	const orchestration = new OrchestrationAdmissionCoordinator({
		policy: orchestrationPolicy({
			profile: runtime.profile,
			rollout: runtime.rolloutMode,
		}),
	});
	const validation = new ValidationCaptureCoordinator({
		publishReceipt: (worktree, receipt) =>
			createValidationReceiptStore(
				createFileEvidenceArtifactStore(worktree),
			).publishValidationReceipt(receipt),
	});
	const tools = {
		...createTools(ctx),
		...createHarnessTools({
			orchestration,
			validation,
			prepareValidation: prepareWorkspaceValidation,
		}),
	};

	const hooks: Hooks = {
		config: createConfigHook(ctx, {
			assertOperational: (action) => leadership.assertOperational(action),
		}),
		tool: guardFlowTools(tools, leadership),
		"command.execute.before": createCommandPreflightHook(runtime, (action) =>
			leadership.assertOperational(action),
		),
		event: async (input) => {
			await observationHooks.event?.(input);
			const event = input.event as {
				type?: string;
				properties?: { sessionID?: unknown };
			};
			if (event.type !== "session.idle" && event.type !== "session.compacted") {
				return;
			}
			const sessionID = event.properties?.sessionID;
			if (typeof sessionID !== "string") return;
			if (event.type === "session.compacted" || event.type === "session.idle") {
				validation.cancel(sessionID);
				orchestration.cancel(sessionID);
			}
			const report = observations.snapshot(sessionID);
			if (report) {
				log("info", "Flow host observation summary.", {
					report,
					orchestration: orchestration.report(),
				});
			}
		},
		"chat.message": async (input, output) => {
			await observationHooks["chat.message"]?.(input, output);
		},
		"tool.execute.before": async (input, output) => {
			await observationHooks["tool.execute.before"]?.(input, output);
			orchestration.observeToolBefore(input, output);
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
			await observationHooks["tool.execute.after"]?.(input, output);
		},
		dispose: async () => {
			leadership.release();
		},
	};
	return hooks;
};

export default FlowPlugin;
