// Flow mode contract source: keep durable mode boundaries here so prompts, evals, and capture tooling do not drift.
// Prompts may explain behavior, but these contracts are the first-party ownership map for mode-level policy tests.

export type FlowPromptMode =
	| "flow-plan"
	| "flow-auto"
	| "flow-run"
	| "flow-worker"
	| "flow-reviewer"
	| "flow-control"
	| "flow-review";

export type FlowPromptCaptureMode = Exclude<FlowPromptMode, "flow-review">;

export type FlowModeSurfaceKind = "command" | "agent";

export type FlowModeRuntimeMutation =
	| "none"
	| "planning"
	| "execution"
	| "autonomous_execution"
	| "explicit_control_only";

export type FlowModeRepositoryMutation = "none" | "allowed";

export type FlowModeContract = {
	mode: FlowPromptMode;
	title: string;
	surfaceKind: FlowModeSurfaceKind;
	sourcePaths: readonly string[];
	runtimeMutation: FlowModeRuntimeMutation;
	repositoryMutation: FlowModeRepositoryMutation;
	allowedFlowTools: readonly string[];
	forbiddenFlowTools: readonly string[];
	requiredBehavior: readonly string[];
	stopCondition: string;
};

const PROMPT_MODE_CONTRACT_SOURCE_PATH = "src/prompts/mode-contracts.ts";

export const FLOW_PROMPT_MODE_CAPTURE_MODES = [
	"flow-plan",
	"flow-auto",
	"flow-run",
	"flow-worker",
	"flow-reviewer",
	"flow-control",
] as const satisfies readonly FlowPromptCaptureMode[];

export const FLOW_PROMPT_MODE_ORDER = [
	...FLOW_PROMPT_MODE_CAPTURE_MODES,
	"flow-review",
] as const satisfies readonly FlowPromptMode[];

export const FLOW_MODE_CONTRACTS = {
	"flow-plan": {
		mode: "flow-plan",
		title: "Plan management command",
		surfaceKind: "command",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			"src/prompts/commands.ts",
			"src/prompts/agents.ts",
			"src/prompts/contracts.ts",
		],
		runtimeMutation: "planning",
		repositoryMutation: "none",
		allowedFlowTools: [
			"flow_plan_start",
			"flow_plan_context_record",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_plan_select_features",
		],
		forbiddenFlowTools: [
			"flow_auto_prepare",
			"flow_run_start",
			"flow_run_complete_feature",
			"flow_review_record_feature",
			"flow_review_record_final",
			"flow_reset_feature",
			"flow_session_close",
		],
		requiredBehavior: [
			"Normalize untrusted arguments into planning intent.",
			"Record repo/package-manager context before persisting a plan.",
			"Plan work against the repo coding guidelines, release hygiene, and expected test coverage.",
			"Stop at draft summary, approval, or auto-approved next execution step.",
			"Emit concise phase-boundary progress before and after planning work.",
		],
		stopCondition:
			"Plan is drafted/applied/approved as requested; no implementation starts from this mode.",
	},
	"flow-auto": {
		mode: "flow-auto",
		title: "Autonomous coordinator command",
		surfaceKind: "command",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			"src/prompts/commands.ts",
			"src/prompts/agents.ts",
			"src/prompts/fragments.ts",
		],
		runtimeMutation: "autonomous_execution",
		repositoryMutation: "allowed",
		allowedFlowTools: [
			"flow_auto_prepare",
			"flow_plan_start",
			"flow_plan_context_record",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_run_start",
			"flow_review_record_feature",
			"flow_review_record_final",
			"flow_run_complete_feature",
			"flow_reset_feature",
		],
		forbiddenFlowTools: ["flow_session_close"],
		requiredBehavior: [
			"Call flow_auto_prepare before planning or repo inspection.",
			"Stop on missing goal or human decision gates.",
			"Apply coding guidelines, release hygiene, and tests before completion.",
			"Keep one feature active until clean, blocked, or replanned.",
			"Emit concise phase-boundary progress across planning, execution, validation, review, recovery, and finalization.",
		],
		stopCondition:
			"Session completes, reaches a real blocker, or exposes a human decision gate.",
	},
	"flow-run": {
		mode: "flow-run",
		title: "Single-feature execution command",
		surfaceKind: "command",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			"src/prompts/commands.ts",
			"src/prompts/contracts.ts",
			"src/prompts/fragments.ts",
		],
		runtimeMutation: "execution",
		repositoryMutation: "allowed",
		allowedFlowTools: [
			"flow_run_start",
			"flow_review_record_feature",
			"flow_review_record_final",
			"flow_run_complete_feature",
		],
		forbiddenFlowTools: [
			"flow_auto_prepare",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_session_close",
		],
		requiredBehavior: [
			"Execute exactly one approved feature.",
			"Run targeted validation before claiming success.",
			"Apply coding guidelines and reject debug-only artifacts before completion.",
			"Persist reviewer approval before advancing when required.",
			"Emit concise phase-boundary progress across execution, validation, review, and completion.",
		],
		stopCondition:
			"One feature is cleanly completed, blocked, or there is no runnable feature.",
	},
	"flow-worker": {
		mode: "flow-worker",
		title: "Feature worker agent",
		surfaceKind: "agent",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			"src/prompts/agents.ts",
			"src/prompts/contracts.ts",
			"src/prompts/fragments.ts",
		],
		runtimeMutation: "execution",
		repositoryMutation: "allowed",
		allowedFlowTools: [
			"flow_run_start",
			"flow_review_record_feature",
			"flow_review_record_final",
			"flow_run_complete_feature",
		],
		forbiddenFlowTools: [
			"flow_auto_prepare",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_session_close",
		],
		requiredBehavior: [
			"Treat the active feature as the sole execution target.",
			"Validate and self-review changed files before success.",
			"Apply coding guidelines and reject debug-only artifacts before completion.",
			"Return structured replan/blocker data instead of partial success.",
			"Emit concise phase-boundary progress across execution, validation, review, and completion.",
		],
		stopCondition:
			"Worker result is persisted only after clean validation/review or a true blocker.",
	},
	"flow-reviewer": {
		mode: "flow-reviewer",
		title: "Execution reviewer agent",
		surfaceKind: "agent",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			"src/prompts/agents.ts",
			"src/prompts/contracts.ts",
		],
		runtimeMutation: "none",
		repositoryMutation: "none",
		allowedFlowTools: [],
		forbiddenFlowTools: [
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_run_start",
			"flow_run_complete_feature",
			"flow_reset_feature",
			"flow_session_close",
		],
		requiredBehavior: [
			"Review only; do not implement fixes.",
			"Treat release hygiene and missing test coverage as review concerns.",
			"Approve only when blocking findings are empty.",
			"Return needs_fix for same-feature repair loops.",
		],
		stopCondition:
			"Reviewer returns approved, needs_fix, or blocked with concrete findings/evidence.",
	},
	"flow-control": {
		mode: "flow-control",
		title: "Runtime control agent",
		surfaceKind: "agent",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			"src/prompts/commands.ts",
			"src/prompts/agents.ts",
		],
		runtimeMutation: "explicit_control_only",
		repositoryMutation: "none",
		allowedFlowTools: [
			"flow_status",
			"flow_doctor",
			"flow_history",
			"flow_history_show",
			"flow_session_activate",
			"flow_session_close",
			"flow_reset_feature",
			"flow_review_render",
		],
		forbiddenFlowTools: [
			"flow_auto_prepare",
			"flow_plan_start",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_run_start",
			"flow_run_complete_feature",
			"flow_review_record_feature",
			"flow_review_record_final",
		],
		requiredBehavior: [
			"Never plan, approve, run, or continue workflow execution.",
			"Mutate runtime state only for explicit control commands.",
			"Stop after rendering the requested status/control result.",
			"For multi-step control operations, emit one progress update before the runtime call and one outcome summary after it.",
		],
		stopCondition:
			"Requested control operation is summarized; no workflow advances.",
	},
	"flow-review": {
		mode: "flow-review",
		title: "Standalone read-only audit command",
		surfaceKind: "command",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			"src/audit/prompts/commands.ts",
			"src/audit/prompts/contracts.ts",
			"src/audit/prompts/fragments.ts",
			"src/audit/report-presenter.ts",
			"src/audit/report-schema.ts",
		],
		runtimeMutation: "none",
		repositoryMutation: "none",
		allowedFlowTools: ["flow_review_render"],
		forbiddenFlowTools: [
			"flow_auto_prepare",
			"flow_plan_start",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_run_start",
			"flow_run_complete_feature",
			"flow_review_record_feature",
			"flow_review_record_final",
			"flow_reset_feature",
			"flow_session_activate",
			"flow_session_close",
		],
		requiredBehavior: [
			"Stay read-only with respect to repository code and Flow state.",
			"Maintain discoveredSurfaces as the canonical coverage ledger.",
			"Downgrade achievedDepth when coverage does not support full_audit.",
			"Emit concise phase-boundary progress while mapping surfaces, inspecting evidence, and rendering the report.",
		],
		stopCondition:
			"Rendered human/structured audit report is returned from flow_review_render.",
	},
} as const satisfies Record<FlowPromptMode, FlowModeContract>;

export function getFlowModeContract(mode: FlowPromptMode): FlowModeContract {
	return FLOW_MODE_CONTRACTS[mode];
}

export function getFlowModeSourcePaths(mode: FlowPromptMode): string[] {
	return [...getFlowModeContract(mode).sourcePaths];
}

export function getFlowModeForbiddenTools(mode: FlowPromptMode): string[] {
	return [...getFlowModeContract(mode).forbiddenFlowTools];
}
