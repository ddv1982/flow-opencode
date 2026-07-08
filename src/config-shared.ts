import { FLOW_SKILL_DEFINITIONS } from "./distribution/flow-skill-definitions";

export type FlowPermissionConfig = {
	edit?: string;
	bash?: string;
	skill?: string | Record<string, string>;
	task?: Record<string, string>;
	[toolPattern: string]: string | Record<string, string> | undefined;
};

export type FlowAgentConfig = {
	mode: "subagent";
	description: string;
	prompt: string;
	hidden?: boolean;
	model?: string;
	permission?: FlowPermissionConfig;
};

export type FlowCommandConfig = {
	description: string;
	template: string;
	agent?: string;
	subtask?: boolean;
};

export type MutableFlowConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
	instructions?: string[];
};

function flowSkillFileContent(skillName: string, relativePath: string): string {
	const definition = FLOW_SKILL_DEFINITIONS.find(
		(candidate) => candidate.name === skillName,
	);
	const file = definition?.files.find(
		(candidate) => candidate.relativePath === relativePath,
	);
	if (!file) {
		throw new Error(
			`Missing bundled Flow skill file ${skillName}/${relativePath}.`,
		);
	}
	return file.content;
}

function bundledFlowInstructions(
	sections: Array<readonly [skillName: string, relativePath: string]>,
): string {
	return sections
		.map(
			([skillName, relativePath]) =>
				`## Bundled ${skillName}/${relativePath}\n\n${flowSkillFileContent(skillName, relativePath)}`,
		)
		.join("\n\n");
}

const FLOW_REVIEW_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	["flow-review", "SKILL.md"],
	["flow-review", "references/review-rubric.md"],
	["flow-run", "references/audit-rubric.md"],
]);

const FLOW_PLAN_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	["flow-plan", "SKILL.md"],
	["flow-plan", "references/planning-examples.md"],
	["flow-plan", "references/plan-quality-checklist.md"],
	["flow-plan", "references/parallel-discovery.md"],
	["flow", "references/parallel-orchestration.md"],
	["flow", "references/handoff-format.md"],
]);

const FLOW_RUN_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	["flow-run", "SKILL.md"],
	["flow-run", "references/validation-rubric.md"],
	["flow-run", "references/audit-rubric.md"],
	["flow", "references/parallel-orchestration.md"],
	["flow", "references/handoff-format.md"],
	["flow-review", "SKILL.md"],
	["flow-review", "references/review-rubric.md"],
]);

const FLOW_AUTO_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	["flow", "SKILL.md"],
	["flow", "references/recovery-playbook.md"],
	["flow", "references/parallel-orchestration.md"],
	["flow", "references/handoff-format.md"],
	["flow-plan", "SKILL.md"],
	["flow-plan", "references/planning-examples.md"],
	["flow-plan", "references/plan-quality-checklist.md"],
	["flow-plan", "references/parallel-discovery.md"],
	["flow-run", "SKILL.md"],
	["flow-run", "references/validation-rubric.md"],
	["flow-run", "references/audit-rubric.md"],
	["flow-review", "SKILL.md"],
	["flow-review", "references/review-rubric.md"],
]);

const FLOW_SELF_CONTAINED_COMMAND_PREFLIGHT = [
	"Call `flow_status` first. If the result includes `setup.skills`, report the setup status and continue with the bundled public Flow command instructions below.",
	"If `flow_status` includes `session.resumePacket` or `session.budget.phaseBoundary`, stop the current autonomous loop and report the resume instructions unless this is a fresh user invocation explicitly resuming the session; only then may `flow_run_start` use `phaseBoundaryAck: true`.",
	"After `flow_status`, briefly state which bundled Flow command is running and for what goal, then continue.",
	"Do not call native Flow skills for `flow`, `flow-plan`, `flow-run`, or `flow-review` from public Flow commands. In bundled sections, `load` means read and use the corresponding bundled section in this command, and missing native public Flow skills are not blockers.",
	"Optional helper skills (`flow-test`, `flow-deslop`, `flow-ui-quality`, and user-triggered `flow-commit`) are not bundled fallbacks. If one is unavailable, record the coverage gap exactly as the bundled instructions require.",
].join(" ");

function flowBundledCommandTemplate(
	commandLabel: string,
	action: string,
	bundledInstructions: string,
): string {
	return [
		FLOW_SELF_CONTAINED_COMMAND_PREFLIGHT,
		`Run the bundled ${commandLabel} instructions below. ${action}`,
		"",
		bundledInstructions,
	].join("\n\n");
}

const FLOW_AUTO_COMMAND_TEMPLATE = flowBundledCommandTemplate(
	"Flow auto",
	"Drive the Flow loop until completion or a real blocker: $ARGUMENTS",
	FLOW_AUTO_BUNDLED_INSTRUCTIONS,
);

const FLOW_PLAN_COMMAND_TEMPLATE = flowBundledCommandTemplate(
	"Flow plan",
	"Plan: $ARGUMENTS",
	FLOW_PLAN_BUNDLED_INSTRUCTIONS,
);

const FLOW_RUN_COMMAND_TEMPLATE = flowBundledCommandTemplate(
	"Flow run",
	"Execute the next approved feature. $ARGUMENTS",
	FLOW_RUN_BUNDLED_INSTRUCTIONS,
);

const FLOW_REVIEW_COMMAND_TEMPLATE = flowBundledCommandTemplate(
	"Flow review",
	"Review: $ARGUMENTS",
	FLOW_REVIEW_BUNDLED_INSTRUCTIONS,
);

const FLOW_REVIEW_AGENT_INSTRUCTIONS = [
	"Use Flow review mode. Call `flow_status` first. Do not call the native skill tool for `flow-review`; the canonical Flow review instructions and rubric are already embedded below. If Flow setup reports stale/unavailable skills, continue as advisory review only and do not present advisory review as Flow-gated `featureReview` or `finalReview` evidence.",
	"Prefer the manager's compact review packet over the accumulated root transcript. Return feature review packets with `featureReviewDepth` plus `featureReview`; final reviews still return `finalReview` with `reviewDepth`.",
	"When the manager assigns a parallel review slice instead of a direct Flow review command, cite or drop every claim, label single-source, inferred, and unsettled claims, and return only the assigned Flow handoff. Report blocked if the assigned scope, expected coverage, or handoff shape is missing. Empty or unstructured output is a failed handoff; return blocked with the missing elements instead.",
	"",
	"## Bundled Flow review instructions",
	"",
	FLOW_REVIEW_BUNDLED_INSTRUCTIONS,
].join("\n\n");

const FLOW_STATUS_COMMAND_TEMPLATE =
	"Call flow_status and report the session state and next action.";

const FLOW_PUBLIC_COMMAND_TEMPLATES = {
	"flow-auto": FLOW_AUTO_COMMAND_TEMPLATE,
	"flow-plan": FLOW_PLAN_COMMAND_TEMPLATE,
	"flow-run": FLOW_RUN_COMMAND_TEMPLATE,
	"flow-review": FLOW_REVIEW_COMMAND_TEMPLATE,
	"flow-status": FLOW_STATUS_COMMAND_TEMPLATE,
} as const;

const FLOW_WORKER_HANDOFF_CONTRACT =
	"Return only the assigned Flow handoff. Cite or drop every claim, label single-source, inferred, and unsettled claims, and report blocked if the assigned scope, expected coverage, or handoff shape is missing. Empty or unstructured output is a failed handoff; return blocked with the missing elements instead.";

function envModel(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function flowWorkerModel(agentName: string): string | undefined {
	const fallback = envModel("OPENCODE_FLOW_WORKER_MODEL");
	if (agentName === "flow-candidate-worker") {
		return envModel("OPENCODE_FLOW_CANDIDATE_WORKER_MODEL") ?? fallback;
	}
	if (agentName === "flow-reviewer" || agentName === "flow-verifier-worker") {
		return envModel("OPENCODE_FLOW_REVIEW_WORKER_MODEL") ?? fallback;
	}
	return envModel("OPENCODE_FLOW_READONLY_WORKER_MODEL") ?? fallback;
}

// Worker permission maps below use tool-name and wildcard keys (`skill`,
// `task`, `flow_*`, `flow_status`) that are NOT in the SDK's simplified
// AgentConfig `permission` type. That mismatch is expected and not a bug:
// OpenCode compiles these keys into its resolved per-agent permission rule list
// and enforces them (the `flow_status` allow follows the `flow_*` deny, so
// status stays readable while every state-changing Flow tool is denied). This
// is proven end-to-end by the read-only-worker isolation assertions in
// tests/live-opencode-smoke.test.ts (FLOW_LIVE_SMOKE=1) — do not "fix" the type
// mismatch by dropping these keys.
export const FLOW_CORE_AGENTS = {
	"flow-reviewer": {
		mode: "subagent",
		hidden: true,
		description: "Internal read-only reviewer for Flow-guided work.",
		prompt: FLOW_REVIEW_AGENT_INSTRUCTIONS,
		permission: {
			edit: "deny",
			bash: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-evidence-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal read-only evidence worker for Flow planning and execution support.",
		prompt: `Use Flow evidence mode. Inspect only the assigned slice, do not edit files, do not call state-changing Flow tools, and return coverage, evidence inspected, confidence-tagged findings or facts, gaps, and manager follow-ups. ${FLOW_WORKER_HANDOFF_CONTRACT}`,
		permission: {
			edit: "deny",
			bash: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-validation-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal validation worker for Flow check selection and command evidence.",
		prompt: `Use Flow validation mode. Run only manager-specified commands or propose focused checks, do not edit files, do not call state-changing Flow tools, and report exact command, status, raw outcome summary, coverage, confidence, gaps, and manager follow-ups. ${FLOW_WORKER_HANDOFF_CONTRACT}`,
		permission: {
			edit: "deny",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-audit-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal read-only audit worker for refuted or surviving finding candidates.",
		prompt: `Use Flow audit mode. Inspect only the assigned slice, actively refute candidate findings before reporting them, do not edit files, do not call state-changing Flow tools, and return coverage, evidence, guards checked, confidence, gaps, and manager follow-ups. ${FLOW_WORKER_HANDOFF_CONTRACT}`,
		permission: {
			edit: "deny",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-candidate-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal candidate implementation worker for isolated Flow worktrees or exact non-overlapping path ownership.",
		prompt: `Use Flow candidate-implementation mode only when the manager assigned an isolated worktree or exact non-overlapping path ownership. Do not edit .flow/**, do not call state-changing Flow tools, do not complete Flow state, and return changed or proposed patch, verification run, coverage, confidence, merge risks, and manager follow-ups. ${FLOW_WORKER_HANDOFF_CONTRACT}`,
		permission: {
			edit: "ask",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
	"flow-verifier-worker": {
		mode: "subagent",
		hidden: true,
		description:
			"Internal verifier worker for checking Flow worker claims against cited evidence.",
		prompt: `Use Flow verifier mode. Verify only the assigned claims against the provided sources, commands, counts, or current docs. Do not generate new scope, do not edit files, do not call state-changing Flow tools, and return supported, partly-supported, unsupported, or source-not-found per claim with evidence, confidence, gaps, and manager follow-ups. ${FLOW_WORKER_HANDOFF_CONTRACT}`,
		permission: {
			edit: "deny",
			bash: "ask",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
} satisfies Record<string, FlowAgentConfig>;

export const FLOW_CORE_COMMANDS = {
	"flow-auto": {
		description: "Drive Flow skills against the minimal runtime ledger",
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-auto"],
	},
	"flow-plan": {
		description: "Create or approve a Flow plan",
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-plan"],
	},
	"flow-run": {
		description: "Run one approved Flow feature",
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-run"],
	},
	"flow-review": {
		description: "Run a read-only Flow review",
		agent: "flow-reviewer",
		subtask: true,
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-review"],
	},
	"flow-status": {
		description: "Inspect the active Flow session",
		template: FLOW_PUBLIC_COMMAND_TEMPLATES["flow-status"],
	},
} satisfies Record<string, FlowCommandConfig>;

export function createFlowCoreConfigEntries() {
	return {
		agent: Object.fromEntries(
			Object.entries(FLOW_CORE_AGENTS).map(([name, value]) => {
				const permission = value.permission
					? {
							...value.permission,
							...(value.permission.task
								? { task: { ...value.permission.task } }
								: {}),
						}
					: undefined;
				const model = flowWorkerModel(name);
				return [
					name,
					{
						...value,
						...(model ? { model } : {}),
						...(permission ? { permission } : {}),
					},
				];
			}),
		),
		command: Object.fromEntries(
			Object.entries(FLOW_CORE_COMMANDS).map(([name, value]) => [
				name,
				{ ...value },
			]),
		),
	};
}

function appendUnique(values: readonly string[], value: string): string[] {
	return values.includes(value) ? [...values] : [...values, value];
}

export function applyFlowConfig(
	config: MutableFlowConfig,
	options?: {
		flowInstructionPath?: string;
		onCollision?: (kind: "agent" | "command", name: string) => void;
	},
): void {
	const entries = createFlowCoreConfigEntries();
	if (options?.onCollision) {
		for (const name of Object.keys(entries.agent)) {
			if (config.agent && name in config.agent) {
				options.onCollision("agent", name);
			}
		}
		for (const name of Object.keys(entries.command)) {
			if (config.command && name in config.command) {
				options.onCollision("command", name);
			}
		}
	}
	config.agent = { ...(config.agent ?? {}), ...entries.agent };
	config.command = { ...(config.command ?? {}), ...entries.command };
	if (options?.flowInstructionPath) {
		config.instructions = appendUnique(
			config.instructions ?? [],
			options.flowInstructionPath,
		);
	}
}
