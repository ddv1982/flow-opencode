import { describe, expect, test } from "bun:test";
import {
	FLOW_GUIDANCE_DOCUMENTS,
	FLOW_GUIDANCE_IDS,
	FLOW_GUIDANCE_TOPICS,
	getFlowGuidance,
} from "../src/guidance/catalog.js";
import {
	compileFlowPromptSurface,
	type FlowPromptSurfaceName,
} from "../src/prompt-surfaces.js";

const SURFACES: readonly FlowPromptSurfaceName[] = [
	"flow-auto",
	"flow-plan",
	"flow-run",
	"flow-review",
	"flow-status",
	"flow-reviewer",
];

describe("production Flow prompts", () => {
	test("ships only the four core guidance contracts", () => {
		expect(FLOW_GUIDANCE_TOPICS).toEqual([
			"flow",
			"flow-plan",
			"flow-run",
			"flow-review",
		]);
		expect(FLOW_GUIDANCE_IDS).toEqual(FLOW_GUIDANCE_TOPICS);
		expect(FLOW_GUIDANCE_DOCUMENTS).toHaveLength(4);
		for (const id of FLOW_GUIDANCE_IDS) {
			expect(getFlowGuidance(id).content.length).toBeGreaterThan(200);
		}
	});

	test("assembles six direct runtime surfaces with no evaluator variants", () => {
		for (const surface of SURFACES) {
			expect(compileFlowPromptSurface(surface).trim().length).toBeGreaterThan(
				40,
			);
		}
		expect(() =>
			compileFlowPromptSurface("unknown" as FlowPromptSurfaceName),
		).toThrow("Unsupported Flow prompt surface");
	});

	test("keeps manager routing status-first", () => {
		for (const surface of ["flow-auto", "flow-plan", "flow-run"] as const) {
			const text = compileFlowPromptSurface(surface);
			expect(text).toContain('flow_status { request: { view: "compact" } }');
		}
		const auto = compileFlowPromptSurface("flow-auto");
		expect(auto).toContain('flow_guidance { id: "flow-plan" }');
		expect(auto).toContain('flow_guidance { id: "flow-run" }');
		expect(auto).toContain("Stop after");
		const plan = compileFlowPromptSurface("flow-plan");
		expect(plan).toContain("explicit approval");
		expect(plan).toContain(
			"Do not begin implementation during a plan-only request",
		);
	});

	test("records validation in-session and retries failed review in full", () => {
		const run = compileFlowPromptSurface("flow-run");
		expect(run).toContain("Flow records the host-observed result directly");
		expect(run).toMatch(
			/Flow selects current applicable validation\s+automatically/,
		);
		expect(run).toContain("repeat full validation and full review");
		expect(run).toContain("final feature");
		expect(run).toContain("records a blocked outcome");
		expect(run).toContain("reset the feature");
	});

	test("reserves independent review and denies reviewer mutation", () => {
		const command = compileFlowPromptSurface("flow-review");
		const reviewer = compileFlowPromptSurface("flow-reviewer");
		expect(command).toContain("reserved `flow-reviewer`");
		expect(command).toContain("independent and read-only");
		expect(reviewer).toContain("must not edit files,");
		expect(reviewer).toContain("state-changing `flow_*` tool");
		expect(reviewer).toContain("actual changed artifacts");
		expect(reviewer).toContain("Every blocker must cite");
		expect(reviewer).toContain("Return exactly one assignment result");
	});
});
