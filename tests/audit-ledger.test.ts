import { describe, expect, test } from "bun:test";
import {
	AUDIT_LEDGER_V1,
	type AuditFindingV1,
	AuditLedgerMarkdownBudgetError,
	type AuditLedgerV1,
	AuditLedgerV1Schema,
	auditLedgerSerializedUtf8Bytes,
	deriveAuditLedgerSummaryV1,
	MAX_AUDIT_LEDGER_UTF8_BYTES,
	parseAuditLedgerV1,
	reconcileAuditLedgerMarkdownV1,
	renderAuditLedgerMarkdownV1,
} from "../src/domain/audit-ledger.js";

function finding(overrides: Partial<AuditFindingV1> = {}): AuditFindingV1 {
	return {
		id: "E2E-01",
		title: "End-to-end validation can miss the broken branch",
		summary: "The broad command succeeds without exercising the failure path.",
		sourceLocators: [
			{ file: "src/runner.ts", symbol: "runValidation", line: 24, endLine: 31 },
		],
		proofState: "source_proven",
		reachability: "failure_path",
		deploymentContext: {
			exposure: "deployed",
			description: "Used by the normal project validation command.",
		},
		trigger: "The changed source enters the validation failure branch.",
		guardsAndRecovery: {
			effectiveness: "partial",
			evidence:
				"A targeted test detects the branch but the broad command does not.",
		},
		disposition: "confirmed",
		impact: {
			level: "major",
			description:
				"A release can claim validation without covering the changed path.",
		},
		severity: "high",
		actionPriority: "next",
		confidence: "high",
		falsifier: "Show that the broad command executes and asserts this branch.",
		remediation: "Add a targeted assertion to the existing end-to-end command.",
		...overrides,
	};
}

function refutedFinding(): AuditFindingV1 {
	const base = finding({
		id: "FRONT-04",
		title: "Frontend wrapper drops the requested route",
		summary: "Source inspection shows the route is preserved by the wrapper.",
		proofState: "source_proven",
		reachability: "normal_path",
		disposition: "refuted",
		impact: {
			level: "none",
			description:
				"The alleged behavior does not occur in the inspected source.",
		},
		severity: "informational",
		actionPriority: "none",
		confidence: "high",
		falsifier: "Provide a source-bound reproduction where the route is lost.",
	});
	const { remediation: _remediation, ...refuted } = base;
	return refuted;
}

function ledger(...findings: AuditFindingV1[]): AuditLedgerV1 {
	return { version: AUDIT_LEDGER_V1, findings };
}

describe("AuditLedgerV1", () => {
	test("accepts stable alphanumeric-hyphen ids including E2E-01", () => {
		const parsed = parseAuditLedgerV1(ledger(finding()));

		expect(parsed.findings[0]?.id).toBe("E2E-01");
		expect(
			AuditLedgerV1Schema.safeParse(ledger(finding({ id: "missing spaces" })))
				.success,
		).toBe(false);
		expect(
			AuditLedgerV1Schema.safeParse(ledger(finding({ id: " E2E-01" }))).success,
		).toBe(false);
	});

	test("derives summary counts instead of accepting a stored summary", () => {
		const value = ledger(finding(), refutedFinding());

		expect(deriveAuditLedgerSummaryV1(value)).toEqual({
			total: 2,
			actionable: 1,
			remediationItems: 1,
			byDisposition: {
				confirmed: 1,
				hardening: 0,
				measure_first: 0,
				deferred: 0,
				refuted: 1,
			},
			bySeverity: {
				critical: 0,
				high: 1,
				medium: 0,
				low: 0,
				informational: 1,
			},
			byActionPriority: { fix_now: 0, next: 1, backlog: 0, none: 1 },
			byProofState: {
				reproduced: 0,
				source_proven: 2,
				invariant_only: 0,
				external_assumption: 0,
				unverified: 0,
			},
		});
		expect(
			AuditLedgerV1Schema.safeParse({ ...value, summary: { total: 99 } })
				.success,
		).toBe(false);
	});

	test("excludes refuted FRONT-04 from remediation", () => {
		const markdown = renderAuditLedgerMarkdownV1(
			ledger(finding(), refutedFinding()),
		);
		const remediation = markdown.split("## Remediation\n", 2)[1] ?? "";

		expect(markdown).toContain("### FRONT-04 —");
		expect(remediation).toContain("### E2E-01 —");
		expect(remediation).not.toContain("FRONT-04");
	});

	test("rejects severity inflation and accepts an explicit downgrade", () => {
		const inflated = finding({
			proofState: "invariant_only",
			disposition: "hardening",
			impact: {
				level: "catastrophic",
				description:
					"The invariant is hypothesized to lose all persisted data.",
			},
			severity: "critical",
			actionPriority: "fix_now",
			confidence: "medium",
			guardsAndRecovery: {
				effectiveness: "none",
				evidence: "No guard is known, but the execution path is not proven.",
			},
		});
		expect(AuditLedgerV1Schema.safeParse(ledger(inflated)).success).toBe(false);

		const downgraded = finding({
			proofState: "invariant_only",
			disposition: "hardening",
			severity: "high",
			actionPriority: "next",
			confidence: "medium",
		});
		expect(AuditLedgerV1Schema.safeParse(ledger(downgraded)).success).toBe(
			true,
		);
	});

	test("rejects fix-now claims with unknown reachability or effective catastrophic guards", () => {
		const unknownContext = finding({
			reachability: "unknown",
			actionPriority: "fix_now",
		});
		expect(AuditLedgerV1Schema.safeParse(ledger(unknownContext)).success).toBe(
			false,
		);

		const guardedCatastrophe = finding({
			impact: {
				level: "catastrophic",
				description: "A successful exploit would destroy all persisted data.",
			},
			severity: "critical",
			actionPriority: "fix_now",
			guardsAndRecovery: {
				effectiveness: "effective",
				evidence: "An enforced transaction rolls back the entire operation.",
			},
		});
		expect(
			AuditLedgerV1Schema.safeParse(ledger(guardedCatastrophe)).success,
		).toBe(false);
	});

	test("rejects case-insensitive duplicate finding ids", () => {
		expect(
			AuditLedgerV1Schema.safeParse(
				ledger(finding({ id: "E2E-01" }), finding({ id: "e2e-01" })),
			).success,
		).toBe(false);
	});

	test("rejects absolute, traversal, and platform-specific source paths", () => {
		for (const file of [
			"/Users/example/src/runner.ts",
			"../src/runner.ts",
			"src/../runner.ts",
			"src/ runner.ts ",
			"C:\\project\\src\\runner.ts",
		]) {
			const unsafe = finding({ sourceLocators: [{ file, line: 1 }] });
			expect(AuditLedgerV1Schema.safeParse(ledger(unsafe)).success).toBe(false);
		}
	});

	test("renders canonical output deterministically without mutating input order", () => {
		const e2e = finding({
			sourceLocators: [
				{ file: "src/z-last.ts", line: 9 },
				{ file: "src/a-first.ts", symbol: "start", line: 2 },
			],
		});
		const input = ledger(refutedFinding(), e2e);
		const first = renderAuditLedgerMarkdownV1(input);
		const second = renderAuditLedgerMarkdownV1(ledger(e2e, refutedFinding()));

		expect(first).toBe(second);
		expect(first.indexOf("### E2E-01 —")).toBeLessThan(
			first.indexOf("### FRONT-04 —"),
		);
		expect(first.indexOf("`src/a-first.ts:2 — start`")).toBeLessThan(
			first.indexOf("`src/z-last.ts:9`"),
		);
		expect(input.findings[0]?.id).toBe("FRONT-04");
		expect(reconcileAuditLedgerMarkdownV1(input, first)).toEqual({
			valid: true,
			canonicalMarkdown: first,
			issues: [],
		});
	});

	test("rejects a ledger above the aggregate UTF-8 input budget", () => {
		const oversized = ledger(
			...Array.from({ length: 66 }, (_, index) =>
				finding({ id: `BUDGET-${index}`, summary: "x".repeat(3_400) }),
			),
		);

		const result = AuditLedgerV1Schema.safeParse(oversized);

		expect(result.success).toBe(false);
		if (result.success) throw new Error("expected aggregate budget rejection");
		expect(result.error.issues).toContainEqual(
			expect.objectContaining({
				path: [],
				message: `An AuditLedgerV1 cannot exceed ${MAX_AUDIT_LEDGER_UTF8_BYTES} UTF-8 bytes.`,
			}),
		);
	});

	test("measures the aggregate budget in UTF-8 bytes, not string length", () => {
		const multibyte = ledger(
			...Array.from({ length: 70 }, (_, index) =>
				finding({ id: `UTF8-${index}`, summary: "🚀".repeat(900) }),
			),
		);

		expect(JSON.stringify(multibyte).length).toBeLessThan(
			MAX_AUDIT_LEDGER_UTF8_BYTES,
		);
		expect(auditLedgerSerializedUtf8Bytes(multibyte)).toBeGreaterThan(
			MAX_AUDIT_LEDGER_UTF8_BYTES,
		);
		expect(AuditLedgerV1Schema.safeParse(multibyte).success).toBe(false);
	});

	test("fails cleanly when Markdown escaping exceeds the artifact budget", () => {
		const escapingExpansion = parseAuditLedgerV1(
			ledger(
				...Array.from({ length: 50 }, (_, index) =>
					finding({ id: `ESCAPE-${index}`, summary: "*".repeat(4_000) }),
				),
			),
		);

		expect(() => renderAuditLedgerMarkdownV1(escapingExpansion)).toThrow(
			AuditLedgerMarkdownBudgetError,
		);
		try {
			renderAuditLedgerMarkdownV1(escapingExpansion);
		} catch (error) {
			expect(error).toBeInstanceOf(AuditLedgerMarkdownBudgetError);
			expect(
				(error as AuditLedgerMarkdownBudgetError).byteLength,
			).toBeGreaterThan(MAX_AUDIT_LEDGER_UTF8_BYTES);
		}
	});

	test("reconciles missing ids, summary drift, and stale refuted remediation", () => {
		const value = ledger(refutedFinding());
		const canonical = renderAuditLedgerMarkdownV1(value);
		const stale = canonical
			.replace("- Total findings: 1", "- Total findings: 7")
			.replace("- Sources:", "- Remediation: Delete the wrapper.\n- Sources:")
			.replace(
				"No remediation items.",
				"### FRONT-04 — Frontend wrapper drops the requested route\n\nDelete the wrapper.",
			);

		const staleResult = reconcileAuditLedgerMarkdownV1(value, stale);
		const staleCodes = staleResult.issues.map((issue) => issue.code);
		const missingResult = reconcileAuditLedgerMarkdownV1(
			value,
			canonical.replace("### FRONT-04 —", "### Missing id —"),
		);
		const missingCodes = missingResult.issues.map((issue) => issue.code);

		expect(staleResult.valid).toBe(false);
		expect(staleCodes).toContain("summary_count_drift");
		expect(staleCodes).toContain("refuted_in_remediation");
		expect(staleCodes).toContain("stale_refuted_remediation");
		expect(staleCodes).toContain("non_canonical_markdown");
		expect(missingResult.valid).toBe(false);
		expect(missingCodes).toContain("invalid_finding_heading");
		expect(missingCodes).toContain("missing_finding_id");
	});
});
