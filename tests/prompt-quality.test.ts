import { describe, expect, test } from "bun:test";
import { FeatureCompleteInputSchema } from "../src/application/schema.js";
import { FLOW_CORE_COMMANDS } from "../src/config-shared.js";
import {
	FLOW_GUIDANCE_IDS,
	FLOW_MANAGER_KERNEL,
	getFlowGuidance,
} from "../src/guidance/catalog.js";
import {
	compileFlowPromptSurface,
	type FlowPromptSurfaceName,
} from "../src/prompt-surfaces.js";

// This file asserts prompt *structure and economy*, never prompt wording.
//
// It used to pin ~110 ordered phrase regexes. That made adding a sentence free
// and deleting one expensive, which is how the prompt surfaces grew from 2,380
// to 6,300 words across eight releases while the runtime grew 39%. Whether a
// prompt actually works is now measured by `evals/`, which drives real models
// and asserts durable Session v5 outcomes.
//
// The budgets below are CEILINGS THAT RATCHET DOWN. Lower them when a cut lands.
// Never raise one to admit new prose: either the rule belongs in the runtime as
// a typed field or transition guard, or it belongs in one place only.

const SURFACES: readonly FlowPromptSurfaceName[] = [
	"flow-auto",
	"flow-plan",
	"flow-run",
	"flow-review",
	"flow-status",
	"flow-reviewer",
	"flow-worker",
];

const MANAGER_GUIDANCE = [
	["flow-auto", "flow"],
	["flow-plan", "flow-plan"],
	["flow-run", "flow-run"],
] as const;

const MAX_MANAGER_PROMPT_BYTES = 34_000;
const MANAGER_PROMPT_RESERVE_BYTES = 4 * 1024;

/**
 * Total shipped prompt bytes across every surface. Baseline: 38,495.
 *
 * Ratcheted to 38,500 when `plan.gate` replaced the prose that told the model what
 * `broad` scope meant. The field is a net subtraction: a typed command the runtime
 * matches byte-for-byte cost less prompt than the two paragraphs asking the model
 * to judge whether its own claim was honest, and it is checked rather than trusted.
 *
 * Held at 38,500 through `plan.externalEvidence`, which landed at 38,307, and the
 * rule above is why: the ceiling forced the addition to be a field with a guard plus
 * one bullet, and it paid for itself out of the prose the guard made redundant — the
 * environment inventory the plan now enumerates, the review-admission reconciliation
 * the veto performs, a fabricated-result sentence flow-plan already carried, and the
 * sentence that let a reviewer accept "a justified equivalent" for the canonical
 * gate. That last one was a licence to accept a substitute, on the surface whose
 * measured failure was accepting one. The reviewer needed no new prose: it is
 * already told that a platform claim without proof is a failure, and a final review
 * over unsatisfied evidence is now refused before the reviewer is asked at all.
 *
 * Held at 38,500 again through declared `assertions` and `resultsPath`, which landed
 * at 38,485 — fifteen bytes of headroom, and the same rule did the work. Two cuts paid
 * for the addition: the plan-time confirmation that "every required evidence
 * environment has an identified execution path", which is now the field the runtime
 * refuses a plan without, and the flow-run inventory sentence that said the same thing
 * a second time. A ceiling this tight is the point — it is why each of the last three
 * evidence rules arrived as a checked field rather than another paragraph asking the
 * model to be careful.
 */
const MAX_TOTAL_PROMPT_BYTES = 14_500;

/**
 * Absolute-rule markers per surface. Both Anthropic and OpenAI advise reserving
 * MUST/NEVER/ONLY for true invariants, because stacking them degrades rather
 * than tightens compliance. These are the current counts: adding one should be
 * a deliberate act, not a side effect of an edit.
 */
const MAX_ABSOLUTE_RULES: Readonly<Record<FlowPromptSurfaceName, number>> = {
	"flow-auto": 6,
	"flow-plan": 17,
	"flow-run": 6,
	"flow-review": 3,
	"flow-status": 7,
	"flow-reviewer": 25,
	"flow-worker": 12,
};

/**
 * Cross-surface near-duplicate sentence pairs, excluding the deliberately
 * shared manager kernel. Every pair is one rule stated more than once.
 */
const MAX_NEAR_DUPLICATE_PAIRS = 12;
const NEAR_DUPLICATE_THRESHOLD = 0.7;

/**
 * The `flow_*` tools that actually exist. `tests/live-opencode-smoke.test.ts`
 * verifies this same set against a real host, so drift fails there; here it
 * catches a prompt naming a tool the runtime does not expose.
 */
const REAL_FLOW_TOOLS = new Set([
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_guidance",
	"flow_plan_approve",
	"flow_plan_save",
	"flow_review_start",
	"flow_run_start",
	"flow_session_close",
	"flow_status",
	"flow_validation_start",
]);

const ABSOLUTE_RULE_PATTERN =
	/\b(?:must|never|always|only|exactly|forbidden|cannot|do not|don't)\b/gi;

const STOP_WORDS = new Set(
	"a an the and or of to in for on is are be it its that this with as at by from not no than then when only every each".split(
		" ",
	),
);

function body(markdown: string): string {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).byteLength;
}

/** Substantive sentences, with fenced code excluded. */
function sentences(text: string): string[] {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\s+/g, " ")
		.split(/(?<=[.;:])\s+/)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.split(" ").length >= 8);
}

function contentTokens(sentence: string): Set<string> {
	return new Set(
		sentence
			.toLowerCase()
			.replace(/[^a-z0-9 ]/g, " ")
			.split(/\s+/)
			.filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
	);
}

function jaccard(left: Set<string>, right: Set<string>): number {
	let shared = 0;
	for (const token of left) if (right.has(token)) shared += 1;
	return shared / (left.size + right.size - shared);
}

function expectOnce(text: string, fragment: string): void {
	expect(text.split(fragment)).toHaveLength(2);
}

describe("Flow prompt structure", () => {
	test("compiles seven runtime surfaces from four canonical guides", () => {
		expect(FLOW_GUIDANCE_IDS).toEqual([
			"flow",
			"flow-plan",
			"flow-run",
			"flow-review",
		]);
		for (const id of FLOW_GUIDANCE_IDS) {
			expect(getFlowGuidance(id).content).toStartWith("---\n");
			expect(body(getFlowGuidance(id).content).length).toBeGreaterThan(200);
		}
		// Manager surfaces are now thin routers that load guides via flow_guidance
		const flowAuto = compileFlowPromptSurface("flow-auto");
		expect(flowAuto).toContain('flow_guidance { id: "flow-plan" }');
		expect(flowAuto).toContain('flow_guidance { id: "flow-run" }');

		const flowPlan = compileFlowPromptSurface("flow-plan");
		expect(flowPlan).toContain('flow_guidance { id: "flow-plan" }');

		const flowRun = compileFlowPromptSurface("flow-run");
		expect(flowRun).toContain('flow_guidance { id: "flow-run" }');

		for (const surface of SURFACES) {
			expect(compileFlowPromptSurface(surface).trim().length).toBeGreaterThan(
				40,
			);
		}
		expect(() =>
			compileFlowPromptSurface("unknown" as FlowPromptSurfaceName),
		).toThrow("Unsupported Flow prompt surface");
	});

	test("keeps worker dispatch inside an active feature run", () => {
		// 7.3.0 thin routers load only flow-plan during planning. If the kernel still
		// says "delegate active Flow work to flow-worker" and flow-plan is silent,
		// the first planning review wave refuses for a missing assignment matrix.
		expect(FLOW_MANAGER_KERNEL).toContain("After a feature run starts");
		expect(FLOW_MANAGER_KERNEL).not.toContain("Delegate active Flow work");
		expect(getFlowGuidance("flow-plan").content).toContain(
			"Do not dispatch `flow-worker` while planning",
		);
	});

	test("routes every manager surface through compact status and lazy guides", () => {
		for (const [surface] of MANAGER_GUIDANCE) {
			expect(compileFlowPromptSurface(surface)).toContain(
				'flow_status { request: { view: "compact" } }',
			);
		}
		const auto = compileFlowPromptSurface("flow-auto");
		expect(auto).toContain('flow_guidance { id: "flow-plan" }');
		expect(auto).toContain('flow_guidance { id: "flow-run" }');
	});

	test("names only tools the runtime actually exposes", () => {
		for (const surface of SURFACES) {
			const named = new Set(
				compileFlowPromptSurface(surface).match(/\bflow_[a-z_]+\b/g) ?? [],
			);
			for (const tool of named) {
				expect(REAL_FLOW_TOOLS, `${surface} names ${tool}`).toContain(tool);
			}
		}
	});

	test("keeps the reviewer submission example valid against the live schema", () => {
		const reviewer = compileFlowPromptSurface("flow-reviewer");
		const example = JSON.parse(
			reviewer.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "null",
		);
		const parsed = FeatureCompleteInputSchema.parse(example);
		expect(parsed).toEqual(example);
	});

	test("routes on typed fields instead of markers embedded in prose", () => {
		// Scope-blocker routing is a typed `scopeBlocker` boolean on the finding,
		// enforced by the transition guard and surfaced as
		// `blockedFeature.scopeBlocker`. No surface may reintroduce a routing marker
		// that a model has to spot inside free text.
		//
		// `[flow-validation]` is exempt: the runtime emits it in tool output, so it
		// is something the model reads, not a decision it must encode in prose.
		const RUNTIME_EMITTED = new Set(["[flow-validation]"]);
		for (const surface of SURFACES) {
			const markers = (
				compileFlowPromptSurface(surface).match(/\[[a-z][a-z-]*\]/gi) ?? []
			).filter((marker) => !RUNTIME_EMITTED.has(marker));
			expect(new Set(markers), `${surface} routing markers`).toEqual(new Set());
		}
		expect(compileFlowPromptSurface("flow-reviewer")).toContain("scopeBlocker");
	});

	test("names findingsDigest on auto and run handback surfaces", () => {
		expect(compileFlowPromptSurface("flow-auto")).toContain("findingsDigest");
		expect(compileFlowPromptSurface("flow-run")).toContain("findingsDigest");
		expect(getFlowGuidance("flow-run").content).toContain("findingsDigest");
		expect(getFlowGuidance("flow").content).toContain("findingsDigest");
	});

	test("makes the unsatisfied-evidence checkpoint explicit", () => {
		expect(getFlowGuidance("flow-run").content).toContain(
			"Running `await-user-direction` means plan evidence is unsatisfied",
		);
		expect(getFlowGuidance("flow-run").content).toContain(
			"exact command and environment, defer, or abandon",
		);
	});

	test("continues a reviewer matrix only when the packet asked for one", () => {
		const reviewer = compileFlowPromptSurface("flow-reviewer");
		expect(reviewer).toContain("riskLenses");
		expect(reviewer).toContain("packet summary includes a matrix");
		expect(getFlowGuidance("flow-plan").content).toContain("inspect-only");
		expect(getFlowGuidance("flow-plan").content).toContain(
			"no repair features",
		);
		expect(getFlowGuidance("flow-plan").content).toContain('kind: "inspect"');
	});

	test("retires stale projection vocabulary", () => {
		for (const surface of SURFACES) {
			expect(compileFlowPromptSurface(surface)).not.toContain(
				'view: "impediments"',
			);
		}
	});
});

describe("Flow prompt economy", () => {
	test("states the manager kernel exactly once per surface that needs it", () => {
		const auto = compileFlowPromptSurface("flow-auto");
		const run = compileFlowPromptSurface("flow-run");
		expectOnce(auto, FLOW_MANAGER_KERNEL);
		expectOnce(run, FLOW_MANAGER_KERNEL);
		expect(compileFlowPromptSurface("flow-plan")).not.toContain(
			FLOW_MANAGER_KERNEL,
		);
		expectOnce(getFlowGuidance("flow").content, FLOW_MANAGER_KERNEL);
		expectOnce(getFlowGuidance("flow-run").content, FLOW_MANAGER_KERNEL);
		expect(getFlowGuidance("flow-plan").content).not.toContain(
			FLOW_MANAGER_KERNEL,
		);
	});

	test("invokes each status view once per surface", () => {
		const status = compileFlowPromptSurface("flow-status");
		expectOnce(status, 'flow_status { request: { view: "compact" } }');
		expectOnce(status, 'flow_status { request: { view: "detail" } }');
		// Thin routers load guides that invoke detail view; not inlined in router
		expect(getFlowGuidance("flow-run").content).toContain(
			'flow_status { request: { view: "detail" } }',
		);
	});

	test("fits the manager command stack inside its byte budget", () => {
		const auto = compileFlowPromptSurface("flow-auto");
		const combined = [
			auto,
			getFlowGuidance("flow-plan").content,
			getFlowGuidance("flow-run").content,
		].join("\n");
		expect(byteLength(combined)).toBeLessThanOrEqual(
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
		expect(byteLength(realCommandStack)).toBeLessThanOrEqual(
			MAX_MANAGER_PROMPT_BYTES,
		);
	});

	test("keeps the total shipped prompt footprint under its ceiling", () => {
		const total = SURFACES.reduce(
			(sum, surface) => sum + byteLength(compileFlowPromptSurface(surface)),
			0,
		);
		expect(total).toBeLessThanOrEqual(MAX_TOTAL_PROMPT_BYTES);
	});

	test("reserves absolute rules for true invariants", () => {
		for (const surface of SURFACES) {
			const count = (
				compileFlowPromptSurface(surface).match(ABSOLUTE_RULE_PATTERN) ?? []
			).length;
			expect(count, `${surface} absolute-rule markers`).toBeLessThanOrEqual(
				MAX_ABSOLUTE_RULES[surface],
			);
		}
	});

	test("states each rule once instead of restating it across surfaces", () => {
		// The shared kernel is intentionally identical wherever it appears, so it
		// is excluded; every remaining pair is an unintended restatement.
		const entries = SURFACES.flatMap((surface) =>
			sentences(
				compileFlowPromptSurface(surface).split(FLOW_MANAGER_KERNEL).join(" "),
			).map((sentence) => ({
				surface,
				sentence,
				tokens: contentTokens(sentence),
			})),
		);

		const pairs: string[] = [];
		for (let left = 0; left < entries.length; left += 1) {
			for (let right = left + 1; right < entries.length; right += 1) {
				const a = entries[left];
				const b = entries[right];
				if (!a || !b || a.surface === b.surface) continue;
				if (jaccard(a.tokens, b.tokens) >= NEAR_DUPLICATE_THRESHOLD) {
					pairs.push(
						`${a.surface} <-> ${b.surface}: ${a.sentence.slice(0, 90)}`,
					);
				}
			}
		}
		expect(pairs.length, pairs.join("\n")).toBeLessThanOrEqual(
			MAX_NEAR_DUPLICATE_PAIRS,
		);
	});
});
