import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTools } from "../src/adapters/opencode/tools";
import { CORE_ROLE_PROTOCOLS } from "../src/core/protocols";
import { CORE_ACTION_REGISTRY } from "../src/core/registry";
import {
	FLOW_AUTO_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_WORKER_AGENT_PROMPT,
} from "../src/prompts/agents";
import {
	FLOW_AUTO_COMMAND_TEMPLATE,
	FLOW_RUN_COMMAND_TEMPLATE,
} from "../src/prompts/commands";
import { FLOW_CONTRACT_INVARIANT_IDS } from "../src/prompts/contracts";
import { FLOW_FRAGMENT_INVARIANT_IDS } from "../src/prompts/fragments";
import {
	CANONICAL_RUNTIME_TOOL_NAMES,
	type CanonicalRuntimeToolName,
} from "../src/runtime/constants";
import type { CompletionRecoveryKind } from "../src/runtime/transitions/recovery";
import { buildCompletionRecovery } from "../src/runtime/transitions/recovery";
import {
	expectDistinctIds,
	expectKnownInvariantIds,
} from "./cross-area/semantic-parity-helpers";

const PROMPT_SURFACES = [
	FLOW_WORKER_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_AUTO_AGENT_PROMPT,
	FLOW_RUN_COMMAND_TEMPLATE,
	FLOW_AUTO_COMMAND_TEMPLATE,
];

describe("protocol parity", () => {
	test("public tool surface stays canonical-only", () => {
		const tools = createTools({});
		const toolNames = Object.keys(tools);

		for (const toolName of CANONICAL_RUNTIME_TOOL_NAMES) {
			expect(toolNames).toContain(toolName);
		}

		expect(toolNames.some((name) => name.includes("_from_raw"))).toBe(false);
	});

	test("prompt fallback surfaces stay canonical-only and expose runtime boundaries", () => {
		for (const surface of PROMPT_SURFACES) {
			expect(surface).not.toContain("_from_raw");
			expect(surface).not.toContain("JSON-string transport tools");
			expect(surface.toLowerCase()).toContain("runtime");
		}

		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_run_complete_feature");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_feature");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_final");
		expect(FLOW_AUTO_AGENT_PROMPT).toContain("flow_run_complete_feature");
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain("flow_run_complete_feature");
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain(
			"generated `flow-run` OpenCode skill",
		);
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain("flow-auto");
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain("flow-plan");
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain("flow-run");
	});

	test("prompt fallback surfaces preserve reviewer-persistence, final-path, and recovery/replan contracts through tools and schemas", () => {
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_feature");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_final");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain(
			"finalReview on final completion",
		);
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("broad validation");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("strictReview governance");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("true blocker");
		expect(FLOW_AUTO_AGENT_PROMPT).toContain("flow_reset_feature");
		expect(FLOW_AUTO_AGENT_PROMPT).toContain("real blocker");
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain(
			"finalReview on final completion",
		);
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain("broad validation");
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain(
			"broad validation plus finalReview",
		);
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain(
			"persist reviewer decisions only for review/review_and_fix/strictReview governance",
		);
	});

	test("prompt expression invariant references stay known and distinct", () => {
		const allIds = [
			...FLOW_CONTRACT_INVARIANT_IDS,
			...FLOW_FRAGMENT_INVARIANT_IDS,
		];
		expectKnownInvariantIds(allIds);
		expectDistinctIds(FLOW_CONTRACT_INVARIANT_IDS);
		expectDistinctIds(FLOW_FRAGMENT_INVARIANT_IDS);
	});

	test("contracts and fragments cover the expected semantic invariants", () => {
		expect(FLOW_CONTRACT_INVARIANT_IDS).toEqual([
			"completion.gates.required_order",
			"completion.policy.min_completed_features",
			"review.scope.payload_binding",
		]);
		expect(FLOW_FRAGMENT_INVARIANT_IDS).toEqual([
			"completion.policy.min_completed_features",
			"decision_gate.planning_surface.binding",
			"recovery.next_action.binding",
			"tools.canonical_surface.no_raw_wrappers",
		]);
	});

	test("role prompts are generated from protocol and mode-contract data", () => {
		const agentsEntry = readFileSync(
			new URL("../src/prompts/agents.ts", import.meta.url),
			"utf8",
		);
		const commandsEntry = readFileSync(
			new URL("../src/prompts/commands.ts", import.meta.url),
			"utf8",
		);

		expect(agentsEntry).toContain("./generated/role-prompts");
		expect(commandsEntry).toContain("./generated/command-templates");
		expect(agentsEntry).not.toContain("renderPromptSections([");
		expect(commandsEntry).not.toContain("renderPromptSections([");

		for (const protocol of CORE_ROLE_PROTOCOLS) {
			for (const actionName of protocol.ownedActions) {
				expect(CORE_ACTION_REGISTRY.map((action) => action.name)).toContain(
					actionName,
				);
			}
		}

		expect(FLOW_WORKER_AGENT_PROMPT).toContain(
			"Generated protocol view. Source data:",
		);
		expect(FLOW_WORKER_AGENT_PROMPT).toContain(
			"Fallback contract for `flow-worker`",
		);
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("Allowed Flow tools:");
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain(
			"Fallback contract for `flow-auto`",
		);
	});

	test("recovery guidance emits canonical runtime tools only", () => {
		const allKinds: CompletionRecoveryKind[] = [
			"missing_validation",
			"failing_validation",
			"missing_reviewer_decision",
			"missing_validation_scope",
			"missing_review_closure",
			"missing_review_scope_accounting",
			"missing_final_reviewer_review_scope_accounting",
			"failing_feature_review",
			"missing_final_review",
			"failing_final_review",
		];

		for (const kind of allKinds) {
			for (const isFinalPath of [false, true] as const) {
				const recovery = buildCompletionRecovery(
					"setup-runtime",
					isFinalPath,
					kind,
				);

				if (recovery.nextRuntimeTool) {
					expect(CANONICAL_RUNTIME_TOOL_NAMES).toContain(
						recovery.nextRuntimeTool as CanonicalRuntimeToolName,
					);
					expect(recovery.nextRuntimeTool).not.toContain("_from_raw");
				}
			}
		}
	});
});
