// Flow mode contract source: keep durable mode boundaries here so prompts, evals, and capture tooling do not drift.
// Prompts may explain behavior, but these contracts are the first-party ownership map for mode-level policy tests.

export type FlowPromptMode =
	| "flow-plan"
	| "flow-auto"
	| "flow-run"
	| "flow-planning-researcher"
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
const CORE_ROLE_PROTOCOL_SOURCE_PATH = "src/core/protocols/roles.ts";
const GENERATED_ROLE_PROMPT_SOURCE_PATH =
	"src/prompts/generated/role-prompts.ts";
const GENERATED_COMMAND_TEMPLATE_SOURCE_PATH =
	"src/prompts/generated/command-templates.ts";

export const FLOW_PROMPT_MODE_CAPTURE_MODES = [
	"flow-plan",
	"flow-auto",
	"flow-run",
	"flow-worker",
	"flow-planning-researcher",
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
			CORE_ROLE_PROTOCOL_SOURCE_PATH,
			GENERATED_COMMAND_TEMPLATE_SOURCE_PATH,
			"src/prompts/commands.ts",
			GENERATED_ROLE_PROMPT_SOURCE_PATH,
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
			"Record stackProfile and standardsProfile before persisting a plan.",
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
			CORE_ROLE_PROTOCOL_SOURCE_PATH,
			GENERATED_COMMAND_TEMPLATE_SOURCE_PATH,
			"src/prompts/commands.ts",
			GENERATED_ROLE_PROMPT_SOURCE_PATH,
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
			"Leave native OpenCode image/file attachments in host/model context; Flow does not materialize them into workspace files.",
			"Stop on missing goal or human decision gates.",
			"Record and apply the runtime-owned stack and standards profile.",
			"For ordinary implementation completion, rely on passing validation plus featureReview/finalReview payloads; persist recorded reviewer decisions only for review, review_and_fix, or explicit strictReview governance.",
			"For each planning, execution, and review phase, report handoffMode as exactly task_subagent, inline_role, or not_supported before acting; do not treat derived task-progress rows as proof of an actual OpenCode Task/subagent handoff.",
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
			CORE_ROLE_PROTOCOL_SOURCE_PATH,
			GENERATED_COMMAND_TEMPLATE_SOURCE_PATH,
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
			"Apply the stored stack and standards profile before editing.",
			"Apply coding guidelines, reject debug-only artifacts, and preserve intentional observability before completion.",
			"For ordinary implementation completion, provide passing featureReview/finalReview payloads; persist reviewer approval only when review, review_and_fix, or explicit strictReview governance requires it.",
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
			CORE_ROLE_PROTOCOL_SOURCE_PATH,
			GENERATED_ROLE_PROMPT_SOURCE_PATH,
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
			"Apply the stored stack and standards profile before editing.",
			"Validate and self-review changed files before success.",
			"Apply coding guidelines, reject debug-only artifacts, and preserve intentional observability before completion.",
			"When strict/review governance requests reviewer approval, distinguish handoffMode exactly as task_subagent for an actual flow-reviewer Task handoff, inline_role for inline approval fallback, or not_supported when Task is unavailable or denied.",
			"Return structured replan/blocker data instead of partial success.",
			"Emit concise phase-boundary progress across execution, validation, review, and completion.",
		],
		stopCondition:
			"Worker result is persisted only after clean validation/review or a true blocker.",
	},
	"flow-planning-researcher": {
		mode: "flow-planning-researcher",
		title: "Planning research agent",
		surfaceKind: "agent",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			GENERATED_ROLE_PROMPT_SOURCE_PATH,
			"src/prompts/agents.ts",
			"src/prompts/fragments.ts",
		],
		runtimeMutation: "none",
		repositoryMutation: "none",
		allowedFlowTools: [],
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
			"flow_session_close",
		],
		requiredBehavior: [
			"Stay read-only and do not call Flow runtime tools.",
			"Produce evidence packets for planner/coordinator handoff.",
			"Recommend review-first decomposition for broad review-and-fix goals without existing findings.",
			"Do not invent findings or closure evidence during planning research.",
		],
		stopCondition:
			"A compact planning research JSON packet is returned; no runtime state or repository code changes.",
	},
	"flow-reviewer": {
		mode: "flow-reviewer",
		title: "Execution reviewer agent",
		surfaceKind: "agent",
		sourcePaths: [
			PROMPT_MODE_CONTRACT_SOURCE_PATH,
			CORE_ROLE_PROTOCOL_SOURCE_PATH,
			GENERATED_ROLE_PROMPT_SOURCE_PATH,
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
			"Gate approval against the stored stack and standards profile.",
			"Treat release hygiene, preserved observability, and missing test coverage as review concerns.",
			"Remain leaf-like: do not delegate further by default; return an evidence-backed decision.",
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
			CORE_ROLE_PROTOCOL_SOURCE_PATH,
			GENERATED_COMMAND_TEMPLATE_SOURCE_PATH,
			"src/prompts/commands.ts",
			GENERATED_ROLE_PROMPT_SOURCE_PATH,
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
			"flow_review_render",
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
			"src/audit/prompts/agents.ts",
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
