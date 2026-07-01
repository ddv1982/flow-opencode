import flowHandoffFormatDoc from "../skills/flow/references/handoff-format.md" with {
	type: "text",
};
import flowParallelOrchestrationDoc from "../skills/flow/references/parallel-orchestration.md" with {
	type: "text",
};
import flowParallelPassExampleDoc from "../skills/flow/references/parallel-pass-example.md" with {
	type: "text",
};
import flowParallelPassPatternsDoc from "../skills/flow/references/parallel-pass-patterns.md" with {
	type: "text",
};
import flowRecoveryPlaybookDoc from "../skills/flow/references/recovery-playbook.md" with {
	type: "text",
};
import flowVerificationGatesDoc from "../skills/flow/references/verification-gates.md" with {
	type: "text",
};
import flowSkillDoc from "../skills/flow/SKILL.md" with { type: "text" };
import flowPlanParallelDiscoveryDoc from "../skills/flow-plan/references/parallel-discovery.md" with {
	type: "text",
};
import flowPlanPlanningExamplesDoc from "../skills/flow-plan/references/planning-examples.md" with {
	type: "text",
};
import flowPlanSkillDoc from "../skills/flow-plan/SKILL.md" with {
	type: "text",
};
import flowReviewReviewRubricDoc from "../skills/flow-review/references/review-rubric.md" with {
	type: "text",
};
import flowReviewSkillDoc from "../skills/flow-review/SKILL.md" with {
	type: "text",
};
import flowRunAuditRubricDoc from "../skills/flow-run/references/audit-rubric.md" with {
	type: "text",
};
import flowRunValidationRubricDoc from "../skills/flow-run/references/validation-rubric.md" with {
	type: "text",
};
import flowRunSkillDoc from "../skills/flow-run/SKILL.md" with { type: "text" };

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

function bundledFlowInstructions(
	sections: Array<{ label: string; content: string }>,
): string {
	return sections
		.map((section) => `## Bundled ${section.label}\n\n${section.content}`)
		.join("\n\n");
}

const FLOW_REVIEW_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	{ label: "flow-review/SKILL.md", content: flowReviewSkillDoc },
	{
		label: "flow-review/references/review-rubric.md",
		content: flowReviewReviewRubricDoc,
	},
	{
		label: "flow-run/references/audit-rubric.md",
		content: flowRunAuditRubricDoc,
	},
]);

const FLOW_PLAN_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	{ label: "flow-plan/SKILL.md", content: flowPlanSkillDoc },
	{
		label: "flow-plan/references/planning-examples.md",
		content: flowPlanPlanningExamplesDoc,
	},
	{
		label: "flow-plan/references/parallel-discovery.md",
		content: flowPlanParallelDiscoveryDoc,
	},
	{
		label: "flow/references/parallel-orchestration.md",
		content: flowParallelOrchestrationDoc,
	},
	{
		label: "flow/references/parallel-pass-patterns.md",
		content: flowParallelPassPatternsDoc,
	},
	{
		label: "flow/references/parallel-pass-example.md",
		content: flowParallelPassExampleDoc,
	},
	{
		label: "flow/references/handoff-format.md",
		content: flowHandoffFormatDoc,
	},
	{
		label: "flow/references/verification-gates.md",
		content: flowVerificationGatesDoc,
	},
]);

const FLOW_RUN_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	{ label: "flow-run/SKILL.md", content: flowRunSkillDoc },
	{
		label: "flow-run/references/validation-rubric.md",
		content: flowRunValidationRubricDoc,
	},
	{
		label: "flow-run/references/audit-rubric.md",
		content: flowRunAuditRubricDoc,
	},
	{
		label: "flow/references/parallel-orchestration.md",
		content: flowParallelOrchestrationDoc,
	},
	{
		label: "flow/references/parallel-pass-patterns.md",
		content: flowParallelPassPatternsDoc,
	},
	{
		label: "flow/references/parallel-pass-example.md",
		content: flowParallelPassExampleDoc,
	},
	{
		label: "flow/references/handoff-format.md",
		content: flowHandoffFormatDoc,
	},
	{
		label: "flow/references/verification-gates.md",
		content: flowVerificationGatesDoc,
	},
	{ label: "flow-review/SKILL.md", content: flowReviewSkillDoc },
	{
		label: "flow-review/references/review-rubric.md",
		content: flowReviewReviewRubricDoc,
	},
]);

const FLOW_AUTO_BUNDLED_INSTRUCTIONS = bundledFlowInstructions([
	{ label: "flow/SKILL.md", content: flowSkillDoc },
	{
		label: "flow/references/recovery-playbook.md",
		content: flowRecoveryPlaybookDoc,
	},
	{
		label: "flow/references/parallel-orchestration.md",
		content: flowParallelOrchestrationDoc,
	},
	{
		label: "flow/references/parallel-pass-patterns.md",
		content: flowParallelPassPatternsDoc,
	},
	{
		label: "flow/references/parallel-pass-example.md",
		content: flowParallelPassExampleDoc,
	},
	{
		label: "flow/references/handoff-format.md",
		content: flowHandoffFormatDoc,
	},
	{
		label: "flow/references/verification-gates.md",
		content: flowVerificationGatesDoc,
	},
	{ label: "flow-plan/SKILL.md", content: flowPlanSkillDoc },
	{
		label: "flow-plan/references/planning-examples.md",
		content: flowPlanPlanningExamplesDoc,
	},
	{
		label: "flow-plan/references/parallel-discovery.md",
		content: flowPlanParallelDiscoveryDoc,
	},
	{ label: "flow-run/SKILL.md", content: flowRunSkillDoc },
	{
		label: "flow-run/references/validation-rubric.md",
		content: flowRunValidationRubricDoc,
	},
	{
		label: "flow-run/references/audit-rubric.md",
		content: flowRunAuditRubricDoc,
	},
	{ label: "flow-review/SKILL.md", content: flowReviewSkillDoc },
	{
		label: "flow-review/references/review-rubric.md",
		content: flowReviewReviewRubricDoc,
	},
]);

const FLOW_SELF_CONTAINED_COMMAND_PREFLIGHT = [
	"Call `flow_status` first. If the result includes `setup.skills`, report the setup status and continue with the bundled public Flow command instructions below.",
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
	"When the manager assigns a parallel review slice instead of a direct Flow review command, cite or drop every claim, label single-source, inferred, and unsettled claims, and return only the assigned Flow handoff. Report blocked if the assigned scope, expected coverage, or handoff shape is missing.",
	"",
	"## Bundled Flow review instructions",
	"",
	FLOW_REVIEW_BUNDLED_INSTRUCTIONS,
].join("\n\n");

const FLOW_STATUS_COMMAND_TEMPLATE =
	"Call flow_status and report the session state and next action.";

const FLOW_REVIEW_FALLBACK_PROMPT = FLOW_REVIEW_AGENT_INSTRUCTIONS;

const FLOW_PUBLIC_COMMAND_TEMPLATES = {
	"flow-auto": FLOW_AUTO_COMMAND_TEMPLATE,
	"flow-plan": FLOW_PLAN_COMMAND_TEMPLATE,
	"flow-run": FLOW_RUN_COMMAND_TEMPLATE,
	"flow-review": FLOW_REVIEW_COMMAND_TEMPLATE,
	"flow-status": FLOW_STATUS_COMMAND_TEMPLATE,
} as const;

const FLOW_WORKER_HANDOFF_CONTRACT =
	"Return only the assigned Flow handoff. Cite or drop every claim, label single-source, inferred, and unsettled claims, and report blocked if the assigned scope, expected coverage, or handoff shape is missing.";

export const FLOW_CORE_AGENTS = {
	"flow-reviewer": {
		mode: "subagent",
		hidden: true,
		description: "Internal read-only reviewer for Flow-guided work.",
		prompt: FLOW_REVIEW_FALLBACK_PROMPT,
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

function appendUnique(values: readonly string[], value: string): string[] {
	return values.includes(value) ? [...values] : [...values, value];
}

export function applyFlowConfig(
	config: MutableFlowConfig,
	options?: { flowInstructionPath?: string },
): void {
	const entries = createFlowCoreConfigEntries();
	config.agent = { ...(config.agent ?? {}), ...entries.agent };
	config.command = { ...(config.command ?? {}), ...entries.command };
	if (options?.flowInstructionPath) {
		config.instructions = appendUnique(
			config.instructions ?? [],
			options.flowInstructionPath,
		);
	}
}
