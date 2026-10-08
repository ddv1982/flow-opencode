import { expect, test } from "bun:test";
import { missingAssuranceDisclosures } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { getFlowGuidance } from "../src/guidance/catalog.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-flow-zero-count-answer.json" with {
	type: "json",
};

const actual =
	"Implemented in `src/parser.mjs`:\n\n```js\nexport function parse(input) { return input === null ? '' : input.trim(); }\n```\n\n- `parse(null)` returns `''`; strings retain trimming behavior.\n- Only `src/parser.mjs` changed. `scripts/verify.mjs` remains unchanged.\n- Validation: `node scripts/verify.mjs` passed with exit code **0**.\n- Independent review passed with **no findings**.\n\n### Flow completion\nGoal: Make parse(input) safely handle null and preserve trimmed strings, changing only src/parser.mjs and keeping node scripts/verify.mjs and its script unchanged.\n\nSession completed and archived: **1 of 1 features complete**, no unfinished features or blockers. Assurance: **completion supported**, with all four assurance checks satisfied. External action authority: not granted.\n\nAssurance limitations:\n- Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.\n- Scope, requirement coverage, test adequacy, and review substance remain model judgments.\n- Freshness holds when review is accepted; the archive does not attest the current workspace.";
const partial =
	"Scope, requirement coverage, test adequacy, and review substance remain model judgments.";
const complete =
	"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.";
const freshness =
	"Freshness holds when review is accepted; the archive does not attest the current workspace.";
const canonicalFreshness = freshness.replace("the archive", "an archive");
const coverageIssue =
	"Missing assurance disclosure: coverage and review substance remain model judgments.";
const freshnessIssue =
	"Missing assurance disclosure: accepted evidence does not attest later workspace changes.";
const conflict = "Assurance disclosures contain a conflicting current claim.";
const expected = {
	closure: "completed" as const,
	presentation: "summary" as const,
	gate: "node scripts/verify.mjs",
	allowedPaths: ["src/parser.mjs"],
};
function fixture(finalText: string) {
	const input = autoQualifiedOutcome("single", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (!close || typeof close.output !== "object" || close.output === null)
		throw new Error("Missing close fixture.");
	const data = (close.output as { workflowData: { delivery: unknown } })
		.workflowData;
	data.delivery = structuredClone(saved.delivery);
	return { ...input, finalText };
}

test("unchanged retained handoff still rejects its genuinely omitted model judgments", () => {
	expect(deliveryIssues(fixture(actual), expected)).toEqual([coverageIssue]);
});
test("complete judgment topics and definite archive compose in whole checker", () => {
	expect(
		deliveryIssues(fixture(actual.replace(partial, complete)), expected),
	).toEqual([]);
});
test("canonical archive article still accepts complete handoff", () => {
	expect(
		deliveryIssues(
			fixture(
				actual
					.replace(partial, complete)
					.replace(freshness, canonicalFreshness),
			),
			expected,
		),
	).toEqual([]);
});
for (const topic of ["Goal alignment, ", "evidence completeness, "]) {
	test(`Goal line cannot replace the omitted disclosure ${topic}`, () => {
		expect(
			missingAssuranceDisclosures(
				actual
					.replace(partial, complete.replace(topic, ""))
					.replace(freshness, canonicalFreshness),
			),
		).toEqual([coverageIssue]);
	});
}
for (const invalid of [
	"Freshness holds when review is accepted; the archive attests the current workspace.",
	"Freshness will hold when review is accepted; the archive does not attest the current workspace.",
	"Freshness holds when review is accepted; the archive does not attest the current workspace if validation passes.",
	"Freshness holds when review is accepted; the archive does not attest the current workspace or authorize release.",
]) {
	test(`freshness remains closed and truthful ${invalid}`, () => {
		expect(
			missingAssuranceDisclosures(
				actual.replace(partial, complete).replace(freshness, invalid),
			),
		).toContain(freshnessIssue);
	});
}
for (const ignored of [
	`Example: "${freshness}"`,
	`## Historical handoff\n${freshness}`,
	`Goal: ${freshness}`,
]) {
	test(`freshness cannot be supplied in ignored scope ${ignored}`, () => {
		expect(
			missingAssuranceDisclosures(
				actual.replace(partial, complete).replace(`- ${freshness}`, ignored),
			),
		).toContain(freshnessIssue);
	});
}
for (const statement of [canonicalFreshness, freshness]) {
	test(`Markdown blockquote formatting preserves visible disclosure ${statement}`, () => {
		expect(
			missingAssuranceDisclosures(
				actual
					.replace(partial, complete)
					.replace(`- ${freshness}`, `> ${statement}`),
			),
		).toEqual([]);
	});
}
test("valid definite archive disclosure does not hide contradictory current claim", () => {
	expect(
		missingAssuranceDisclosures(
			`${actual.replace(partial, complete)}\nThe archive attests the current workspace.`,
		),
	).toEqual([conflict]);
});
for (const id of ["flow", "flow-plan", "flow-run"] as const) {
	test(`delivered ${id} guidance preserves each supplied limitation unchanged`, () => {
		const guidance = getFlowGuidance(id).content.replace(/\s+/g, " ");
		expect(guidance).toContain(
			"Copy each supplied `workflowData.delivery.assurance.limitations` statement unchanged, including its full topic list.",
		);
		expect(guidance).toContain("`workflowData.delivery.summary.lines`");
		expect(guidance).toMatch(
			/For requested full detail or a missing summary, (?:use|report) the retained close response's `report`\./,
		);
	});
}

for (const id of ["flow", "flow-plan", "flow-run"] as const) {
	test(`loaded ${id} guidance hands off the canonical summary without competing restatements`, () => {
		const guidance = getFlowGuidance(id).content.replace(/\s+/g, " ");
		expect(guidance).toContain(
			"Copy `workflowData.delivery.summary.lines` unchanged as one block.",
		);
		expect(guidance).toContain(
			"Implementation details may precede the block. Do not rewrite or restate its facts elsewhere.",
		);
	});
}
