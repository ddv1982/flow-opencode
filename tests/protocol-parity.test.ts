import { describe, expect, test } from "bun:test";
import {
	FLOW_AUTO_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_WORKER_AGENT_PROMPT,
} from "../src/prompts/agents";
import {
	FLOW_AUTO_COMMAND_TEMPLATE,
	FLOW_RUN_COMMAND_TEMPLATE,
} from "../src/prompts/commands";
import {
	CANONICAL_RUNTIME_TOOL_NAMES,
	type CanonicalRuntimeToolName,
} from "../src/runtime/constants";
import type { CompletionRecoveryKind } from "../src/runtime/transitions/recovery";
import { buildCompletionRecovery } from "../src/runtime/transitions/recovery";
import { createTools } from "../src/tools";

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

	test("prompts and command templates stay canonical-only", () => {
		for (const surface of PROMPT_SURFACES) {
			expect(surface).not.toContain("_from_raw");
			expect(surface).not.toContain("deprecated raw-wrapper tools");
		}

		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_run_complete_feature");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_feature");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_final");
		expect(FLOW_AUTO_AGENT_PROMPT).toContain("flow_run_complete_feature");
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain("flow_run_complete_feature");
	});

	test("recovery guidance emits canonical runtime tools only", () => {
		const allKinds: CompletionRecoveryKind[] = [
			"missing_validation",
			"failing_validation",
			"missing_reviewer_decision",
			"missing_validation_scope",
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
