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

test("an earlier actionable count-only pair cannot preempt a later complete roadmap", () => {
	const incomplete =
		"1. Correct inclusiveRangeLength in src/count.ts for the closed interval 1..3.\n2. Review inclusiveRangeLength and add closed interval regression tests.\n";
	expect(
		issues(
			`${finding}\n## Count notes\n${incomplete}\n## Complete roadmap\n${actions}`,
		),
	).toEqual([]);
});

test("phase two cannot borrow audit coverage from unindented prose after the numbered list", () => {
	const content = `${finding}\n1. Correct inclusiveRangeLength in src/count.ts and add the closed interval 1..3 regression.\n2. Review inclusiveRangeLength and add closed interval regression tests.\n\nInvestigate dependency audit advisories and rerun bun run verify with reproducible evidence.\n`;
	expect(issues(content)).toContain(
		"review document omitted a phased remediation plan",
	);
});

test("peer roadmap phases retain numbered substeps in both phase bodies", () => {
	const content = `${finding}\n## Roadmap\n1. **Range actions.**\n   1. Correct inclusiveRangeLength in src/count.ts for closed interval 1..3.\n   2. Add singleton and closed interval regression tests to count.ts coverage.\n2. **Audit actions.**\n   1. Investigate dependency audit advisories and retained failure evidence.\n   2. Run bun run verify after documenting advisory provenance and remediation.\n3. Document the resulting validation process and retain its evidence.\n`;
	expect(issues(content)).toEqual([]);
});

for (const separator of [
	"7. Document unrelated release notes.",
	"## Separate section",
	"Unrelated prose outside the numbered list.",
]) {
	test(`nested substeps do not hide a peer phase boundary ${separator}`, () => {
		const content = `${finding}\n1. Correct inclusiveRangeLength in src/count.ts for closed interval 1..3.\n   1. Add singleton and closed interval regression tests.\n${separator}\n2. Investigate dependency audit advisories and rerun bun run verify.\n   1. Document advisory provenance and retain audit evidence.\n`;
		expect(issues(content)).toContain(
			"review document omitted a phased remediation plan",
		);
	});
}

test("outdented ancestor items stop nested peer phase pairing", () => {
	const content = `${finding}\n   1. Correct inclusiveRangeLength in src/count.ts for closed interval 1..3.\n      1. Add singleton and closed interval regression tests.\n9. Document unrelated release notes.\n   2. Investigate dependency audit advisories and rerun bun run verify.\n`;
	expect(issues(content)).toContain(
		"review document omitted a phased remediation plan",
	);
});

for (const boundary of [
	"7. Investigate dependency audit advisories and rerun bun run verify.",
	"## Unrelated audit notes\nInvestigate dependency audit advisories and rerun bun run verify.",
	"Investigate dependency audit advisories and rerun bun run verify.",
]) {
	test(`phase-two nested body cannot borrow coverage beyond ${boundary}`, () => {
		const content = `${finding}\n1. Correct inclusiveRangeLength in src/count.ts for closed interval 1..3.\n   1. Add singleton and closed interval regression tests.\n2. Review inclusiveRangeLength in src/count.ts for closed interval 1..3.\n   1. Add singleton and closed interval regression tests.\n${boundary}\n`;
		expect(issues(content)).toContain(
			"review document omitted a phased remediation plan",
		);
	});
}

test("phase-two nested body stops at an outdented ancestor item", () => {
	const content = `${finding}\n   1. Correct inclusiveRangeLength in src/count.ts for closed interval 1..3.\n      1. Add singleton and closed interval regression tests.\n   2. Review inclusiveRangeLength in src/count.ts for closed interval 1..3.\n      1. Add singleton and closed interval regression tests.\n9. Investigate dependency audit advisories and rerun bun run verify.\n`;
	expect(issues(content)).toContain(
		"review document omitted a phased remediation plan",
	);
});
