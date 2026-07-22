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

function expectInOrder(text: string, fragments: string[]): void {
	let offset = 0;
	for (const fragment of fragments) {
		const index = text.indexOf(fragment, offset);
		expect(index).toBeGreaterThanOrEqual(offset);
		offset = index + fragment.length;
	}
}

function expectOnce(text: string, fragment: string): void {
	expect(text.split(fragment)).toHaveLength(2);
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
				/archiveRetry[\s\S]+flow_session_close[\s\S]+byte-for-byte/i,
			);
			expect(prompt).toMatch(/grants no new\s+work/i);
			expectBefore(
				prompt,
				"archiveRetry",
				surface === "flow-run"
					? "align it with the current"
					: "align the compact-projected",
			);
			if (stops)
				expect(prompt).toMatch(/stop after this cleanup outcome either way/i);
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
		expect(run).toMatch(
			/first ordinary failed review[\s\S]+one automatic `flow_feature_reset`/i,
		);
		expect(run).toMatch(
			/second failed review[\s\S]+explicitly authorizes one additional attempt/i,
		);
		expect(run).toMatch(/full validation[\s\S]+full independent review/i);
		expect(run).toMatch(
			/latest repair fixed[\s\S]+recurring and new blocking findings[\s\S]+validations[\s\S]+`artifactsChanged`[\s\S]+explicit authorization/i,
		);
		const auto = section(
			compileFlowPromptSurface("flow-auto"),
			"Route from status",
		);
		expect(auto).toMatch(
			/blocked outcome[\s\S]+loaded `flow-run` retry and checkpoint contract/i,
		);

		const status = compileFlowPromptSurface("flow-status");
		expectOnce(status, 'flow_status { request: { view: "compact" } }');
		expectOnce(status, 'flow_status { request: { view: "detail" } }');
		expect(status).toMatch(
			/blocked[\s\S]+exactly once[\s\S]+attempt[\s\S]+`failedReviewCount`[\s\S]+findings[\s\S]+validations[\s\S]+`artifactsChanged`[\s\S]+`nextAction`/i,
		);
		expect(status).toMatch(/Do not mutate/i);
		expectInOrder(status, [
			"top-level response status is `error`",
			"and stop",
			"`projection.status` is `blocked`",
		]);
		expect(status).toMatch(
			/`workflowData\.failure\.recovery` when present[\s\S]+no recovery guidance was supplied/i,
		);
		expect(status).toMatch(/recovery guidance[\s\S]+blocked review/i);
		expect(status).toMatch(
			/blocked `await-user-direction`[\s\S]+requires explicit user direction/i,
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
		expectInOrder(runStart, [
			'flow_status { request: { view: "compact" } }',
			"top-level response status is `error`",
			"archiveRetry",
			"align it with the current",
			"status is `idle` or `planning`",
			"`flow_session_close`:",
			"`await-user-direction`",
			"blocked `flow_feature_reset`",
			"Running `flow_feature_reset`",
			"`dispatch-flow-reviewer`:",
			"`flow_run_start`:",
			"`flow_validation_start`:",
			"`flow_review_start`:",
			"Use execution status",
		]);
		expectOnce(run, 'flow_status { request: { view: "detail" } }');
		expect(runStart).toMatch(
			/top-level response status is `error`[\s\S]+recovery when present[\s\S]+initial read made no lifecycle/i,
		);
		expect(runStart).toMatch(
			/Running `flow_feature_reset`[\s\S]+pending review is source-stale[\s\S]+Never redispatch/i,
		);
		expect(runStart).toMatch(
			/`dispatch-flow-reviewer`[\s\S]+read execution status[\s\S]+If that read errors[\s\S]+stop without dispatching[\s\S]+route that refreshed[\s\S]+only if `nextAction` is still[\s\S]+running[\s\S]+`flow_feature_reset`[\s\S]+never dispatch[\s\S]+that assignment[\s\S]+Skip run[\s\S]+start, implementation, and validation/i,
		);
		expect(run).toMatch(
			/serially by default[\s\S]+two or three genuinely independent[\s\S]+same[\s\S]+assistant tool-use turn[\s\S]+at most one targeted follow-up wave/i,
		);
		expect(run).toMatch(
			/known failed exact plan-listed gate[\s\S]+cannot be discharged by substitute broad validation[\s\S]+already accepted review is grandfathered/i,
		);
		const runReview = section(run, "Review and record");
		expect(runReview).toMatch(
			/status remains running[\s\S]+`dispatch-flow-reviewer`[\s\S]+running `flow_feature_reset` route above/i,
		);
		expect(runReview).not.toContain(
			'flow_status { request: { view: "detail" } }',
		);
		expect(runReview).not.toContain("apply the error stop above");
		expect(runReview).toMatch(
			/latest lifecycle state could not be confirmed[\s\S]+stop[\s\S]+without further mutation[\s\S]+Do not claim this invocation made no lifecycle[\s\S]+mutation/i,
		);
		expect(runReview).toMatch(/Use that already-loaded compact status/i);

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
