import {
	type CoreRoleProtocol,
	getCoreRoleActions,
	getCoreRoleInvariantIds,
} from "../../core/protocols";
import { type FlowPromptMode, getFlowModeContract } from "../mode-contracts";

function listLines(items: readonly string[]): string {
	return items.map((item) => `- ${item}`).join("\n");
}

function backtickList(items: readonly string[]): string {
	return items.map((item) => `\`${item}\``).join(", ");
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

export function renderWorkflowProtocol(protocol: CoreRoleProtocol): string {
	return ["Protocol workflow:", listLines(protocol.workflow)].join("\n");
}

export function renderInvariantProtocol(protocol: CoreRoleProtocol): string {
	const ids = getCoreRoleInvariantIds(protocol);
	if (ids.length === 0) {
		return "Referenced semantic invariants: none; read-only audit coverage is governed by the audit ledger contract.";
	}
	return `Referenced semantic invariants: ${backtickList(ids)}.`;
}
