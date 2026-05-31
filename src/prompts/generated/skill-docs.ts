import { createHash } from "node:crypto";
import {
	getOpenCodeToolRegistryEntry,
	openCodeToolDescription,
} from "../../adapters/opencode/tool-surface/tool-registry";
import {
	type CoreRoleProtocol,
	getCoreRoleProtocol,
} from "../../core/protocols/roles";
import { FLOW_MODE_CONTRACTS, type FlowModeContract } from "../mode-contracts";
import { FLOW_SKILL_SPECS, type FlowSkillSpec } from "../skills";

export type { FlowSkillSpec };
export { FLOW_SKILL_SPECS };

export const FLOW_SKILL_GENERATED_MARKER = "flow-opencode-generated-skill";
export const FLOW_SKILL_GENERATED_VERSION = "1";

type FlowSkillGeneratedMarker = {
	name: string;
	version: string;
	hash: string;
};

type FlowSkillDocumentInspection =
	| { kind: "not_generated" }
	| { kind: "valid_generated"; marker: FlowSkillGeneratedMarker }
	| { kind: "invalid_generated"; reason: string };

const FLOW_SKILL_GENERATED_MARKER_PREFIX = `<!-- ${FLOW_SKILL_GENERATED_MARKER} `;
const FLOW_SKILL_GENERATED_MARKER_PATTERN = new RegExp(
	`^<!-- ${FLOW_SKILL_GENERATED_MARKER} name=([a-z0-9]+(?:-[a-z0-9]+)*) version=([0-9]+) hash=sha256:([a-f0-9]{64}) -->$`,
	"u",
);

export function renderFlowSkillDocument(skill: FlowSkillSpec): string {
	const frontmatter = renderSkillFrontmatter(skill);
	const body = renderSkillBody(skill);
	const managedPayload = `${frontmatter}${body}`;
	const hash = sha256(managedPayload);
	return `${frontmatter}<!-- ${FLOW_SKILL_GENERATED_MARKER} name=${skill.name} version=${FLOW_SKILL_GENERATED_VERSION} hash=sha256:${hash} -->\n${body}`;
}

export function inspectFlowSkillDocument(
	document: string,
): FlowSkillDocumentInspection {
	const lines = document.split("\n");
	const markerIndexes = lines.flatMap((line, index) =>
		line.startsWith(FLOW_SKILL_GENERATED_MARKER_PREFIX) ? [index] : [],
	);
	if (markerIndexes.length === 0) {
		return { kind: "not_generated" };
	}
	if (markerIndexes.length > 1) {
		return { kind: "invalid_generated", reason: "duplicate_marker" };
	}

	const markerIndex = markerIndexes[0];
	if (markerIndex === undefined) {
		return { kind: "not_generated" };
	}
	const markerLine = lines[markerIndex];
	if (markerLine === undefined) {
		return { kind: "invalid_generated", reason: "malformed_marker" };
	}
	const match = markerLine.match(FLOW_SKILL_GENERATED_MARKER_PATTERN);
	if (!match) {
		return { kind: "invalid_generated", reason: "malformed_marker" };
	}

	const [, name, version, hash] = match;
	if (name === undefined || version === undefined || hash === undefined) {
		return { kind: "invalid_generated", reason: "malformed_marker" };
	}
	const managedPayload = [
		...lines.slice(0, markerIndex),
		...lines.slice(markerIndex + 1),
	].join("\n");
	if (sha256(managedPayload) !== hash) {
		return { kind: "invalid_generated", reason: "hash_mismatch" };
	}

	return {
		kind: "valid_generated",
		marker: { name, version, hash },
	};
}

function renderSkillFrontmatter(skill: FlowSkillSpec): string {
	return [
		"---",
		`name: ${skill.name}`,
		`description: ${JSON.stringify(skill.description)}`,
		"license: MIT",
		"host: opencode",
		"metadata:",
		'  flow-owned: "true"',
		`  flow-skill-version: "${FLOW_SKILL_GENERATED_VERSION}"`,
		`  flow-mode-contracts: "${skill.modeContracts.join(",")}"`,
		"---",
		"",
	].join("\n");
}

function renderSkillBody(skill: FlowSkillSpec): string {
	const contracts = skill.modeContracts.map(
		(mode) => FLOW_MODE_CONTRACTS[mode],
	);
	const protocols = skill.roleProtocols.map((role) =>
		getCoreRoleProtocol(role),
	);
	return [
		`# ${skill.title}`,
		"",
		`Purpose: ${skill.purpose}`,
		"",
		"## Outcome, evidence, and validation",
		...renderSkillOutcomeGuidance(skill),
		"",
		"## Authority boundary",
		"- Runtime tools are authoritative; this skill is an on-demand instruction surface only.",
		"- Do not edit `.flow/**` directly; Flow runtime state, completion, review, and persistence remain runtime-owned.",
		"- This skill does not define new tools, state transitions, completion gates, persistence paths, or review semantics.",
		"- The global/npm OpenCode plugin remains the primary runtime install; these global skill files are optional reference guidance.",
		"",
		"## OpenCode discovery and permissions",
		`- OpenCode discovers this global file at \`~/.config/opencode/skills/${skill.name}/SKILL.md\` when the native \`skill\` tool is available.`,
		"- Keep user-controlled permissions intact. `permission.skill` may allow or ask for `flow-*`; `deny` intentionally hides generated Flow skills from agents.",
		"- Do not weaken deny/ask posture just to load this skill.",
		"",
		"## Mode contracts",
		...contracts.flatMap(renderModeContract),
		"",
		"## Role protocols",
		...protocols.flatMap(renderRoleProtocol),
		"",
		"## Operator checklist",
		...skill.operatorGuidance.map((item) => `- ${item}`),
		"",
		"## Tool reference",
		...renderToolReference(contracts),
		"",
	].join("\n");
}

function renderSkillOutcomeGuidance(skill: FlowSkillSpec): string[] {
	switch (skill.name) {
		case "flow-plan":
			return [
				"- Outcome: a grounded plan draft, selection, approval, or handoff; no implementation starts here.",
				"- Evidence budget: collect enough repo/package/stack/standards context to justify plan shape, risk, and validation signals; use available/authorized external lookup only when current or official evidence materially changes the plan.",
				"- Validation: sanity-check scope, constraints, and verification signals; preserve unresolved questions as planning gaps.",
				"- Final response: outcome first, then key evidence/gaps, plan status, and next approval or execution step.",
			];
		case "flow-run":
			return [
				"- Outcome: one approved feature completed, blocked, or returned for replan with runtime-owned evidence.",
				"- Evidence budget: inspect the active feature, changed files, connected context, and validation output needed for the worker result; avoid unrelated repo archaeology.",
				"- Validation: run targeted checks before success, broader checks on final completion paths, and record next-best checks plus gaps when commands cannot run.",
				"- Final response: changed files, validation evidence or gap, review result, and runtime next step.",
			];
		case "flow-review":
			return [
				"- Outcome: a read-only reviewer decision or audit report whose depth matches actual evidence.",
				"- Evidence budget: review changed evidence, connected context, validation records, and applicable risk classes until approval or findings are supportable; use available/authorized lookup only for material current/official context.",
				"- Validation: treat missing evidence or weak validation as a review gap, not proof of safety; downgrade unsupported audit depth.",
				"- Final response: decision/report first, then blocking findings, coverage limits, and suggested validation when needed.",
			];
	}
}

function renderModeContract(contract: FlowModeContract): string[] {
	return [
		`### ${contract.mode} — ${contract.title}`,
		`- Runtime mutation: ${contract.runtimeMutation}`,
		`- Repository mutation: ${contract.repositoryMutation}`,
		`- Allowed Flow tools: ${renderInlineCodeList(contract.allowedFlowTools)}`,
		`- Forbidden Flow tools: ${renderInlineCodeList(contract.forbiddenFlowTools)}`,
		"- Required behavior:",
		...contract.requiredBehavior.map((item) => `  - ${item}`),
		`- Stop condition: ${contract.stopCondition}`,
	];
}

function renderRoleProtocol(protocol: CoreRoleProtocol): string[] {
	return [
		`### ${protocol.title}`,
		`- Objective: ${protocol.objective}`,
		`- Output protocol: ${protocol.outputProtocol}`,
		"- Boundary rules:",
		...protocol.boundaryRules.map((item) => `  - ${item}`),
		"- Workflow:",
		...protocol.workflow.map((item) => `  - ${item}`),
	];
}

function renderToolReference(contracts: readonly FlowModeContract[]): string[] {
	const toolNames = [
		...new Set(contracts.flatMap((contract) => contract.allowedFlowTools)),
	];
	if (toolNames.length === 0) {
		return ["- No Flow runtime tools are allowed for this read-only surface."];
	}
	return toolNames.map((toolName) => {
		const entry = getOpenCodeToolRegistryEntry(toolName);
		const action =
			entry?.runtimeActionBinding.kind === "none"
				? "runtime binding: none"
				: entry
					? `runtime binding: ${entry.runtimeActionBinding.kind}`
					: "runtime binding: unknown";
		return `- \`${toolName}\` — ${openCodeToolDescription(toolName)} (${action}).`;
	});
}

function renderInlineCodeList(items: readonly string[]): string {
	return items.length > 0
		? items.map((item) => `\`${item}\``).join(", ")
		: "none";
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
