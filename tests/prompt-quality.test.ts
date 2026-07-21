import { describe, expect, test } from "bun:test";
import {
	FLOW_GUIDANCE_IDS,
	FLOW_GUIDANCE_TOPICS,
	getFlowGuidance,
} from "../src/guidance/catalog.js";
import {
	compileFlowPromptSurface,
	type FlowPromptSurfaceName,
} from "../src/prompt-surfaces.js";

const MANAGER_GUIDANCE = [
	["flow-auto", "flow"],
	["flow-plan", "flow-plan"],
	["flow-run", "flow-run"],
] as const;

function body(markdown: string): string {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

describe("production Flow prompts", () => {
	test("compiles seven runtime surfaces from four canonical guides", () => {
		expect(FLOW_GUIDANCE_TOPICS).toEqual([
			"flow",
			"flow-plan",
			"flow-run",
			"flow-review",
		]);
		expect(FLOW_GUIDANCE_IDS).toEqual(FLOW_GUIDANCE_TOPICS);
		for (const id of FLOW_GUIDANCE_IDS) {
			expect(getFlowGuidance(id).content).toStartWith("---\n");
			expect(body(getFlowGuidance(id).content).length).toBeGreaterThan(200);
		}
		for (const [surface, guidance] of MANAGER_GUIDANCE) {
			const prompt = compileFlowPromptSurface(surface);
			expect(prompt).toStartWith(body(getFlowGuidance(guidance).content));
			expect(prompt).toContain('flow_status { request: { view: "compact" } }');
		}
		for (const surface of [
			"flow-review",
			"flow-status",
			"flow-reviewer",
			"flow-worker",
		] as const) {
			expect(compileFlowPromptSurface(surface).trim().length).toBeGreaterThan(
				40,
			);
		}
		const auto = compileFlowPromptSurface("flow-auto");
		expect(auto).toContain('flow_guidance { id: "flow-plan" }');
		expect(auto).toContain('flow_guidance { id: "flow-run" }');
		expect(auto).toMatch(
			/stop after\s+planning when the user asked for a plan only/i,
		);
		expect(() =>
			compileFlowPromptSurface("unknown" as FlowPromptSurfaceName),
		).toThrow("Unsupported Flow prompt surface");
	});

	test("keeps approval, bounded waves, validation, and review in one run contract", () => {
		const plan = compileFlowPromptSurface("flow-plan");
		expect(plan).toMatch(
			/flow_plan_save[\s\S]+flow_plan_approve[\s\S]+only after explicit approval[\s\S]+do not begin implementation/i,
		);

		const run = compileFlowPromptSurface("flow-run");
		expect(run).toMatch(
			/serially by default[\s\S]+two or three\s+`flow-worker`/i,
		);
		expect(run).toMatch(
			/same\s+assistant tool-use turn[\s\S]+report that execution as serial/i,
		);
		expect(run).toMatch(
			/at most one targeted follow-up wave[\s\S]+no manifest, sidecar, Session field/i,
		);
		expect(run).toMatch(
			/after all workers stop[\s\S]+before validation[\s\S]+flow_validation_start/i,
		);
		expect(run).toMatch(
			/flow_review_start[\s\S]+reserved `flow-reviewer`[\s\S]+flow_feature_complete/i,
		);
		expect(run).toMatch(/failed review[\s\S]+full validation and full review/i);
	});

	test("keeps reviewer and worker roles narrow and structured", () => {
		const command = compileFlowPromptSurface("flow-review");
		const reviewer = compileFlowPromptSurface("flow-reviewer");
		expect(command).toMatch(/reserved `flow-reviewer`[\s\S]+read-only/);
		expect(reviewer).toMatch(/must not edit files[\s\S]+state-changing/i);
		expect(reviewer).toMatch(/flow_status[\s\S]+Every blocker must cite/i);
		expect(
			JSON.parse(reviewer.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "null"),
		).toMatchObject({
			assignmentId: expect.any(String),
			verdict: "passed",
			findings: [],
			terminalDisposition: "submitted",
		});

		const worker = compileFlowPromptSurface("flow-worker");
		expect(worker).toMatch(
			/single slice[\s\S]+exact, non-overlapping write paths/i,
		);
		expect(worker).toMatch(
			/do not delegate[\s\S]+do not stage, commit, push, publish/i,
		);
		expect(worker).toMatch(/do not run Bash[\s\S]+\.flow or \.git metadata/i);
		expect(worker).toMatch(/authoritative combined validation/i);
		expect(worker).toMatch(/recommended manager checks/i);
	});
});
