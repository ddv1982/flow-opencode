import { describe, expect, test } from "bun:test";
import { FeatureCompleteInputSchema } from "../src/application/schema.js";
import { FLOW_CORE_COMMANDS } from "../src/config-shared.js";
import {
	FLOW_GUIDANCE_IDS,
	FLOW_GUIDANCE_TOPICS,
	FLOW_MANAGER_KERNEL,
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
const MAX_MANAGER_PROMPT_BYTES = 34_000;
const MANAGER_PROMPT_RESERVE_BYTES = 4 * 1024;

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

	test("keeps one compact manager kernel across auto continuation surfaces", () => {
		const auto = compileFlowPromptSurface("flow-auto");
		const run = compileFlowPromptSurface("flow-run");
		const plan = compileFlowPromptSurface("flow-plan");
		expectOnce(auto, FLOW_MANAGER_KERNEL);
		expectOnce(run, FLOW_MANAGER_KERNEL);
		expect(plan).not.toContain(FLOW_MANAGER_KERNEL);
		expectOnce(getFlowGuidance("flow").content, FLOW_MANAGER_KERNEL);
		expectOnce(getFlowGuidance("flow-run").content, FLOW_MANAGER_KERNEL);
		expect(getFlowGuidance("flow-plan").content).not.toContain(
			FLOW_MANAGER_KERNEL,
		);
		expect(FLOW_MANAGER_KERNEL).toMatch(
			/root manager[\s\S]+manager lifecycle mutations[\s\S]+integration[\s\S]+validation[\s\S]+review dispatch[\s\S]+independent reviewer submits only its own result/i,
		);
		expect(FLOW_MANAGER_KERNEL).toMatch(
			/active Flow work only to `flow-worker`[\s\S]+independent review only to `flow-reviewer`[\s\S]+never use generic/i,
		);
		expect(FLOW_MANAGER_KERNEL).toMatch(
			/one automatic fresh full retry[\s\S]+only when `failedReviewCount === 1`[\s\S]+no `\[scope-blocker\]` is present[\s\S]+otherwise checkpoint/i,
		);
		expect(FLOW_MANAGER_KERNEL).toMatch(
			/current-source evidence[\s\S]+behavior evidence[\s\S]+base-diff[\s\S]+deletion[\s\S]+rename[\s\S]+file-type[\s\S]+executable-mode/i,
		);

		const combined = [
			auto,
			getFlowGuidance("flow-plan").content,
			getFlowGuidance("flow-run").content,
		].join("\n");
		expect(new TextEncoder().encode(combined).byteLength).toBeLessThanOrEqual(
			MAX_MANAGER_PROMPT_BYTES - MANAGER_PROMPT_RESERVE_BYTES,
		);

		const reservedArgument = "x".repeat(MANAGER_PROMPT_RESERVE_BYTES);
		const rewrittenAuto = FLOW_CORE_COMMANDS["flow-auto"].template.replaceAll(
			"$ARGUMENTS",
			() => "the preceding non-synthetic Flow request",
		);
		const realCommandStack = [
			`Flow flow-auto: ${reservedArgument}`,
			rewrittenAuto,
			getFlowGuidance("flow-plan").content,
			getFlowGuidance("flow-run").content,
		].join("\n");
		expectOnce(realCommandStack, reservedArgument);
		expect(
			new TextEncoder().encode(realCommandStack).byteLength,
		).toBeLessThanOrEqual(MAX_MANAGER_PROMPT_BYTES);
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
			expect(prompt).toMatch(
				/archiveRetry[\s\S]+flow_session_close[\s\S]+(?:returned )?(?:workflowData\.)?delivery/i,
			);
			expect(prompt).toMatch(/grants no\s+(?:new\s+)?work/i);
			expect(prompt).toMatch(/top-level[\s\S]+error/i);
			expect(prompt).toMatch(/summary[\s\S]+recovery/i);
			expect(prompt).toMatch(/delivery/i);
			expect(prompt).toMatch(/stop[\s\S]+mutation|mutation[\s\S]+stop/i);
			expectBefore(prompt, "archiveRetry", "flow_session_close");
			if (prompt.includes('flow_status { request: { view: "detail" } }'))
				expectBefore(
					prompt,
					"flow_session_close",
					'flow_status { request: { view: "detail" } }',
				);
			expectBefore(prompt, "archiveRetry", "alignment");
			if (stops)
				expect(prompt).toMatch(
					/stop after this\s+cleanup\s+outcome either way/i,
				);
			else
				expect(prompt).toMatch(
					/(?:refresh\s+compact\s+status[\s\S]+refreshed|confirmed)\s+projection/i,
				);
		}
	});

	test("links flow-auto initial errors to its complete Recovery delivery handoff", () => {
		const auto = compileFlowPromptSurface("flow-auto");
		const route = section(auto, "Route from status");
		const recovery = section(auto, "Recovery");
		expect(route).toMatch(
			/call `flow_status \{ request: \{ view: "compact" \} \}` first[\s\S]+top-level response is an error[\s\S]+exact summary and recovery[\s\S]+when delivery is present[\s\S]+bounded map under \*\*Recovery\*\*[\s\S]+stop[\s\S]+without another mutation/i,
		);
		expect(recovery).toMatch(
			/accepted close[\s\S]+map only `workflowData\.delivery`[\s\S]+`outcomeSummary`\/`terminalFindings`[\s\S]+requirements are proven `verified`[\s\S]+otherwise `incomplete` or explicit[\s\S]+`deferred`[\s\S]+missing IDs are unavailable/i,
		);
		expect(recovery).toMatch(
			/from\s+delivery\s+report each feature's\s+attempt count[\s\S]+latest\s+outcome[\s\S]+terminal\s+findings[\s\S]+Flow-reported latest\/superseded artifacts[\s\S]+not an exact\s+Git delta/i,
		);
	});

	test("reports a complete delivery handoff on direct entry errors", () => {
		for (const [surface, heading] of [
			["flow-plan", "Start"],
			["flow-run", "Start and scope"],
		] as const) {
			const start = section(compileFlowPromptSurface(surface), heading);
			expect(start).toMatch(
				/top-level (?:response status is )?`?error`?[\s\S]+exact summary\/?[\s\S]*recovery[\s\S]+`workflowData\.delivery`[\s\S]+handoff/i,
			);
			expect(start).toMatch(
				/initial read[\s\S]+made no lifecycle, Git, or release mutation[\s\S]+stop/i,
			);
			expect(start).toMatch(
				/delivery handoff[\s\S]+goal[\s\S]+closure kind\/summary[\s\S]+progress[\s\S]+per-feature[\s\S]+ID\/title\/attempts\/latest state\/outcome summary\/terminal findings[\s\S]+`reportedArtifacts\.latestAttempts`[\s\S]+`reportedArtifacts\.supersededAttemptsOnly`[\s\S]+Flow-reported[\s\S]+caller-declared artifacts[\s\S]+not an exact\/exhaustive Git delta/i,
			);
			expect(start).toMatch(
				/map IDs only[\s\S]+`outcomeSummary`\/`terminalFindings`[\s\S]+`verified`[\s\S]+`incomplete`[\s\S]+explicit(?:ly)? `deferred`[\s\S]+`abandoned`/i,
			);
			expect(start).toMatch(
				/`fixed`[\s\S]+passing review[\s\S]+current evidence[\s\S]+`recurring`[\s\S]+`residual`/i,
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
			/only when `failedReviewCount === 1`[\s\S]+no `\[scope-blocker\]`[\s\S]+one automatic `flow_feature_reset`[\s\S]+blocked `featureId`[\s\S]+`nextFeatureId`[\s\S]+atomically starts/i,
		);
		expect(run).toMatch(
			/when `failedReviewCount >= 2`[\s\S]+only when[\s\S]+explicitly[\s\S]+authorizes one additional attempt[\s\S]+if that attempt fails[\s\S]+checkpoint[\s\S]+again/i,
		);
		expect(run).toMatch(/full validation[\s\S]+full independent review/i);
		expect(run).toMatch(
			/latest repair proved\s+pending a passing review[\s\S]+recurring and new blockers[\s\S]+validations[\s\S]+`artifactsChanged`[\s\S]+explicit authorization/i,
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
			/blocked outcomes?[\s\S]+loaded retry(?: and |\/)checkpoint\s+contract/i,
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
		expect(status).toMatch(
			/`workflowData\.delivery`[\s\S]+goal[\s\S]+closure kind and summary[\s\S]+progress[\s\S]+every feature[\s\S]+`id`[\s\S]+`title`[\s\S]+`attempts`[\s\S]+`latestState`[\s\S]+`outcomeSummary`[\s\S]+`terminalFindings`[\s\S]+`reportedArtifacts\.latestAttempts`[\s\S]+`reportedArtifacts\.supersededAttemptsOnly`[\s\S]+Flow-reported caller-declared artifacts[\s\S]+not an exact or exhaustive Git delta[\s\S]+terminal ID map use only `outcomeSummary` and `terminalFindings`[\s\S]+`verified` only when proven[\s\S]+`incomplete`[\s\S]+explicitly `deferred`[\s\S]+`fixed` needs later passing review plus current evidence[\s\S]+`recurring` current confirmation[\s\S]+`residual` a confirmed nonblocker[\s\S]+`abandoned` remains the closure kind[\s\S]+missing IDs are unavailable/i,
		);
		for (const prompt of [
			status,
			section(compileFlowPromptSurface("flow-auto"), "Recovery"),
		])
			expect(prompt).toMatch(
				/(?:terminally `fixed` only when review passes with|`fixed` needs later passing review plus) current evidence/i,
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
			/blocking issue[\s\S]+repair requires material work outside[\s\S]+approved plan[\s\S]+\[scope-blocker\][\s\S]+forbidden on advisory findings/i,
		);
		expect(reviewer).toMatch(
			/finding <feature-id>\.R<assignment-createdRevision>-<NN>[\s\S]+finding frontend-integrity\.R12-01[\s\S]+reuse a prior ID for recurrence[\s\S]+current assignment revision plus local sequence/i,
		);
		expect(reviewer).toMatch(
			/\[scope-blocker\] finding <feature-id>\.R<assignment-createdRevision>-<NN>[\s\S]+forbidden on advisory findings[\s\S]+only[\s\S]+bracketed routing marker[\s\S]+missing outcome evidence is an ordinary, precise[\s\S]+blocking finding/i,
		);
	});

	test("keeps plan, run, and delivery boundaries decision-complete", () => {
		const plan = compileFlowPromptSurface("flow-plan");
		expect(plan).toMatch(
			/observable outcome[\s\S]+bounded evidence[\s\S]+exact[\s\S]+plan-listed\s+command byte-for-byte/i,
		);
		expect(plan).toMatch(
			/stable finding, issue, or requirement IDs[\s\S]+exactly[\s\S]+saved feature[\s\S]+traceable[\s\S]+immutable plan[\s\S]+outcome[\s\S]+evidence/i,
		);
		expect(plan).toMatch(
			/operating system[\s\S]+architecture[\s\S]+service[\s\S]+external setting[\s\S]+`flow-run`[\s\S]+preflight before implementation/i,
		);
		expect(plan).toMatch(
			/separate a race or state-machine invariant[\s\S]+independently[\s\S]+UI[\s\S]+persistence[\s\S]+accessibility[\s\S]+indivisible invariant/i,
		);
		expect(plan).toMatch(
			/flow_plan_save[\s\S]+flow_plan_approve[\s\S]+explicit approval[\s\S]+do not begin implementation/i,
		);
		expect(plan).toMatch(
			/conversational[\s\S]+`\/flow-auto` approval[\s\S]+without requiring a second command[\s\S]+same process-local interaction[\s\S]+same Flow[\s\S]+session/i,
		);
		expect(section(plan, "Start")).toMatch(
			/non-completed session[\s\S]+explicit deferred\/abandoned choice[\s\S]+flow_session_close/i,
		);
		expect(section(plan, "Start")).toMatch(
			/same goal or a method\/emphasis narrowing[\s\S]+preserves every requested[\s\S]+outcome/i,
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
			/top-level response status is `error`[\s\S]+recovery[\s\S]+(?:initial |this )read made no lifecycle/i,
		);
		expect(runStart).toMatch(
			/resuming attempt 2 or later[\s\S]+prior findings are not already available[\s\S]+read detail once[\s\S]+IDs from superseded attempts[\s\S]+before preflight/i,
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
		expect(runReview).toMatch(
			/current-source commands or scenarios[\s\S]+feature-specific risk checklist[\s\S]+`Risks\/Matrix:`[\s\S]+representing it as a transition matrix[\s\S]+`Baseline:`[\s\S]+only when this feature changes[\s\S]+or[\s\S]+depends[\s\S]+final review receives the full inventory[\s\S]+`Prior findings:`[\s\S]+current `terminal fixed pending pass`[\s\S]+`recurring`[\s\S]+`residual`[\s\S]+unverified-fixed[\s\S]+omit empty optional[\s\S]+sections/i,
		);
		expect(runReview).toMatch(
			/ordinary-review plan\/source IDs[\s\S]+active-feature mappings[\s\S]+explicitly supplied[\s\S]+packet/i,
		);
		expect(runReview).toMatch(
			/final review[\s\S]+every approved requirement\/feature ID[\s\S]+always carry still-live prior[\s\S]+findings/i,
		);
		expect(runReview).not.toMatch(/claimed `fixed`|current `fixed`/i);

		const auto = compileFlowPromptSurface("flow-auto");
		expect(section(auto, "Recovery")).toMatch(
			/load `flow-run`[\s\S]+active or blocked\s+feature/i,
		);
		expect(auto).toMatch(
			/(?:workflowData\.)?delivery[\s\S]+attempt(?:'s)? count[\s\S]+terminal\s+findings[\s\S]+artifacts\s+are\s+not an exact\s+Git delta/i,
		);
		expect(auto).toMatch(/do not create reports[\s\S]+JSON is opt-in/i);
		const recovery = section(auto, "Recovery");
		expect(recovery).toMatch(
			/summaries keep plan\/source IDs[\s\S]+`verified`[\s\S]+`incomplete`/i,
		);
		expect(recovery).toMatch(
			/terminally `fixed` only when review passes with current evidence[\s\S]+failed[\s\S]+verdict carries every prior ID forward[\s\S]+terminal\s+fixed pending pass[\s\S]+concise evidence[\s\S]+unverified-fixed[\s\S]+`recurring`[\s\S]+`residual`[\s\S]+blockers stay terminal/i,
		);
		expect(recovery).toMatch(
			/accepted close[\s\S]+map only `workflowData\.delivery`[\s\S]+`outcomeSummary`\/`terminalFindings`[\s\S]+never[\s\S]+invent or read detail solely[\s\S]+for closure/i,
		);
		expect(recovery).toMatch(
			/(?:delivery is absent|without delivery)[\s\S]+exact\s+recovery[\s\S]+no\s+map/i,
		);
		expect(auto).toMatch(
			/revision conflict[\s\S]+refresh compact status[\s\S]+same session and goal[\s\S]+status still[\s\S]+permits the selected closure kind[\s\S]+never close a replacement/i,
		);
		expect(recovery).toMatch(
			/`archiveRetry`[\s\S]+durably\s+accepted close[\s\S]+rejected revision conflict[\s\S]+refresh compact[\s\S]+same session\/goal[\s\S]+fresh request/i,
		);
		expect(recovery).toMatch(
			/external[\s\S]+prerequisites[\s\S]+create no (?:other|another) ledger or\s+report/i,
		);
		expect(section(run, "Start and scope")).toMatch(
			/archiveRetry[\s\S]+flow_session_close[\s\S]+report delivery under the contract/i,
		);
		expect(run).toMatch(
			/delivery is absent[\s\S]+exact recovery[\s\S]+no map[\s\S]+revision\s+conflict[\s\S]+refresh compact[\s\S]+same session and goal[\s\S]+status still permits the selected closure kind[\s\S]+never\s+close a replacement/i,
		);
	});

	test("mechanically loops auto and preflights evidence and risk before coding", () => {
		const auto = compileFlowPromptSurface("flow-auto");
		const loop = section(auto, "End-to-end loop");
		expect(loop).toMatch(
			/loops `ready`\/`completed`[\s\S]+for `ready`[\s\S]+after every recorded result[\s\S]+for `completed`[\s\S]+return only after closure/i,
		);
		expect(loop).toMatch(/flow_run_start[\s\S]+not terminal/i);
		expect(loop).toMatch(/intermediate progress[\s\S]+not terminal/i);
		expect(loop).toMatch(/return only after\s+closure/i);
		expect(loop).toMatch(
			/same-host non-replayed[\s\S]+flow_plan_save[\s\S]+owns idle session creation[\s\S]+active baseline advances[\s\S]+latter temporal gate admits a pending reviewer result[\s\S]+unchanged ready or replacement fails closed/i,
		);
		expect(loop).toMatch(
			/conversational `flow_plan_approve`[\s\S]+blocked or ready[\s\S]+`await-user-direction`[\s\S]+reply's same-host accepted mutation advances it/i,
		);
		expect(loop).toMatch(
			/never implicitly\s+select[\s\S]+latest relevant reviewed outcome remains failed/i,
		);
		expect(loop).toMatch(
			/untouched independent features[\s\S]+only retries remain/i,
		);
		expect(auto).toMatch(
			/never return\s+[“"]ready\s+for\s+the\s+next\s+feature[,”"]?\s+or wait while/i,
		);

		const run = compileFlowPromptSurface("flow-run");
		expectBefore(run, "## Evidence and risk preflight", "## Implement");
		const preflight = section(run, "Evidence and risk preflight");
		expect(preflight).toMatch(
			/before editing or dispatching a worker[\s\S]+exact commands[\s\S]+operating system[\s\S]+authorized path/i,
		);
		expect(preflight).toMatch(
			/adversarial checklist[\s\S]+failure and[\s\S]+cleanup ordering[\s\S]+adjacent states[\s\S]+repetition[\s\S]+overlapping/i,
		);
		expect(preflight).toMatch(
			/concurrency or[\s\S]+state-machine[\s\S]+state\/interleaving[\s\S]+event[\s\S]+expected outcome[\s\S]+cleanup\/invariant[\s\S]+evidence/i,
		);
		expect(preflight).toMatch(
			/conversational run baseline[\s\S]+refresh changed facts[\s\S]+review[\s\S]+preserve\s+(?:still-live\s+)?prior(?: finding)? IDs/i,
		);
		expect(preflight).toMatch(
			/required evidence needing[\s\S]*user or\s+external authority[\s\S]+stops before\s+implementation[\s\S]+if skipped or unavailable, it forbids[\s\S]+`flow_review_start`[\s\S]+no\s+skipped-evidence ledger[\s\S]+reviewer blocks/i,
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
			/proof missing from the approved outcome[\s\S]+precise blocker[\s\S]+manager-owned[\s\S]+scenario[\s\S]+expected observable[\s\S]+result/i,
		);
		expect(reviewer).toMatch(
			/finish the supplied feature-specific risk checklist[\s\S]+represented by a bounded[\s\S]+matrix[\s\S]+after finding[\s\S]+one blocker[\s\S]+same review[\s\S]+cohort/i,
		);
		expect(reviewer).toMatch(
			/terminal `fixed`\s+requires this review to pass and current evidence[\s\S]+failed verdict[\s\S]+preserve every prior ID[\s\S]+repair proven; terminal fixed pending pass[\s\S]+evidence reference[\s\S]+carry it into the next attempt/i,
		);
		expect(reviewer).toMatch(
			/unproven blocking[\s\S]+same ID[\s\S]+unproven advisory repair stays advisory[\s\S]+fixed claim\s+unverified[\s\S]+`residual` only when current[\s\S]+evidence[\s\S]+nonblocker\s+remains[\s\S]+escalate only when current evidence/i,
		);
		const reviewScope = section(reviewer, "Review");
		expect(reviewScope).toMatch(
			/ordinary feature review[\s\S]+records\s+dispositions only for IDs mapped to the active feature or explicitly supplied[\s\S]+feature packet[\s\S]+unrelated IDs visible in approved-plan context[\s\S]+context,\s+not review claims/i,
		);
		expect(reviewScope).toMatch(
			/final review[\s\S]+records dispositions for[\s\S]+every approved requirement and feature[\s\S]+regardless of kind[\s\S]+every[\s\S]+still-live prior disposition/i,
		);
		expect(reviewer).toMatch(
			/finding <feature-id>\.R<assignment-createdRevision>-<NN>[\s\S]+for example[\s\S]+finding frontend-integrity\.R12-01[\s\S]+reuse a prior ID[\s\S]+current assignment revision plus local sequence[\s\S]+source-provided ID/i,
		);
		const submitScope = section(reviewer, "Submit one result");
		expect(submitScope).toMatch(
			/ordinary review[\s\S]+only plan\/source IDs mapped to the active feature or explicitly[\s\S]+feature packet[\s\S]+final review[\s\S]+every approved\s+requirement\/feature ID/i,
		);
		expect(submitScope).toMatch(
			/every still-live supplied prior-finding ID[\s\S]+preserve\s+its ID[\s\S]+current severity[\s\S]+change from the supplied\s+severity/i,
		);
		expect(reviewer).toMatch(
			/only a passing result may[\s\S]+proven `fixed`[\s\S]+failed result carries every prior ID forward[\s\S]+repair proven; terminal fixed pending pass[\s\S]+evidence reference/i,
		);
		expect(reviewer).toMatch(
			/recurring blockers remain findings[\s\S]+only IDs fixed by a passing\s+review leave the live carry-forward set/i,
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
			/assigned slice[\s\S]+do not run Bash[\s\S]+exact, non-overlapping write paths[\s\S]+authoritative combined validation/i,
		);
		expect(worker).toMatch(
			/adversarial acceptance and risk checklist[\s\S]+represented as a transition matrix[\s\S]+prepared before coding[\s\S]+if it is missing[\s\S]+stop without editing/i,
		);
		expect(worker).toMatch(
			/before editing[\s\S]+risk coverage[\s\S]+matrix rows when present[\s\S]+failure and cleanup ordering[\s\S]+adjacent state transitions[\s\S]+prior review ID/i,
		);

		const run = compileFlowPromptSurface("flow-run");
		expect(run).toMatch(
			/delegate active Flow work only to[\s\S]+flow-worker[\s\S]+independent review only to[\s\S]+flow-reviewer[\s\S]+never use generic or general-purpose agents/i,
		);
		expect(run).toMatch(
			/worker\s+must receive the checklist before it[\s\S]+codes/i,
		);
	});
});
