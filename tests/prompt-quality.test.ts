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
			/first ordinary failed review[\s\S]+one automatic `flow_feature_reset`[\s\S]+blocked `featureId`[\s\S]+`nextFeatureId`[\s\S]+atomically starts/i,
		);
		expect(run).toMatch(
			/second failed review[\s\S]+explicitly authorizes one additional attempt/i,
		);
		expect(run).toMatch(/full validation[\s\S]+full independent review/i);
		expect(run).toMatch(
			/latest repair fixed[\s\S]+recurring and new blocking findings[\s\S]+validations[\s\S]+`artifactsChanged`[\s\S]+explicit authorization/i,
		);
		expect(run).toMatch(
			/explicit direction instead selects another planned[\s\S]*dependency-independent feature[\s\S]*exact `featureId`[\s\S]*`nextFeatureId`[\s\S]*one transaction[\s\S]*do not reset first[\s\S]*`flow_run_start` separately[\s\S]*default selection/i,
		);
		expect(run).toMatch(
			/latest relevant reviewed outcome remains failed is never\s+selected implicitly/i,
		);
		expect(run).toMatch(
			/untouched,[\s\S]+dependency-independent feature[\s\S]+every runnable candidate requires a\s+retry[\s\S]+await-user-direction/i,
		);
		expect(run).toMatch(
			/ready[\s\S]+await-user-direction[\s\S]+failed run[\s\S]+already been superseded[\s\S]+detail once[\s\S]+flow_run_start[\s\S]+exact retry feature ID[\s\S]+do not reset/i,
		);
		const auto = section(
			compileFlowPromptSurface("flow-auto"),
			"Route from status",
		);
		expect(auto).toMatch(
			/blocked outcome[\s\S]+loaded `flow-run` retry and checkpoint\s+contract/i,
		);

		const status = compileFlowPromptSurface("flow-status");
		expectOnce(status, 'flow_status { request: { view: "compact" } }');
		expectOnce(status, 'flow_status { request: { view: "detail" } }');
		expect(status).not.toContain('view: "impediments"');
		expect(status).toMatch(
			/blocked[\s\S]+or `projection\.nextAction` is `await-user-direction`[\s\S]+exactly once[\s\S]+attempt[\s\S]+`failedReviewCount`[\s\S]+retry-required feature[\s\S]+validations[\s\S]+`artifactsChanged`[\s\S]+status and `nextAction`/i,
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
			/blocked `await-user-direction`[\s\S]+atomic `flow_feature_reset`[\s\S]+`nextFeatureId`[\s\S]+ready `await-user-direction`[\s\S]+no blocked run remains[\s\S]+`flow_run_start`[\s\S]+explicit `featureId`[\s\S]+never reset or default selection/i,
		);
		expect(status).toMatch(
			/`workflowData\.autoTiming`[\s\S]+`activeMs`[\s\S]+non-authoritative process-local wall time[\s\S]+not CPU or pure work[\s\S]+`waitingForUserMs`[\s\S]+flow_plan_approve[\s\S]+await-user-direction[\s\S]+latest `\/flow-auto`[\s\S]+paused, inactive, errored, and unprojected waits are excluded/i,
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
			/stable finding, issue, or[\s\S]+IDs[\s\S]+preserve those exact IDs[\s\S]+saved feature[\s\S]+every named ID[\s\S]+traceable/i,
		);
		expect(plan).toMatch(
			/operating system[\s\S]+architecture[\s\S]+service[\s\S]+external setting[\s\S]+preflight it before implementation/i,
		);
		expect(plan).toMatch(
			/flow_plan_save[\s\S]+flow_plan_approve[\s\S]+explicit approval[\s\S]+do not begin implementation/i,
		);
		expect(plan).toMatch(
			/conversational approval[\s\S]+without requiring a second command[\s\S]+same process-local auto interaction[\s\S]+same Flow session/i,
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
			"Running `flow_feature_reset`",
			"`dispatch-flow-reviewer`:",
			"`flow_run_start`:",
			"`flow_validation_start`:",
			"`flow_review_start`:",
			"Use execution status",
		]);
		expectOnce(run, 'flow_status { request: { view: "detail" } }');
		expect(run).not.toContain('view: "impediments"');
		expect(runStart).toMatch(
			/top-level response status is `error`[\s\S]+recovery when present[\s\S]+initial read made no lifecycle/i,
		);
		expect(runStart).toMatch(
			/Running `flow_feature_reset`[\s\S]+pending review is source-stale[\s\S]+Never redispatch/i,
		);
		expect(runStart).toMatch(
			/await-user-direction[\s\S]+detail[\s\S]+exactly once[\s\S]+distinguish[\s\S]+Ready `await-user-direction`[\s\S]+no blocked run[\s\S]+flow_run_start[\s\S]+exact `featureId`[\s\S]+never call `flow_feature_reset`[\s\S]+blocked status[\s\S]+nextFeatureId[\s\S]+atomic/i,
		);
		expect(runStart).toMatch(
			/`dispatch-flow-reviewer`[\s\S]+read execution status[\s\S]+If that read errors[\s\S]+stop without dispatching[\s\S]+route that refreshed[\s\S]+only if `nextAction` is still[\s\S]+running[\s\S]+`flow_feature_reset`[\s\S]+never dispatch[\s\S]+that assignment[\s\S]+Skip run[\s\S]+start, implementation, and validation/i,
		);
		expect(run).toMatch(
			/serially by default[\s\S]+two or three genuinely independent[\s\S]+same[\s\S]+assistant tool-use turn[\s\S]+at most one targeted follow-up wave/i,
		);
		expect(run).toMatch(
			/failed, incomplete, or source-drifted exact plan-listed observation[\s\S]+freshness boundary[\s\S]+current source[\s\S]+after its latest relevant[\s\S]+returning to an older digest[\s\S]+substitute broad validation cannot discharge[\s\S]+already accepted review is\s+grandfathered/i,
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

	test("mechanically loops auto and preflights evidence and risk before coding", () => {
		const auto = compileFlowPromptSurface("flow-auto");
		const loop = section(auto, "End-to-end loop");
		expect(loop).toMatch(
			/mechanical loop states[\s\S]+for `ready`[\s\S]+after every recorded result[\s\S]+for `completed`[\s\S]+return only after closure/i,
		);
		expect(loop).toMatch(
			/intermediate progress[\s\S]+flow_run_start[\s\S]+not terminal[\s\S]+return only after closure/i,
		);
		expect(loop).toMatch(
			/provisional compact baseline[\s\S]+initiating\s+turn creates a Flow session from idle[\s\S]+advances that same Flow session[\s\S]+unchanged pre-existing ready session[\s\S]+replacement session fails closed/i,
		);
		expect(loop).toMatch(
			/conversational `flow_plan_approve`[\s\S]+blocked or ready `await-user-direction`[\s\S]+reply advances that same\s+session/i,
		);
		expect(loop).toMatch(
			/never implicitly select[\s\S]+latest\s+relevant reviewed outcome remains failed/i,
		);
		expect(loop).toMatch(
			/untouched dependency-independent[\s\S]+only retry-required candidates[\s\S]+await-user-direction/i,
		);
		expect(loop).toMatch(
			/status is blocked[\s\S]+nextFeatureId[\s\S]+flow_feature_reset[\s\S]+status is ready[\s\S]+already superseded[\s\S]+detail once[\s\S]+flow_run_start[\s\S]+exact `featureId`[\s\S]+never reset from ready[\s\S]+no hold or\s+retry ledger/i,
		);
		expect(auto).toMatch(
			/do not return [“"]ready for the next feature[,”"]?[\s\S]+wait for another user turn/i,
		);

		const run = compileFlowPromptSurface("flow-run");
		expectBefore(run, "## Evidence and risk preflight", "## Implement");
		const preflight = section(run, "Evidence and risk preflight");
		expect(preflight).toMatch(
			/before editing or dispatching a worker[\s\S]+exact commands[\s\S]+operating system[\s\S]+available, authorized path/i,
		);
		expect(preflight).toMatch(
			/adversarial checklist[\s\S]+failure and[\s\S]+cleanup ordering[\s\S]+adjacent states[\s\S]+repetition[\s\S]+overlapping/i,
		);
		expect(preflight).toMatch(
			/required evidence needs user or external authority[\s\S]+stop before\s+implementation and ask[\s\S]+knowingly skipped[\s\S]+unavailable[\s\S]+manager policy forbids calling[\s\S]+flow_review_start[\s\S]+no\s+skipped-evidence ledger[\s\S]+reviewer treats missing proof as blocking/i,
		);

		const validate = section(run, "Validate");
		expect(validate).toMatch(
			/\[flow-validation\][\s\S]+passed[\s\S]+recordedRevision[\s\S]+only a concurrency token[\s\S]+passed: true[\s\S]+flow_review_start[\s\S]+runtime review gates[\s\S]+passed: false[\s\S]+only to arm fresh\s+validation[\s\S]+never review[\s\S]+do not refresh compact status solely[\s\S]+absent or malformed[\s\S]+refresh compact status/i,
		);
		expect(validate).toMatch(
			/do not call `flow_review_start`[\s\S]+known required behavior or environment evidence is skipped or unavailable[\s\S]+manager\s+workflow policy[\s\S]+persisted runtime gate/i,
		);
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
		expect(reviewer).toMatch(
			/adjacent states[\s\S]+repetition[\s\S]+overlapping invariants[\s\S]+base diff[\s\S]+executable\/file-mode/i,
		);
		expect(reviewer).toMatch(
			/manager-supplied baseline inventory[\s\S]+independently inspect[\s\S]+evidence, not a verdict[\s\S]+lack of shell access alone is\s+not a failure/i,
		);
		expect(reviewer).toMatch(
			/missing proof[\s\S]+precise blocker[\s\S]+manager-owned[\s\S]+scenario[\s\S]+expected observable result/i,
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
		expect(worker).toMatch(
			/adversarial acceptance and risk checklist prepared before coding[\s\S]+if it is missing[\s\S]+stop without editing/i,
		);
		expect(worker).toMatch(
			/before editing[\s\S]+failure and cleanup ordering[\s\S]+adjacent state transitions[\s\S]+named finding or requirement ID/i,
		);

		const run = compileFlowPromptSurface("flow-run");
		expect(run).toMatch(
			/never use generic or[\s\S]+general-purpose agents for active Flow work/i,
		);
		expect(run).toMatch(
			/worker must receive the checklist before it[\s\S]+codes[\s\S]+never substitute a generic agent/i,
		);
	});
});
