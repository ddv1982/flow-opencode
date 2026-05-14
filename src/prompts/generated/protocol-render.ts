import {
	type CoreRoleProtocol,
	type CoreRoleProtocolId,
	getCoreRoleActions,
	getCoreRoleInvariantIds,
	getCoreRoleProtocol,
} from "../../core/protocols";
import {
	FLOW_AUTHORITATIVE_TOOL_JSON_RULE,
	FLOW_HANDOFF_MODE_PROGRESS_RULE,
	FLOW_NEVER_WRITE_FLOW_FILES_RULE,
} from "../fragments";
import { type FlowPromptMode, getFlowModeContract } from "../mode-contracts";

function listLines(items: readonly string[]): string {
	return items.map((item) => `- ${item}`).join("\n");
}

function backtickList(items: readonly string[]): string {
	return items.map((item) => `\`${item}\``).join(", ");
}

function renderModeOutcome(mode: FlowPromptMode): string {
	switch (mode) {
		case "flow-plan":
			return "Convert the user goal into a grounded draft, selection, approval, or handoff without starting implementation.";
		case "flow-auto":
			return "Drive the active session to completion, a real blocker, or a human decision gate through runtime-owned planning, execution, review, and recovery.";
		case "flow-run":
			return "Complete exactly one approved feature or report that no feature can run, with runtime-owned validation and review evidence.";
		case "flow-worker":
			return "Execute the active feature only, then return or persist a clean worker result or a true blocker.";
		case "flow-planning-researcher":
			return "Produce a compact read-only planning evidence packet for planner or auto handoff.";
		case "flow-reviewer":
			return "Decide whether current feature or final completion evidence is approved, needs same-feature repair, or is blocked.";
		case "flow-control":
			return "Render the requested status, doctor, history, session, or reset result without advancing workflow work.";
		case "flow-review":
			return "Produce a read-only audit report with calibrated depth and explicit coverage evidence.";
	}
}

function renderEvidenceBudget(mode: FlowPromptMode): string {
	switch (mode) {
		case "flow-plan":
			return "Evidence budget: gather only enough repo/package/stack/standards evidence to justify the plan and decisions; use available/authorized external lookup only when current or official guidance materially affects the plan, and treat missing evidence as an explicit gap rather than proof of absence.";
		case "flow-auto":
			return "Evidence budget: use the runtime summary and active feature context first; retrieve more only when needed for the current planning, execution, validation, review, or recovery decision, and stop searching once the next safe runtime action is justified.";
		case "flow-run":
		case "flow-worker":
			return "Evidence budget: inspect the active feature, changed files, connected context, and validation outputs enough to support the worker result; do not broaden into unrelated repo archaeology unless a concrete dependency or review risk requires it.";
		case "flow-planning-researcher":
			return "Evidence budget: stay read-only, cite concrete repo or supplied sources, use available/authorized external lookup only for material current/official context, and report unresolved gaps instead of inventing findings.";
		case "flow-reviewer":
			return "Evidence budget: review changed evidence, connected context, validation records, and applicable risk classes until approval or blocking findings are supportable; absence of evidence is a gap, not proof that behavior is safe.";
		case "flow-control":
			return "Evidence budget: the matching runtime tool result is sufficient unless the user explicitly requested detailed/raw output.";
		case "flow-review":
			return "Evidence budget: map enough surfaces to support the requested audit depth, downgrade unsupported depth claims, and stop once findings and coverage limits are evidence-backed.";
	}
}

function renderValidationExpectation(mode: FlowPromptMode): string {
	switch (mode) {
		case "flow-plan":
			return "Validation expectation: sanity-check that the plan is evidence-grounded, scoped, and includes verification signals; do not claim implementation or test success from planning evidence.";
		case "flow-auto":
			return "Validation expectation: use targeted validation for feature work, broad validation on the final completion path, and a next-best check plus explicit gap when validation cannot run.";
		case "flow-run":
		case "flow-worker":
			return "Validation expectation: run targeted validation before success claims, use lint/typecheck/build/smoke checks when relevant, and record the next-best check plus limitation when a validation command cannot run.";
		case "flow-planning-researcher":
			return "Validation expectation: verify that each recommendation is traceable to supplied or repo evidence and label assumptions or unknowns.";
		case "flow-reviewer":
			return "Validation expectation: verify claims against changed artifacts, validation evidence, and required review scope; request fixes for missing or weak validation instead of approving by assumption.";
		case "flow-control":
			return "Validation expectation: confirm the requested runtime/control operation result was rendered; do not infer workflow progress beyond the tool output.";
		case "flow-review":
			return "Validation expectation: align findings and achieved depth with reviewed surfaces and renderer output; report gaps instead of overstating coverage.";
	}
}

function renderFinalAnswerShape(mode: FlowPromptMode): string {
	switch (mode) {
		case "flow-plan":
			return "Final answer shape: outcome, key constraints/evidence, plan status, and the next approval or execution step.";
		case "flow-auto":
			return "Final answer shape: current runtime outcome, evidence or blocker, validation/review status, and the exact next command or decision needed.";
		case "flow-run":
		case "flow-worker":
			return "Final answer shape: changed files, validation evidence or gap, review result, and runtime next step.";
		case "flow-planning-researcher":
			return "Final answer shape: the compact JSON research packet only, including evidence, recommended plan shape, gaps, and handoff notes.";
		case "flow-reviewer":
			return "Final answer shape: the reviewer decision only, with concrete evidence, blocking findings, and suggested validation when needed.";
		case "flow-control":
			return "Final answer shape: action/result first, blocker if any, then guidance.nextStep or the valid command form.";
		case "flow-review":
			return "Final answer shape: the rendered audit report with findings, coverage, achieved depth, and limits.";
	}
}

function renderOutcomeFirstFrame(mode: FlowPromptMode): string[] {
	return [
		`- Outcome: ${renderModeOutcome(mode)}`,
		`- Success before stopping: ${getFlowModeContract(mode).stopCondition}`,
		`- ${renderEvidenceBudget(mode)}`,
		`- ${renderValidationExpectation(mode)}`,
		"- Progress style: for multi-step or tool-heavy work, send one brief visible update naming the target result and first step, then report only meaningful phase changes, evidence, blockers, or final outcome.",
		...(mode === "flow-auto" ? [FLOW_HANDOFF_MODE_PROGRESS_RULE] : []),
		`- ${renderFinalAnswerShape(mode)}`,
	];
}

export function renderGeneratedSourceNote(protocol: CoreRoleProtocol): string {
	const sources = [
		"src/core/protocols/roles.ts",
		"src/core/registry/actions.ts",
		"src/prompts/mode-contracts.ts",
	];
	return `Generated protocol view. Source data: ${sources.map((source) => `\`${source}\``).join(", ")}. Mode contracts remain authoritative as data${
		protocol.modeContract ? ` for \`${protocol.modeContract}\`` : ""
	}.`;
}

export function renderProtocolHeader(
	roleId: CoreRoleProtocolId,
	modeOverride?: FlowPromptMode,
): string {
	const protocol = getCoreRoleProtocol(roleId);
	return [
		renderGeneratedSourceNote(protocol),
		renderModeContractProtocol(protocol, modeOverride),
		renderCoreActionProtocol(protocol),
		renderInvariantProtocol(protocol),
		renderRoleBoundaryProtocol(protocol),
	].join("\n\n");
}

export function renderModeContractProtocol(
	protocol: CoreRoleProtocol,
	modeOverride?: FlowPromptMode,
): string {
	const mode =
		modeOverride ?? (protocol.modeContract as FlowPromptMode | undefined);
	if (!mode) {
		return "Mode contract: none.";
	}
	const contract = getFlowModeContract(mode);
	return [
		`Mode contract: \`${contract.mode}\` — ${contract.title}.`,
		`Runtime mutation: \`${contract.runtimeMutation}\`; repository mutation: \`${contract.repositoryMutation}\`.`,
		contract.allowedFlowTools.length > 0
			? `Allowed Flow tools: ${backtickList(contract.allowedFlowTools)}.`
			: "Allowed Flow tools: none.",
		contract.forbiddenFlowTools.length > 0
			? `Forbidden Flow tools: ${backtickList(contract.forbiddenFlowTools)}.`
			: "Forbidden Flow tools: none.",
		"Required behavior from mode contract:",
		listLines(contract.requiredBehavior),
		`Stop condition: ${contract.stopCondition}`,
	].join("\n");
}

export function renderCoreActionProtocol(protocol: CoreRoleProtocol): string {
	const actions = getCoreRoleActions(protocol);
	if (actions.length === 0) {
		return "Core actions: none; this role renders or reviews without mutating workflow state.";
	}
	return [
		"Core action protocol:",
		...actions.map((action) =>
			[
				`- \`${action.name}\`: ${action.description}`,
				`  - emits: ${backtickList(action.emits)}`,
				`  - invariants: ${backtickList(action.invariantIds)}`,
			].join("\n"),
		),
	].join("\n");
}

export function renderRoleBoundaryProtocol(protocol: CoreRoleProtocol): string {
	return ["Role boundaries:", listLines(protocol.boundaryRules)].join("\n");
}

export function renderFallbackContract(
	mode: FlowPromptMode,
	toolOrdering: string,
): string {
	const contract = getFlowModeContract(mode);
	return [
		`Fallback contract for \`${mode}\` — ${contract.title}:`,
		...renderOutcomeFirstFrame(mode),
		`- Runtime mutation: \`${contract.runtimeMutation}\`; repository mutation: \`${contract.repositoryMutation}\`.`,
		contract.allowedFlowTools.length > 0
			? `- Allowed Flow tools: ${backtickList(contract.allowedFlowTools)}.`
			: "- Allowed Flow tools: none.",
		contract.forbiddenFlowTools.length > 0
			? `- Forbidden Flow tools: ${backtickList(contract.forbiddenFlowTools)}.`
			: "- Forbidden Flow tools: none.",
		FLOW_NEVER_WRITE_FLOW_FILES_RULE,
		FLOW_AUTHORITATIVE_TOOL_JSON_RULE,
		`- Tool ordering: ${toolOrdering}`,
		`- Stop condition: ${contract.stopCondition}`,
		"- If a referenced Flow skill is unavailable or denied by OpenCode permissions, continue with this fallback contract; do not weaken `permission.skill` or edit `.flow/**` to compensate.",
	].join("\n");
}

export function renderSkillShim(
	skillName: "flow-plan" | "flow-run" | "flow-review",
	surface: "agent prompt" | "command template",
): string {
	return [
		`Use the generated \`${skillName}\` OpenCode skill for detailed workflow guidance when the native \`skill\` tool can load it.`,
		`This ${surface} is a fallback surface: public ${
			surface === "agent prompt" ? "agent" : "slash-command"
		} names remain usable without installed skills, while runtime tools and mode contracts remain authoritative.`,
	].join("\n");
}

export function renderAutoSkillReferences(fallbackTarget: string): string {
	return [
		"No `flow-auto` skill is generated yet.",
		"Use generated `flow-plan`, `flow-run`, and `flow-review` skills as on-demand guidance for delegated planning, execution, and review details when available.",
		"Keep `flow-planning-researcher` available as the fallback read-only research agent for review-first planning evidence.",
		`Otherwise ${fallbackTarget}.`,
	].join(" ");
}

export function renderInvariantProtocol(protocol: CoreRoleProtocol): string {
	const ids = getCoreRoleInvariantIds(protocol);
	if (ids.length === 0) {
		return "Referenced semantic invariants: none; read-only audit coverage is governed by the audit ledger contract.";
	}
	return `Referenced semantic invariants: ${backtickList(ids)}.`;
}
