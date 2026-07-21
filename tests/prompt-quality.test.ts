import { describe, expect, test } from "bun:test";
import { FeatureCompleteInputSchema } from "../src/application/schema.js";
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

function section(markdown: string, heading: string): string {
	const start = markdown.indexOf(`## ${heading}`);
	expect(start).toBeGreaterThanOrEqual(0);
	const contentStart = markdown.indexOf("\n", start) + 1;
	const end = markdown.indexOf("\n## ", contentStart);
	return markdown.slice(contentStart, end < 0 ? undefined : end);
}

function expectBefore(text: string, before: string, after: string): void {
	const beforeIndex = text.indexOf(before);
	const afterIndex = text.indexOf(after);
	expect(beforeIndex).toBeGreaterThanOrEqual(0);
	expect(afterIndex).toBeGreaterThan(beforeIndex);
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
		] as const)
			expect(compileFlowPromptSurface(surface).trim().length).toBeGreaterThan(
				40,
			);

		const auto = compileFlowPromptSurface("flow-auto");
		expect(auto).toContain('flow_guidance { id: "flow-plan" }');
		expect(auto).toContain('flow_guidance { id: "flow-run" }');
		expect(() =>
			compileFlowPromptSurface("unknown" as FlowPromptSurfaceName),
		).toThrow("Unsupported Flow prompt surface");
	});

	test("cleans accepted archives before goal alignment on every manager entry", () => {
		const entries = [
			["flow-auto", "Route from status", false],
			["flow-plan", "Start", false],
			["flow-run", "Start and scope", true],
		] as const;
		for (const [surface, heading, stops] of entries) {
			const prompt = section(compileFlowPromptSurface(surface), heading);
			expect(prompt).toMatch(
				/archiveRetry[\s\S]+flow_session_close[\s\S]+byte-for-byte[\s\S]+grants no new work/i,
			);
			expectBefore(prompt, "archiveRetry", "align the compact-projected");
			if (stops)
				expect(prompt).toMatch(/stop after the[\s\S]+outcome either way/i);
			else
				expect(prompt).toMatch(
					/refresh compact status[\s\S]+refreshed projection/i,
				);
		}
	});

	test("uses one scope marker and bounds failed-review retries", () => {
		const run = section(
			compileFlowPromptSurface("flow-run"),
			"Review and record",
		);
		expect(run).toMatch(/\[scope-blocker\][\s\S]+checkpoints immediately/i);
		expect(run).toMatch(/first recorded[\s\S]+in-scope[\s\S]+one automatic/i);
		expect(run).toMatch(
			/second recorded[\s\S]+(?:failure|failed review)[\s\S]+explicit user direction/i,
		);
		expect(run).toMatch(
			/full[\s\S]+validation[\s\S]+full[\s\S]+review[\s\S]+one additional\s+attempt/i,
		);
		const auto = section(
			compileFlowPromptSurface("flow-auto"),
			"Route from status",
		);
		expect(auto).toMatch(
			/blocked outcome[\s\S]+loaded `flow-run` retry and checkpoint contract/i,
		);

		const reviewer = compileFlowPromptSurface("flow-reviewer");
		const markers = reviewer.match(/\[[a-z][a-z-]*\]/gi) ?? [];
		expect(new Set(markers)).toEqual(new Set(["[scope-blocker]"]));
		expect(reviewer).toMatch(
			/\[scope-blocker\][\s\S]+only when[\s\S]+material work outside the[\s\S]+approved plan/i,
		);
		expect(reviewer).toMatch(
			/ordinary in-scope blocking findings and advisory findings need no[\s\S]+tag[\s\S]+missing evidence is an ordinary, precise blocking finding/i,
		);
	});

	test("keeps plan, run, and delivery boundaries decision-complete", () => {
		const plan = compileFlowPromptSurface("flow-plan");
		expect(plan).toMatch(
			/observable outcome[\s\S]+bounded evidence[\s\S]+exact[\s\S]+plan-listed command byte-for-byte/i,
		);
		expect(plan).toMatch(
			/flow_plan_save[\s\S]+flow_plan_approve[\s\S]+explicit approval[\s\S]+do not begin implementation/i,
		);

		const run = compileFlowPromptSurface("flow-run");
		const runStart = section(run, "Start and scope");
		expect(runStart).toMatch(
			/status is `running`[\s\S]+nextAction` is `flow_feature_reset`[\s\S]+pending review is source-stale[\s\S]+call `flow_feature_reset`[\s\S]+do not redispatch/i,
		);
		expect(runStart).toMatch(
			/status is `running`[\s\S]+nextAction` is[\s\S]+`dispatch-flow-reviewer`[\s\S]+skip run start[\s\S]+existing pending assignment/i,
		);
		expect(run).toMatch(
			/serially by default[\s\S]+two or three genuinely independent[\s\S]+same[\s\S]+assistant tool-use turn[\s\S]+at most one targeted follow-up wave/i,
		);
		expect(run).toMatch(
			/known failed exact plan-listed gate[\s\S]+cannot be discharged by substitute broad validation[\s\S]+already accepted review is grandfathered/i,
		);
		expect(section(run, "Review and record")).toMatch(
			/redispatch[\s\S]+only while compact status is `running`[\s\S]+`dispatch-flow-reviewer`[\s\S]+status remains `running`[\s\S]+pending assignment[\s\S]+`flow_feature_reset`[\s\S]+do not redispatch[\s\S]+source-stale assignment/i,
		);

		const auto = compileFlowPromptSurface("flow-auto");
		expect(section(auto, "Recovery")).toMatch(
			/load `flow-run`[\s\S]+exact[\s\S]+review-recovery path/i,
		);
		expect(auto).toMatch(
			/workflowData\.delivery[\s\S]+attempt count[\s\S]+terminal findings[\s\S]+never describe them as an exact Git delta/i,
		);
		expect(auto).toMatch(/do not create reports[\s\S]+JSON is opt-in/i);
	});

	test("keeps reviewer and worker roles narrow and structured", () => {
		const command = compileFlowPromptSurface("flow-review");
		const reviewer = compileFlowPromptSurface("flow-reviewer");
		expect(command).toMatch(
			/reserved `flow-reviewer`[\s\S]+workspace-read-only[\s\S]+submit only its own result/i,
		);
		expect(reviewer).toMatch(
			/do not edit files[\s\S]+sole lifecycle mutation[\s\S]+assignment id, first call[\s\S]+flow_status/i,
		);
		expect(reviewer).toMatch(
			/workspace content changed[\s\S]+reset[\s\S]+do not recommend redispatch/i,
		);

		const example = JSON.parse(
			reviewer.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "null",
		);
		const parsedExample = FeatureCompleteInputSchema.parse(example);
		expect(parsedExample).toEqual(example);
		expect(parsedExample).toMatchObject({
			request: {
				operationId: expect.any(String),
				expectedRevision: expect.any(Number),
				featureId: expect.any(String),
				assignmentId: expect.any(String),
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "submitted",
				},
			},
		});

		const worker = compileFlowPromptSurface("flow-worker");
		expect(worker).toMatch(
			/single slice[\s\S]+do not run Bash[\s\S]+exact, non-overlapping write paths[\s\S]+authoritative combined validation/i,
		);
	});
});
