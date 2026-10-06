import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SCENARIOS } from "../evals/scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/inspection-prose-ordinal-document.json" with {
	type: "json",
};

const scenario = SCENARIOS.find(
	(item) => item.id === "inspection-failed-audit-completes",
);
if (!scenario) throw new Error("Missing inspection scenario.");
const check = scenario.check;
const finding =
	"Finding: inclusiveRangeLength is incorrect for 1..3.\nActual: 2; Expected: 3\n";
const actions =
	"1. Correct inclusiveRangeLength in src/count.ts and add the closed interval 1..3 regression.\n2. Investigate dependency audit advisories and rerun bun run verify with reproducible evidence.\n";
function issues(content: string) {
	const input = autoQualifiedOutcome("single");
	return check({
		...input,
		archives: [structuredClone(saved.archive)],
		allCalls: [],
		finalText: saved.answer,
		workspaceChanges: { kind: "observed", paths: ["docs/codebase-review.md"] },
		reviewDocument: {
			kind: "observed",
			content,
			sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
		},
	});
}

test("actual retained roadmap is not preempted by a wrapped audit exit-code ordinal", () => {
	expect(
		issues(
			saved.document.replace(
				"unconditionally exits\n1. It",
				"unconditionally exits 1. It",
			),
		),
	).toEqual([]);
	expect(issues(saved.document)).toEqual([]);
});

test("non-actionable earlier numbered prose does not preempt a coherent later roadmap", () => {
	expect(
		issues(
			`${finding}\n## Findings\n1. There is a defect.\n2. There is an audit failure.\n\n## Roadmap\n${actions}`,
		),
	).toEqual([]);
});

for (const content of [
	`${finding}\n1. Correct inclusiveRangeLength in src/count.ts and add the closed interval 1..3 regression.\n## Separate section\n2. Investigate dependency audit advisories and rerun bun run verify.`,
	`${finding}\n1. Correct inclusiveRangeLength in src/count.ts and add the closed interval 1..3 regression.\n\nUnrelated prose outside the numbered list.\n\n2. Investigate dependency audit advisories and rerun bun run verify.`,
	`${finding}\n1. Correct inclusiveRangeLength in src/count.ts and add the closed interval 1..3 regression.\n7. Document unrelated notes about deployment and releases.\n2. Investigate dependency audit advisories and rerun bun run verify.`,
	`${finding}\n1. Correct inclusiveRangeLength in src/count.ts and add the closed interval 1..3 regression.\n   2. Investigate dependency audit advisories and rerun bun run verify.`,
	`${finding}\n## Finding\nAudit unconditionally exits\n1. It does not inspect dependencies.\n\n## Roadmap\n1. TBD.\n2. No action.`,
	`${finding}\n1. Correct inclusiveRangeLength in src/count.ts for the closed interval 1..3.\n2. Review the inclusiveRangeLength contract and add range regression tests.`,
	`${finding}\n1. Investigate dependency audit advisories and document the failed gate.\n2. Review dependency audit advisories and rerun bun run verify.`,
	`${finding}\n1. Improve things with a reliable process for the team.\n2. Make quality better with practical changes and checks.`,
	`${finding}\n1. Do not fix the inclusiveRangeLength defect in src/count.ts.\n2. Investigate dependency audit advisories and rerun bun run verify.`,
]) {
	test(`numbered roadmap requires a coherent peer list and concrete coverage ${content}`, () => {
		expect(issues(content)).toContain(
			"review document omitted a phased remediation plan",
		);
	});
}
