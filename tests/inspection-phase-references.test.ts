import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SCENARIOS } from "../evals/scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/inspection-phase-reference-document.json" with {
	type: "json",
};

const scenario = SCENARIOS.find(
	(item) => item.id === "inspection-failed-audit-completes",
);
if (!scenario) throw new Error("Missing inspection scenario.");
const check = scenario.check;
const finding =
	"Finding: inclusiveRangeLength is incorrect for 1..3.\nActual: 2; Expected: 3\n";
const rangeAction =
	"Correct inclusiveRangeLength in src/count.ts and add the closed interval 1..3 regression.";
const auditAction =
	"Investigate dependency audit advisories and rerun bun run verify with reproducible evidence.";
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

test("actual retained roadmap ignores a wrapped narrative reference before its real Phase 2 heading", () => {
	expect(issues(saved.document)).toEqual([]);
	expect(
		issues(
			saved.document.replace(
				"until\n  Phase 2 is validated.",
				"until Phase 2 is validated.",
			),
		),
	).toEqual([]);
});

for (const reference of [
	"Phase 2 is validated.",
	"Step 2 is validated.",
	"Phase two is documented.",
]) {
	test(`body reference cannot preempt coherent phase headings ${reference}`, () => {
		expect(
			issues(
				`${finding}\n## Roadmap\n### Phase 1: Range\n${rangeAction}\nAcceptance remains pending until\n  ${reference}\n### Phase 2: Audit\n${auditAction}\n`,
			),
		).toEqual([]);
	});
}

test("incomplete earlier named phases cannot preempt a later complete coherent pair", () => {
	expect(
		issues(
			`${finding}\n## Earlier notes\n### Phase 1: Notes\nTBD.\n### Phase 2: Notes\nNo action.\n## Roadmap\n### Phase 1: Range\n${rangeAction}\n### Phase 2: Audit\n${auditAction}\n`,
		),
	).toEqual([]);
});

for (const content of [
	`## Range\n### Phase 1: Repair\n${rangeAction}\n## Unrelated audit\n### Phase 2: Triage\n${auditAction}`,
	`## Roadmap\n### Phase 1: Range\n${rangeAction}\n#### Phase 2: Audit\n${auditAction}`,
	`## Roadmap\n### Phase 1: Range\n${rangeAction}\n### Phase 2: No action\nDo not investigate dependency audit advisories or run bun run verify.`,
	`## Roadmap\n### Phase 1: Range\n${rangeAction}\n### Phase 2: Range\nReview inclusiveRangeLength and add closed interval regression tests.\n## Disposition\n${auditAction}`,
	`## Roadmap\nPhase 1 is validated.\n${rangeAction}\nPhase 2 is validated.\n${auditAction}`,
]) {
	test(`phase candidates require peer sections, genuine markers and bounded actionable coverage ${content}`, () => {
		expect(issues(`${finding}\n${content}\n`)).toContain(
			"review document omitted a phased remediation plan",
		);
	});
}

test("bare delimited phase labels remain actionable markers", () => {
	expect(
		issues(`${finding}\nPhase 1: ${rangeAction}\nPhase 2: ${auditAction}\n`),
	).toEqual([]);
});

test("bare Phase 3 audit actions cannot supply coverage to range-only Phase 1 and Phase 2", () => {
	const content = `${finding}\nPhase 1: ${rangeAction}\nPhase 2: Review inclusiveRangeLength and add closed interval regression tests.\nPhase 3: ${auditAction}\n`;
	expect(issues(content)).toContain(
		"review document omitted a phased remediation plan",
	);
});
