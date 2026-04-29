import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { compareStoredAuditReports } from "../src/runtime/audit-compare";
import {
	normalizeAuditReport,
	writeAuditReport,
} from "../src/runtime/audit-report";
import { AuditReportSchema } from "../src/runtime/schema";
import { setNowIsoOverride } from "../src/runtime/util";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-audit-report-");

afterEach(() => {
	setNowIsoOverride(null);
	cleanupTempDirs();
});

function sampleAuditReportInput() {
	return {
		requestedDepth: "full_audit" as const,
		achievedDepth: "deep_audit" as const,
		repoSummary: "Reviewed the prompt and command surfaces directly.",
		overallVerdict: "Deep audit with one remaining coverage gap.",
		discoveredSurfaces: [
			{
				name: "prompt surfaces",
				category: "source_runtime" as const,
				reviewStatus: "directly_reviewed" as const,
				evidence: ["src/prompts/agents.ts:1-100"],
			},
			{
				name: "runtime tool tests",
				category: "tests" as const,
				reviewStatus: "unreviewed" as const,
				reason: "Coverage deferred for a follow-up pass.",
				evidence: [],
			},
		],
		validationRun: [
			{
				command: "bun run check",
				status: "not_run" as const,
				summary: "The audit stayed read-only.",
			},
		],
		findings: [
			{
				title: "Coverage remains incomplete.",
				category: "process_gap" as const,
				confidence: "confirmed" as const,
				severity: "medium" as const,
				evidence: ["src/prompts/contracts.ts:1-120"],
				impact: "The audit cannot honestly claim full coverage yet.",
				remediation:
					"Inspect the remaining runtime test surfaces before claiming full_audit.",
			},
		],
		nextSteps: ["Inspect the remaining runtime test surfaces."],
	};
}

describe("audit report contracts", () => {
	test("normalizeAuditReport derives coverage sections and full-audit blockers from discovered surfaces", () => {
		const normalized = normalizeAuditReport(sampleAuditReportInput());

		expect(normalized.coverageSummary).toEqual({
			discoveredSurfaceCount: 2,
			reviewedSurfaceCount: 1,
			unreviewedSurfaceCount: 1,
			notes: ["Coverage rubric was normalized from discoveredSurfaces."],
		});
		expect(normalized.reviewedSurfaces).toEqual([
			{
				name: "prompt surfaces",
				evidence: ["src/prompts/agents.ts:1-100"],
			},
		]);
		expect(normalized.unreviewedSurfaces).toEqual([
			{
				name: "runtime tool tests",
				reason: "Coverage deferred for a follow-up pass.",
			},
		]);
		expect(normalized.coverageRubric.fullAuditEligible).toBe(false);
		expect(normalized.coverageRubric.unreviewedCategories).toEqual(["tests"]);
		expect(normalized.coverageRubric.blockingReasons).toEqual([
			"Unreviewed surfaces prevent full_audit: runtime tool tests.",
		]);
	});

	test("AuditReportSchema rejects unsupported full_audit claims when discovered surfaces are not all directly reviewed", () => {
		const normalized = normalizeAuditReport(sampleAuditReportInput());
		const invalid = {
			...normalized,
			achievedDepth: "full_audit",
		};

		expect(AuditReportSchema.safeParse(invalid).success).toBe(false);
	});

	test("compareStoredAuditReports summarizes deltas across depth, coverage, findings, and validation", () => {
		const left = {
			reportId: "20260429T100000.000",
			path: "/tmp/left/report.json",
			report: normalizeAuditReport(sampleAuditReportInput()),
		};
		const right = {
			reportId: "20260429T110000.000",
			path: "/tmp/right/report.json",
			report: normalizeAuditReport({
				...sampleAuditReportInput(),
				achievedDepth: "full_audit",
				overallVerdict: "Coverage completed.",
				discoveredSurfaces: [
					{
						name: "agent prompt surfaces",
						category: "source_runtime" as const,
						reviewStatus: "directly_reviewed" as const,
						evidence: [
							"src/prompts/agents.ts:1-100",
							"src/prompts/commands.ts:1-100",
						],
					},
					{
						name: "runtime tool tests",
						category: "tests" as const,
						reviewStatus: "directly_reviewed" as const,
						evidence: ["tests/runtime-tools.test.ts:1-200"],
					},
				],
				validationRun: [
					{
						command: "bun run check",
						status: "passed" as const,
						summary: "Verification completed.",
					},
				],
				findings: [
					{
						title: "Coverage gap remains visible.",
						category: "process_gap" as const,
						confidence: "confirmed" as const,
						severity: "medium" as const,
						evidence: ["src/prompts/contracts.ts:1-120"],
						impact: "The audit cannot honestly claim full coverage yet.",
						remediation:
							"Inspect the remaining runtime test surfaces before claiming full_audit.",
					},
				],
				nextSteps: [],
			}),
		};

		const comparison = compareStoredAuditReports(left, right);

		expect(comparison.depth.achievedChanged).toBe(true);
		expect(comparison.coverage.fullAuditEligibleChanged).toBe(true);
		expect(comparison.coverage.unreviewedSurfaceCountDelta).toBe(-1);
		expect(comparison.surfaces.added).toEqual([]);
		expect(comparison.surfaces.removed).toEqual([]);
		expect(comparison.surfaces.changed).toHaveLength(2);
		expect(comparison.surfaces.changed).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "prompt surfaces",
					fieldChanges: expect.arrayContaining(["name", "evidence"]),
					matchStrategy: "heuristic_match",
					matchReason: expect.stringContaining(
						"shared category 'source_runtime'",
					),
				}),
				expect.objectContaining({
					name: "runtime tool tests",
					fieldChanges: expect.arrayContaining([
						"reviewStatus",
						"evidence",
						"reason",
					]),
				}),
			]),
		);
		expect(comparison.findings.added).toEqual([]);
		expect(comparison.findings.removed).toEqual([]);
		expect(comparison.findings.changed).toHaveLength(1);
		expect(comparison.findings.changed).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "process_gap:Coverage remains incomplete.",
					fieldChanges: expect.arrayContaining(["title"]),
					matchStrategy: "heuristic_match",
					matchReason: expect.stringContaining("identical impact"),
					left: expect.objectContaining({
						title: "Coverage remains incomplete.",
					}),
					right: expect.objectContaining({
						title: "Coverage gap remains visible.",
					}),
				}),
			]),
		);
		expect(comparison.validation.changed).toEqual([
			expect.objectContaining({
				command: "bun run check",
				fieldChanges: expect.arrayContaining(["status", "summary"]),
			}),
		]);
		expect(comparison.nextStepsRemoved).toEqual([
			"Inspect the remaining runtime test surfaces.",
		]);
		expect(comparison.summary).toContain("depth or eligibility changed");
	});

	test("compareStoredAuditReports preserves duplicate-key entries instead of collapsing them", () => {
		const left = {
			reportId: "left",
			path: "/tmp/left/report.json",
			report: normalizeAuditReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Duplicate surface names are allowed.",
				overallVerdict: "Track both entries.",
				discoveredSurfaces: [
					{
						name: "duplicate surface",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/a.ts:1-10"],
					},
					{
						name: "duplicate surface",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/b.ts:1-10"],
					},
				],
				validationRun: [
					{
						command: "bun run check",
						status: "not_run",
						summary: "Read-only audit.",
					},
				],
				findings: [],
			}),
		};
		const right = {
			reportId: "right",
			path: "/tmp/right/report.json",
			report: normalizeAuditReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Duplicate surface names are allowed.",
				overallVerdict: "Track both entries.",
				discoveredSurfaces: [
					{
						name: "duplicate surface",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/a.ts:1-10"],
					},
					{
						name: "duplicate surface",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/c.ts:1-10"],
					},
				],
				validationRun: [
					{
						command: "bun run check",
						status: "not_run",
						summary: "Read-only audit.",
					},
				],
				findings: [],
			}),
		};

		const comparison = compareStoredAuditReports(left, right);

		expect(comparison.surfaces.added).toEqual([]);
		expect(comparison.surfaces.removed).toEqual([]);
		expect(comparison.surfaces.changed).toHaveLength(1);
		expect(comparison.surfaces.changed[0]).toEqual(
			expect.objectContaining({
				name: "duplicate surface",
				fieldChanges: expect.arrayContaining(["evidence"]),
				matchStrategy: "exact_key",
				matchReason: expect.stringContaining("identical surface name"),
			}),
		);
	});

	test("compareStoredAuditReports uses a stable tie-breaker for equally scored retitle candidates", () => {
		const left = {
			reportId: "left",
			path: "/tmp/left/report.json",
			report: normalizeAuditReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Retitle candidate.",
				overallVerdict: "Tie-break determinism matters.",
				discoveredSurfaces: [
					{
						name: "surface",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/a.ts:1-10"],
					},
				],
				validationRun: [
					{
						command: "bun run check",
						status: "not_run",
						summary: "Read-only audit.",
					},
				],
				findings: [
					{
						title: "Alpha finding",
						category: "process_gap",
						confidence: "confirmed",
						evidence: ["src/a.ts:1-10"],
						impact: "Same impact.",
					},
				],
			}),
		};
		const right = {
			reportId: "right",
			path: "/tmp/right/report.json",
			report: normalizeAuditReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Retitle candidate.",
				overallVerdict: "Tie-break determinism matters.",
				discoveredSurfaces: [
					{
						name: "surface",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/a.ts:1-10"],
					},
				],
				validationRun: [
					{
						command: "bun run check",
						status: "not_run",
						summary: "Read-only audit.",
					},
				],
				findings: [
					{
						title: "Zulu finding",
						category: "process_gap",
						confidence: "confirmed",
						evidence: ["src/a.ts:1-10"],
						impact: "Same impact.",
					},
					{
						title: "Beta finding",
						category: "process_gap",
						confidence: "confirmed",
						evidence: ["src/a.ts:1-10"],
						impact: "Same impact.",
					},
				],
			}),
		};

		const comparison = compareStoredAuditReports(left, right);

		expect(comparison.findings.changed).toHaveLength(1);
		expect(comparison.findings.changed[0]).toEqual(
			expect.objectContaining({
				matchStrategy: "heuristic_match",
				matchReason: expect.stringContaining("shared category 'process_gap'"),
				right: expect.objectContaining({ title: "Beta finding" }),
			}),
		);
		expect(comparison.findings.added).toEqual([
			expect.objectContaining({ title: "Zulu finding" }),
		]);
		expect(comparison.findings.removed).toEqual([]);
	});

	test("writeAuditReport persists normalized JSON and Markdown artifacts plus latest pointers", async () => {
		const worktree = makeTempDir();
		const written = await writeAuditReport(worktree, sampleAuditReportInput());

		expect(written.jsonPath).toBe(join(written.reportDir, "report.json"));
		expect(written.markdownPath).toBe(join(written.reportDir, "report.md"));
		await expect(readFile(written.jsonPath, "utf8")).resolves.toContain(
			'"coverageRubric"',
		);
		await expect(readFile(written.markdownPath, "utf8")).resolves.toContain(
			"# Flow Audit Report",
		);
		await expect(
			readFile(join(worktree, ".flow", "audits", "latest.json"), "utf8"),
		).resolves.toContain('"achievedDepth": "deep_audit"');
		await expect(
			readFile(join(worktree, ".flow", "audits", "latest.md"), "utf8"),
		).resolves.toContain("## Coverage");
	});

	test("writeAuditReport allocates a unique report directory when two writes share the same timestamp", async () => {
		const worktree = makeTempDir();
		setNowIsoOverride(() => "2026-04-29T12:34:56.789Z");

		const first = await writeAuditReport(worktree, sampleAuditReportInput());
		const second = await writeAuditReport(worktree, sampleAuditReportInput());

		expect(basename(first.reportDir)).toBe("20260429T123456.789");
		expect(basename(second.reportDir)).toBe("20260429T123456.789-1");
	});
});
