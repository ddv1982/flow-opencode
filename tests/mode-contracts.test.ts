import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OPENCODE_TOOL_REGISTRY } from "../src/adapters/opencode/tool-surface/tool-registry";
import { createCoreTools } from "../src/adapters/opencode/tools";
import { createFlowAuditConfigEntries } from "../src/audit/config";
import { createFlowCoreConfigEntries } from "../src/config";
import {
	FLOW_READ_ONLY_PERMISSION,
	FLOW_REASONING,
} from "../src/config-shared";
import {
	FLOW_MODE_CONTRACTS,
	FLOW_PROMPT_MODE_CAPTURE_MODES,
	FLOW_PROMPT_MODE_ORDER,
	type FlowPromptMode,
	getFlowModeContract,
} from "../src/prompts/mode-contracts";
import { isFirstPartySourcePath } from "./prompt-eval-helpers";

const EXPECTED_MODE_ORDER = [
	"flow-plan",
	"flow-auto",
	"flow-run",
	"flow-worker",
	"flow-planning-researcher",
	"flow-reviewer",
	"flow-control",
	"flow-review",
] as const satisfies readonly FlowPromptMode[];

const EXPECTED_COMMAND_AGENT_BINDINGS = {
	"flow-plan": "flow-planner",
	"flow-run": "flow-worker",
	"flow-auto": "flow-auto",
	"flow-review": "flow-auditor",
} as const;

describe("flow prompt mode contracts", () => {
	test("define every prompt mode once in stable order", () => {
		expect(FLOW_PROMPT_MODE_ORDER).toEqual(EXPECTED_MODE_ORDER);
		expect(Object.keys(FLOW_MODE_CONTRACTS)).toEqual([...EXPECTED_MODE_ORDER]);
		expect([...FLOW_PROMPT_MODE_CAPTURE_MODES]).toEqual(
			EXPECTED_MODE_ORDER.filter((mode) => mode !== "flow-review"),
		);

		for (const mode of FLOW_PROMPT_MODE_ORDER) {
			const contract = getFlowModeContract(mode);
			expect(contract.mode).toBe(mode);
			expect(contract.title.length).toBeGreaterThan(0);
			expect(contract.requiredBehavior.length).toBeGreaterThan(0);
			expect(contract.stopCondition.length).toBeGreaterThan(0);
		}

		expect(getFlowModeContract("flow-auto").requiredBehavior).toContain(
			"For each planning, execution, and review phase, report handoffMode as exactly task_subagent, inline_role, or not_supported before acting; do not treat derived task-progress rows as proof of an actual OpenCode Task/subagent handoff.",
		);
		expect(getFlowModeContract("flow-worker").requiredBehavior).toContain(
			"When requesting reviewer approval, distinguish handoffMode exactly as task_subagent for an actual flow-reviewer Task handoff, inline_role for inline approval fallback, or not_supported when Task is unavailable or denied.",
		);
		expect(getFlowModeContract("flow-reviewer").requiredBehavior).toContain(
			"Remain leaf-like: do not delegate further by default; return an evidence-backed decision.",
		);
	});

	test("source ownership paths are first-party files", () => {
		for (const mode of FLOW_PROMPT_MODE_ORDER) {
			const contract = getFlowModeContract(mode);
			expect(contract.sourcePaths).toContain("src/prompts/mode-contracts.ts");
			for (const sourcePath of contract.sourcePaths) {
				expect(isFirstPartySourcePath(sourcePath)).toBe(true);
				expect(existsSync(join(import.meta.dir, "..", sourcePath))).toBe(true);
			}
		}
	});

	test("read-only review surfaces forbid planning, execution, and session mutation tools", () => {
		for (const mode of ["flow-reviewer", "flow-review"] as const) {
			const contract = getFlowModeContract(mode);
			expect(contract.repositoryMutation).toBe("none");
			expect(contract.runtimeMutation).toBe("none");
			expect(contract.forbiddenFlowTools).toEqual(
				expect.arrayContaining([
					"flow_plan_apply",
					"flow_plan_approve",
					"flow_run_start",
					"flow_run_complete_feature",
					"flow_reset_feature",
					"flow_session_close",
				]),
			);
		}
	});

	test("allowed tool lists cover planned mode transition paths", () => {
		expect(getFlowModeContract("flow-plan").allowedFlowTools).toEqual(
			expect.arrayContaining([
				"flow_plan_start",
				"flow_plan_context_record",
				"flow_plan_apply",
				"flow_plan_approve",
				"flow_plan_select_features",
			]),
		);
		expect(getFlowModeContract("flow-auto").allowedFlowTools).toEqual(
			expect.arrayContaining([
				"flow_auto_prepare",
				"flow_review_record_feature",
				"flow_review_record_final",
				"flow_reset_feature",
			]),
		);
		expect(getFlowModeContract("flow-auto").allowedFlowTools).not.toContain(
			"flow_attachments_materialize",
		);
	});

	test("standalone audit renders reports without mutating Flow workflow state", () => {
		const controlContract = getFlowModeContract("flow-control");
		const contract = getFlowModeContract("flow-review");
		const renderTool = OPENCODE_TOOL_REGISTRY.find(
			(entry) => entry.toolName === "flow_review_render",
		);

		expect(controlContract.allowedFlowTools).not.toContain(
			"flow_review_render",
		);
		expect(controlContract.forbiddenFlowTools).toContain("flow_review_render");
		expect(contract.allowedFlowTools).toEqual(["flow_review_render"]);
		expect(renderTool?.allowedModes).toEqual(["flow-review"]);
		expect(contract.sourcePaths).toContain("src/audit/prompts/agents.ts");
		expect(contract.forbiddenFlowTools).toEqual(
			expect.arrayContaining([
				"flow_auto_prepare",
				"flow_plan_start",
				"flow_run_start",
				"flow_review_record_feature",
				"flow_review_record_final",
				"flow_session_activate",
			]),
		);
		expect(contract.requiredBehavior).toEqual(
			expect.arrayContaining([
				"Maintain discoveredSurfaces as the canonical coverage ledger.",
				"Downgrade achievedDepth when coverage does not support full_audit.",
			]),
		);
	});

	test("contract tool names stay aligned with registered tool surface", () => {
		const registeredToolNames = Object.keys(createCoreTools()).sort();
		const contractedToolNames = [
			...new Set(
				FLOW_PROMPT_MODE_ORDER.flatMap((mode) => {
					const contract = getFlowModeContract(mode);
					return [...contract.allowedFlowTools, ...contract.forbiddenFlowTools];
				}),
			),
		].sort();

		expect(contractedToolNames).toEqual(registeredToolNames);
		for (const mode of FLOW_PROMPT_MODE_ORDER) {
			const contract = getFlowModeContract(mode);
			for (const toolName of [
				...contract.allowedFlowTools,
				...contract.forbiddenFlowTools,
			]) {
				expect(registeredToolNames).toContain(toolName);
			}
		}
	});

	test("command and agent config bindings stay aligned with mode contracts", () => {
		const coreConfig = createFlowCoreConfigEntries();
		const auditConfig = createFlowAuditConfigEntries();
		const commands: Record<string, unknown> = {
			...coreConfig.command,
			...auditConfig.command,
		};
		const agents: Record<string, unknown> = {
			...coreConfig.agent,
			...auditConfig.agent,
		};

		for (const [commandName, agentName] of Object.entries(
			EXPECTED_COMMAND_AGENT_BINDINGS,
		)) {
			expect(commands[commandName]).toMatchObject({ agent: agentName });
		}

		for (const mode of FLOW_PROMPT_MODE_ORDER) {
			const contract = getFlowModeContract(mode);
			if (contract.surfaceKind === "command") {
				expect(commands[mode]).toBeDefined();
			} else {
				expect(agents[mode]).toBeDefined();
			}
		}

		for (const readOnlyAgentName of [
			"flow-planner",
			"flow-reviewer",
			"flow-control",
			"flow-auditor",
		] as const) {
			expect(agents[readOnlyAgentName]).toMatchObject({
				permission: FLOW_READ_ONLY_PERMISSION,
			});
			expect(agents[readOnlyAgentName]).not.toHaveProperty("tools");
		}

		const expectedReasoningEffort = {
			"flow-plan": FLOW_REASONING.deep,
			"flow-run": FLOW_REASONING.fast,
			"flow-auto": FLOW_REASONING.balanced,
			"flow-review": FLOW_REASONING.deep,
			"flow-planning-researcher": FLOW_REASONING.deep,
			"flow-worker": FLOW_REASONING.fast,
			"flow-reviewer": FLOW_REASONING.deep,
			"flow-control": FLOW_REASONING.fast,
		} as const;

		for (const mode of FLOW_PROMPT_MODE_ORDER) {
			const contract = getFlowModeContract(mode);
			const agentName =
				contract.surfaceKind === "command"
					? (commands[mode] as { agent?: string } | undefined)?.agent
					: mode;
			if (!agentName) {
				throw new Error(`Missing agent binding for ${mode}`);
			}
			expect(agents[agentName]).toMatchObject({
				reasoningEffort: expectedReasoningEffort[mode],
			});
			expect(agents[agentName]).not.toHaveProperty("model");
			expect(agents[agentName]).not.toHaveProperty("variant");
			expect(agents[agentName]).not.toHaveProperty("reasoning");
		}
	});

	test("fresh-context task handoff config stays narrow while read-only leaf agents deny task delegation", () => {
		const { agent } = createFlowCoreConfigEntries();

		expect(agent["flow-worker"]).toMatchObject({
			mode: "all",
			permission: {
				task: {
					"*": "deny",
					"flow-reviewer": "allow",
				},
			},
		});
		expect(agent["flow-auto"]).toMatchObject({
			mode: "primary",
			permission: {
				task: {
					"*": "deny",
					"flow-planning-researcher": "allow",
					"flow-planner": "allow",
					"flow-worker": "allow",
					"flow-reviewer": "allow",
				},
			},
		});
		expect(agent["flow-planning-researcher"]).toMatchObject({ mode: "all" });
		expect(agent["flow-planner"]).toMatchObject({ mode: "all" });
		expect(agent["flow-reviewer"]).toMatchObject({ mode: "all" });
		expect(agent["flow-control"]).toMatchObject({ mode: "primary" });
		expect(agent["flow-planner"]?.permission?.task).toEqual({
			"*": "deny",
			"flow-planning-researcher": "allow",
		});
		expect(agent["flow-planning-researcher"]?.permission?.task).toEqual({
			"*": "deny",
		});
		expect(agent["flow-reviewer"]?.permission?.task).toEqual({
			"*": "deny",
		});
		expect(agent["flow-control"]?.permission?.task).toEqual({
			"*": "deny",
		});

		const { agent: auditAgent } = createFlowAuditConfigEntries();
		expect(auditAgent["flow-auditor"]).toMatchObject({
			mode: "primary",
			permission: FLOW_READ_ONLY_PERMISSION,
			reasoningEffort: FLOW_REASONING.deep,
		});
		expect(auditAgent["flow-auditor"]).not.toHaveProperty("tools");
	});
});
