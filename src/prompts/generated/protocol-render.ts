import {
	type CoreRoleProtocol,
	type CoreRoleProtocolId,
	getCoreRoleProtocol,
} from "../../core/protocols";
import {
	FLOW_AUTHORITATIVE_TOOL_JSON_RULE,
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

function renderGeneratedSourceNote(protocol: CoreRoleProtocol): string {
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
	const mode =
		modeOverride ?? (protocol.modeContract as FlowPromptMode | undefined);
	return [
		renderGeneratedSourceNote(protocol),
		`Role boundary: ${protocol.title}. ${protocol.objective}`,
		mode ? renderModeContractSummary(mode) : "Mode contract: none.",
		renderRoleBoundaryProtocol(protocol),
	].join("\n\n");
}

function renderModeContractSummary(mode: FlowPromptMode): string {
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
		`Stop condition: ${contract.stopCondition}`,
	].join("\n");
}

function renderRoleBoundaryProtocol(protocol: CoreRoleProtocol): string {
	return ["Role boundaries:", listLines(protocol.boundaryRules)].join("\n");
}

export function renderFallbackContract(
	mode: FlowPromptMode,
	toolOrdering: string,
): string {
	const contract = getFlowModeContract(mode);
	return [
		`Fallback contract for \`${mode}\` — ${contract.title}:`,
		`- Outcome: ${renderModeOutcome(mode)}`,
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
		"- If a referenced Flow skill is unavailable or denied by OpenCode permissions, continue with this compact fallback contract; do not weaken `permission.skill` or edit `.flow/**` to compensate.",
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
