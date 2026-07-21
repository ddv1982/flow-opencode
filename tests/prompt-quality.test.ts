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
		expect(run).toMatch(
			/never copy or submit its\s+verdict[\s\S]+read compact status/i,
		);
		expect(run).toMatch(/scope: "broad"[\s\S]+canonical applicable gate/i);
		expect(run).toMatch(
			/failed review[\s\S]+full validation and full\s+review/i,
		);
		expect(run).toMatch(
			/workspace content changed[\s\S]+flow_feature_reset[\s\S]+do not redispatch/i,
		);
		const auto = compileFlowPromptSurface("flow-auto");
		expect(auto).toMatch(
			/workspace content changed[\s\S]+flow_feature_reset[\s\S]+must not be redispatched/i,
		);
	});

	test("keeps an active Flow goal continuous within existing authority", () => {
		const auto = compileFlowPromptSurface("flow-auto");
		expect(auto).toMatch(
			/active Flow session is\s+authoritative[\s\S]+do\s+not silently fall back to ordinary non-Flow coding/i,
		);
		expect(auto).toMatch(
			/nextAction[\s\S]+authoritative\s+workflow state[\s\S]+not permission/i,
		);
		expect(auto).toMatch(
			/existing implementation authority[\s\S]+continue after approval[\s\S]+feature outcome[\s\S]+failed-review[\s\S]+without asking\s+again/i,
		);
		expect(auto).toMatch(
			/pause only for[\s\S]+material product or scope choice[\s\S]+external Git or release action[\s\S]+hard operational failure/i,
		);
		expect(auto).toMatch(
			/only the user may choose[\s\S]+non-completed closure kind/i,
		);

		const run = compileFlowPromptSurface("flow-run");
		expect(run).not.toMatch(/stop and replan/i);
		expect(run).toMatch(
			/stay inside the active feature[\s\S]+changes owned by another planned feature/i,
		);
		expect(run).toMatch(
			/outside the approved plan, stop editing[\s\S]+finish the\s+approved plan[\s\S]+deferred or abandoned closure[\s\S]+never replan the active approved session in place/i,
		);
		expect(run).toMatch(
			/existing implementation authority covers a qualifying\s+worker wave[\s\S]+do not ask for separate approval/i,
		);
		expect(run).toMatch(
			/two or three genuinely independent, non-overlapping slices[\s\S]+clear benefit/i,
		);
		expect(run).toMatch(
			/host-observed validation advances the session revision[\s\S]+refresh[\s\S]+view: "compact"[\s\S]+before the\s+next `flow_validation_start` or `flow_review_start`/i,
		);
		expect(run).toMatch(
			/invoked directly through\s+`\/flow-run`[\s\S]+one feature's outcome[\s\S]+then stop[\s\S]+active driver is `\/flow-auto`[\s\S]+start the next\s+feature/i,
		);
	});

	test("keeps reviewer and worker roles narrow and structured", () => {
		const command = compileFlowPromptSurface("flow-review");
		const reviewer = compileFlowPromptSurface("flow-reviewer");
		expect(command).toMatch(
			/reserved `flow-reviewer`[\s\S]+workspace-read-only[\s\S]+submit only its own result/i,
		);
		expect(reviewer).toMatch(
			/do not edit files[\s\S]+sole lifecycle mutation/i,
		);
		expect(reviewer).toMatch(
			/workspace-local, non-shell inspection tools[\s\S]+among Flow lifecycle tools[\s\S]+flow_status[\s\S]+flow_feature_complete/i,
		);
		expect(reviewer).toMatch(/assignment id, first call[\s\S]+flow_status/i);
		expect(reviewer).toMatch(/flow_status[\s\S]+Every blocker must cite/i);
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
				summary: expect.any(String),
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "submitted",
				},
			},
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
