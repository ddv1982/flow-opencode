import { describe, expect, test } from "bun:test";
import { normalizeReviewReport } from "../../src/audit/report-normalizer";
import { renderReviewReport } from "../../src/audit/report-presenter";
import { ReviewReportSchema } from "../../src/audit/report-schema";

const reviewTarget = {
	repoRoot: "/Users/vriesd/projects/soft-focus",
	repoName: "soft-focus",
	gitHead: "abc1234",
	gitBranch: "main",
	generatedAt: "2026-06-01T12:00:00Z",
	invokedFromCwd: "/Users/vriesd/projects/soft-focus",
};

const baseReport = {
	reviewTarget,
	requestedDepth: "deep_audit" as const,
	achievedDepth: "deep_audit" as const,
	repoSummary: "Soft-focus review summary.",
	overallVerdict: "No confirmed release blocker was found.",
	discoveredSurfaces: [
		{
			name: "Navigation runtime",
			category: "source_runtime" as const,
			reviewStatus: "directly_reviewed" as const,
			evidence: ["src/game/navigation.ts:65-71"],
		},
	],
	contextArtifacts: [
		{
			kind: "file_map" as const,
			repoRoot: reviewTarget.repoRoot,
			source: "review packet",
			summary: "soft-focus file map",
		},
	],
	validationRun: [
		{
			command: "bun run validate",
			status: "passed" as const,
			summary: "typecheck, smoke tests, and production build passed.",
		},
	],
	findings: [
		{
			title:
				"Navigation state can be recorded before Phaser transition succeeds",
			category: "risk" as const,
			confidence: "likely" as const,
			severity: "medium" as const,
			primaryLocation: {
				path: "src/game/navigation.ts",
				startLine: 65,
				endLine: 71,
			},
			relatedLocations: [
				{
					path: "src/dom/setupShell.ts",
					startLine: 136,
					reason: "DOM setup also mutates scene/session state.",
				},
			],
			evidence: [
				"src/game/navigation.ts:65-71 updates session state before scene.start().",
			],
			impact:
				"Persisted session state can imply a scene transition happened even if navigation fails or is interrupted.",
			remediation:
				"Centralize navigation/session coordination and commit persisted scene state after successful transition.",
		},
	],
};

describe("audit report provenance", () => {
	test("review target and structured finding locations render visibly", () => {
		const report = ReviewReportSchema.parse(baseReport);
		const rendered = renderReviewReport(normalizeReviewReport(report), "human");

		expect(rendered).toContain("## Review target");
		expect(rendered).toContain("- Repository: soft-focus");
		expect(rendered).toContain("- Root: /Users/vriesd/projects/soft-focus");
		expect(rendered).toContain("- Commit: abc1234");
		expect(rendered).toContain("- Context artifacts:");
		expect(rendered).toContain(
			"  - file_map: /Users/vriesd/projects/soft-focus (review packet) — soft-focus file map",
		);
		expect(rendered).toContain(
			"- Primary location: src/game/navigation.ts:65-71",
		);
		expect(rendered).toContain("- Related locations:");
		expect(rendered).toContain(
			"  - src/dom/setupShell.ts:136 — DOM setup also mutates scene/session state.",
		);
	});

	test("context artifacts require reviewTarget so provenance can be validated", () => {
		const { reviewTarget: _reviewTarget, ...reportWithoutTarget } = baseReport;
		const parsed = ReviewReportSchema.safeParse(reportWithoutTarget);

		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
			"reviewTarget is required when contextArtifacts are present so artifact provenance can be validated.",
		);
	});

	test("context artifacts cannot point at a different repository than reviewTarget", () => {
		const parsed = ReviewReportSchema.safeParse({
			...baseReport,
			contextArtifacts: [
				{
					kind: "file_map",
					repoRoot: "/Users/vriesd/projects/flow-opencode",
					summary: "wrong file map",
				},
			],
		});

		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
			"Context artifacts must use the same repoRoot as reviewTarget so file maps and evidence cannot silently refer to another repository.",
		);
	});

	test("finding locations must be safe relative paths", () => {
		for (const path of [
			"/Users/vriesd/projects/soft-focus/src/game/navigation.ts",
			"../soft-focus/src/game/navigation.ts",
			"file:///Users/vriesd/projects/soft-focus/src/game/navigation.ts",
		]) {
			const parsed = ReviewReportSchema.safeParse({
				...baseReport,
				findings: [
					{
						...baseReport.findings[0],
						primaryLocation: {
							path,
							startLine: 1,
						},
					},
				],
			});

			expect(parsed.success).toBe(false);
			expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
				"Source paths must be relative to the reviewed repository root and must not traverse outside it.",
			);
		}
	});
});
