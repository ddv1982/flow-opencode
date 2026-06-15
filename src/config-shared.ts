import flowReviewReviewRubricDoc from "../skills/flow-review/references/review-rubric.md" with {
	type: "text",
};
import flowReviewSkillDoc from "../skills/flow-review/SKILL.md" with {
	type: "text",
};

export type FlowPermissionConfig = {
	edit?: string;
	bash?: string;
	task?: Record<string, string>;
	[toolPattern: string]: string | Record<string, string> | undefined;
};

export type FlowAgentConfig = {
	mode: "subagent";
	description: string;
	prompt: string;
	hidden?: boolean;
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
};

const FLOW_REVIEW_FALLBACK_PROMPT = [
	"Use Flow review mode. Load `flow-review` when the skill registry is current. If Flow setup reports stale skills or the skill loader reports that `flow-review` is unavailable, continue with the bundled review instructions below instead.",
	"",
	"## Bundled Flow review fallback",
	"",
	"## Bundled flow-review/SKILL.md",
	flowReviewSkillDoc,
	"## Bundled flow-review/references/review-rubric.md",
	flowReviewReviewRubricDoc,
].join("\n\n");

export const FLOW_CORE_AGENTS = {
	"flow-reviewer": {
		mode: "subagent",
		hidden: true,
		description: "Internal read-only reviewer for Flow-guided work.",
		prompt: FLOW_REVIEW_FALLBACK_PROMPT,
		permission: {
			edit: "deny",
			bash: "deny",
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
		prompt:
			"Use Flow evidence mode. Inspect only the assigned slice, do not edit files, do not call state-changing Flow tools, and return coverage, evidence inspected, confidence-tagged findings or facts, gaps, and manager follow-ups.",
		permission: {
			edit: "deny",
			bash: "deny",
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
		prompt:
			"Use Flow validation mode. Run only manager-specified commands or propose focused checks, do not edit files, do not call state-changing Flow tools, and report exact command, status, raw outcome summary, coverage, confidence, gaps, and manager follow-ups.",
		permission: {
			edit: "deny",
			bash: "ask",
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
		prompt:
			"Use Flow audit mode. Inspect only the assigned slice, actively refute candidate findings before reporting them, do not edit files, do not call state-changing Flow tools, and return coverage, evidence, guards checked, confidence, gaps, and manager follow-ups.",
		permission: {
			edit: "deny",
			bash: "ask",
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
		prompt:
			"Use Flow candidate-implementation mode only when the manager assigned an isolated worktree or exact non-overlapping path ownership. Do not edit .flow/**, do not call state-changing Flow tools, do not complete Flow state, and return changed or proposed patch, verification run, coverage, confidence, merge risks, and manager follow-ups.",
		permission: {
			edit: "ask",
			bash: "ask",
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
		prompt:
			"Use Flow verifier mode. Verify only the assigned claims against the provided sources, commands, counts, or current docs. Do not generate new scope, do not edit files, do not call state-changing Flow tools, and return supported, partly-supported, unsupported, or source-not-found per claim with evidence, confidence, gaps, and manager follow-ups.",
		permission: {
			edit: "deny",
			bash: "ask",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		},
	},
} satisfies Record<string, FlowAgentConfig>;

export const FLOW_CORE_COMMANDS = {
	"flow-auto": {
		description: "Drive Flow skills against the minimal runtime ledger",
		template:
			"Load the `flow` skill and drive the Flow loop until completion or a real blocker: $ARGUMENTS",
	},
	"flow-plan": {
		description: "Create or approve a Flow plan",
		template: "Load the `flow-plan` skill and plan: $ARGUMENTS",
	},
	"flow-run": {
		description: "Run one approved Flow feature",
		template:
			"Load the `flow-run` skill and execute the next approved feature. $ARGUMENTS",
	},
	"flow-review": {
		description: "Run a read-only Flow review",
		agent: "flow-reviewer",
		subtask: true,
		template:
			"Load `flow-review`; if loading fails because the skill is unavailable, use the bundled review fallback. Review: $ARGUMENTS",
	},
	"flow-status": {
		description: "Inspect the active Flow session",
		template: "Call flow_status and report the session state and next action.",
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
				return [
					name,
					{
						...value,
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

export function applyFlowConfig(config: MutableFlowConfig): void {
	const entries = createFlowCoreConfigEntries();
	config.agent = { ...(config.agent ?? {}), ...entries.agent };
	config.command = { ...(config.command ?? {}), ...entries.command };
}
