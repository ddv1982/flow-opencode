import { afterEach, describe, expect, test } from "bun:test";
import {
	createTempDirRegistry,
	createTestTools,
	reviewFinding,
	reviewSurface,
	sampleReviewReport,
	toolContext,
	validationEntry,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

async function renderReview(
	tools: ReturnType<typeof createTestTools>,
	reviewJson: ReturnType<typeof sampleReviewReport>,
	view?: "human" | "structured" | "both",
) {
	return JSON.parse(
		await tools.flow_review_render.execute(
			view
				? { reviewJson: JSON.stringify(reviewJson), view }
				: { reviewJson: JSON.stringify(reviewJson) },
			{ worktree: "unused-review-render-worktree" },
		),
	);
}

describe("runtime review rendering", () => {
	test("flow_review_render returns a deterministic human-readable report by default", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				repoSummary:
					"csv-align has a shared Rust backend and web/desktop frontends.",
				overallVerdict:
					"This is a release blocker because decimal rounding mismatches the UI contract.",
				discoveredSurfaces: [
					reviewSurface({
						name: "Backend runtime",
						evidence: ["src/main.rs:10-37"],
					}),
				],
				coverageNotes: [
					"Detailed review achieved; no shell validation was run.",
				],
				validationRun: [validationEntry({ command: "cargo test" })],
				findings: [
					reviewFinding({
						title: "Decimal-rounding contract mismatch",
						category: "confirmed_defect",
						confidence: "confirmed",
						severity: "medium",
						evidence: [
							"frontend/src/components/NormalizationPanel.tsx:107-110",
							"src/comparison/value_compare.rs:156-203",
						],
						impact:
							"Users can get false matches from misleading decimal-place semantics.",
						remediation:
							"Make backend rounding match the UI contract or rename the UI behavior.",
					}),
				],
				nextSteps: [
					"Fix the decimal-rounding contract first.",
					"Run validation once the fix is in place.",
				],
			}),
		);
		expect(parsed.status).toBe("ok");
		expect(parsed.view).toBe("human");
		expect(parsed.report).toContain("## Conclusion");
		expect(parsed.report).toContain("## Top findings");
		expect(parsed.report).toContain("## Recommended next actions");
		expect(parsed.report).toContain("## Coverage notes");
		expect(parsed.report).toContain("Decimal-rounding contract mismatch");
		expect(parsed.report).toContain("confirmed defect");
		expect(parsed.report).toContain("confidence: confirmed");
		expect(parsed.report).toContain(
			"Overall verdict: This is a release blocker because decimal rounding mismatches the UI contract.",
		);
		expect(parsed.report).toContain(
			"Recommendation: Not ready to ship until 'Decimal-rounding contract mismatch' is addressed.",
		);
	});

	test("flow_review_render downgrades unsupported full_audit claims when coverage is incomplete", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "full_audit",
				achievedDepth: "full_audit",
				repoSummary: "Repo summary.",
				overallVerdict: "Review is still in progress.",
				discoveredSurfaces: [
					reviewSurface({
						name: "Frontend tests",
						category: "tests",
						reviewStatus: "spot_checked",
						evidence: ["frontend/src/App.test.tsx:1-20"],
						reason: "Representative tests were spot-checked only.",
					}),
				],
				coverageNotes: [],
				validationRun: [],
				findings: [],
			}),
		);
		expect(parsed.report).toContain("Achieved depth: broad review");
		expect(parsed.report).toContain(
			"Achieved depth was downgraded from full_audit because these major surface categories were not directly reviewed with evidence:",
		);
	});

	test("flow_review_render rejects directly reviewed surfaces without evidence", async () => {
		const tools = createTestTools();
		const report = sampleReviewReport({
			requestedDepth: "full_audit",
			achievedDepth: "full_audit",
			discoveredSurfaces: [
				reviewSurface({
					reviewStatus: "directly_reviewed",
					evidence: undefined,
				}),
			],
		});

		const response = await tools.flow_review_render.execute(
			{ reviewJson: JSON.stringify(report) },
			toolContext(makeTempDir()),
		);
		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("Review report validation failed");
		expect(parsed.summary).toContain(
			"Directly reviewed surfaces require at least one evidence reference.",
		);
	});

	test("flow_review_render rejects findings without evidence", async () => {
		const tools = createTestTools();
		const report = sampleReviewReport({
			discoveredSurfaces: [reviewSurface()],
			findings: [reviewFinding({ evidence: [] })],
		});

		const response = await tools.flow_review_render.execute(
			{ reviewJson: JSON.stringify(report) },
			toolContext(makeTempDir()),
		);
		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("Review report validation failed");
		expect(parsed.summary).toContain("findings");
		expect(parsed.summary).toContain("evidence");
	});

	test("flow_review_render rejects semantically inconsistent finding taxonomy", async () => {
		const tools = createTestTools();
		const invalidReports = [
			{
				report: sampleReviewReport({
					discoveredSurfaces: [reviewSurface()],
					findings: [
						reviewFinding({
							category: "confirmed_defect",
							confidence: "likely",
						}),
					],
				}),
				message: "Confirmed defects require confidence: confirmed",
			},
			{
				report: sampleReviewReport({
					discoveredSurfaces: [reviewSurface()],
					findings: [
						reviewFinding({
							category: "hardening_opportunity",
							severity: "high",
						}),
					],
				}),
				message: "Hardening opportunities cannot use high severity",
			},
			{
				report: sampleReviewReport({
					discoveredSurfaces: [reviewSurface()],
					findings: [
						reviewFinding({
							confidence: "speculative",
							severity: "high",
						}),
					],
				}),
				message: "High-severity findings cannot be speculative",
			},
		];

		for (const invalidReport of invalidReports) {
			const response = await tools.flow_review_render.execute(
				{ reviewJson: JSON.stringify(invalidReport.report) },
				toolContext(makeTempDir()),
			);
			const parsed = JSON.parse(response);
			expect(parsed.status).toBe("error");
			expect(parsed.summary).toContain("Review report validation failed");
			expect(parsed.summary).toContain(invalidReport.message);
		}
	});

	test("flow_review_render synthesizes an explicit not_run validation note when no validation evidence is recorded", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Repo summary.",
				overallVerdict: "Review remains read-only.",
				discoveredSurfaces: [],
				coverageNotes: [],
				validationRun: [],
				findings: [],
			}),
		);
		expect(parsed.report).toContain("- Validation status:");
		expect(parsed.report).toContain(
			"- not_run: No validation evidence was recorded for this review.",
		);
	});

	test("flow_review_render includes synthesized not_run validation in structured output", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				validationRun: [],
			}),
			"structured",
		);
		const structured = JSON.parse(parsed.report);

		expect(structured.validationRun).toEqual([
			{
				command: "not_run",
				status: "not_run",
				summary: "No validation evidence was recorded for this review.",
			},
		]);
	});

	test("flow_review_render requires all major categories before full_audit remains eligible", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "full_audit",
				achievedDepth: "full_audit",
				discoveredSurfaces: [
					reviewSurface({
						name: "Runtime",
						category: "source_runtime",
						evidence: ["src/runtime/session.ts:1"],
					}),
					reviewSurface({
						name: "Tests",
						category: "tests",
						evidence: ["tests/runtime-tools.test.ts:1"],
					}),
					reviewSurface({
						name: "CI",
						category: "ci_release",
						evidence: [".github/workflows/ci.yml:1"],
					}),
					reviewSurface({
						name: "Docs",
						category: "docs_config",
						evidence: ["README.md:1"],
					}),
					reviewSurface({
						name: "Tooling",
						category: "tooling",
						evidence: ["package.json:1"],
					}),
				],
				validationRun: [],
			}),
		);

		expect(parsed.report).toContain("Achieved depth: exhaustive review");
		expect(parsed.report).toContain("- Full audit eligible: yes");
		expect(parsed.report).not.toContain("Missing full-audit major categories");
	});

	test("flow_review_render preserves reviewer-authored risk wording while keeping risk recommendations", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary:
					"desktop-app has a webview shell and local command bridge.",
				overallVerdict: "This is a security flaw in desktop mode.",
				discoveredSurfaces: [
					reviewSurface({
						name: "Desktop runtime",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src-tauri/tauri.conf.json:10-11"],
					}),
				],
				coverageNotes: [
					"Detailed review achieved; validation was not executed.",
				],
				validationRun: [validationEntry({ command: "cargo test" })],
				findings: [
					reviewFinding({
						title: "Desktop mode has a broader-than-necessary trust boundary",
						category: "risk",
						confidence: "likely",
						severity: "medium",
						evidence: [
							"src-tauri/tauri.conf.json:10-11 sets app.security.csp to null.",
							"src-tauri/src/commands.rs:49-64 accepts a file_path for load_csv.",
						],
						impact:
							"This is a vulnerability that leaves the app unsafe if a UI injection issue appears.",
						remediation:
							"Treat this as a release blocker and fix the security flaw by defining a restrictive CSP and keeping file-path-bearing commands tied to explicit dialog flows.",
					}),
				],
				nextSteps: ["Tighten desktop CSP and path-handling assumptions."],
			}),
		);
		expect(parsed.report).toContain("risk");
		expect(parsed.report).toContain("confidence: likely");
		expect(parsed.report).toContain(
			"Overall verdict: This is a security flaw in desktop mode.",
		);
		expect(parsed.report).toContain(
			"- Risk: This is a vulnerability that leaves the app unsafe if a UI injection issue appears.",
		);
		expect(parsed.report).toContain(
			"Recommendation: No confirmed release blocker was proven in this review, but 'Desktop mode has a broader-than-necessary trust boundary' is a material risk to address next.",
		);
		expect(parsed.report).toContain(
			"- Recommendation: Treat this as a release blocker and fix the security flaw by defining a restrictive CSP and keeping file-path-bearing commands tied to explicit dialog flows.",
		);
		expect(parsed.report).not.toContain("Not ready to ship until");
	});

	test("flow_review_render preserves finding categories from the submitted review ledger", async () => {
		const tools = createTestTools();
		const hardeningReport = sampleReviewReport({
			requestedDepth: "deep_audit",
			achievedDepth: "deep_audit",
			repoSummary: "desktop-app has a webview shell and local command bridge.",
			overallVerdict: "This is a security flaw in desktop mode.",
			discoveredSurfaces: [
				reviewSurface({
					name: "Desktop runtime",
					category: "source_runtime",
					reviewStatus: "directly_reviewed",
					evidence: ["src-tauri/tauri.conf.json:10-11"],
				}),
			],
			coverageNotes: ["Detailed review achieved; validation was not executed."],
			validationRun: [validationEntry({ command: "cargo test" })],
			findings: [
				reviewFinding({
					title: "Desktop mode has a broader-than-necessary trust boundary",
					category: "confirmed_defect",
					confidence: "confirmed",
					severity: "medium",
					evidence: [
						"src-tauri/tauri.conf.json:10-11 sets app.security.csp to null.",
						"src-tauri/src/commands.rs:49-64 accepts a file_path for load_csv.",
					],
					impact:
						"This is a vulnerability that leaves the app unsafe if a UI injection issue appears.",
					remediation:
						"Treat this as a release blocker and fix the security flaw by defining a restrictive CSP and keeping file-path-bearing commands tied to explicit dialog flows.",
				}),
			],
			nextSteps: ["Tighten desktop CSP and path-handling assumptions."],
		});
		const parsed = await renderReview(tools, hardeningReport);
		expect(parsed.report).toContain("confirmed defect");
		const structuredResponse = await tools.flow_review_render.execute(
			{
				view: "structured",
				reviewJson: JSON.stringify(hardeningReport),
			},
			toolContext(makeTempDir()),
		);
		const structuredEnvelope = JSON.parse(structuredResponse);
		const structured = JSON.parse(structuredEnvelope.report as string);
		expect(structured.findings[0].category).toBe("confirmed_defect");
	});

	test("flow_review_render keeps process-oriented findings in their submitted category", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Maintainer docs and CI guidance were reviewed.",
				overallVerdict: "Contributor guidance is broken.",
				discoveredSurfaces: [
					reviewSurface({
						name: "Maintainer guidance",
						category: "docs_config",
						reviewStatus: "directly_reviewed",
						evidence: ["AGENTS.md:14"],
					}),
				],
				coverageNotes: [
					"Detailed review achieved; validation was not executed.",
				],
				validationRun: [validationEntry({ command: "npm test" })],
				findings: [
					reviewFinding({
						title: "Contributor guidance is stale about frontend CI gates",
						category: "confirmed_defect",
						confidence: "confirmed",
						severity: "low",
						evidence: [
							"AGENTS.md:14 says frontend validation is npm run build.",
							".github/workflows/ci.yml:126-136 runs npm test, npm run lint, and npm run build.",
						],
						impact:
							"Workers following the contributor guidance can skip checks that CI still requires.",
						remediation: "Update AGENTS.md to match the current CI workflow.",
					}),
				],
				nextSteps: ["Update AGENTS.md to match CI."],
			}),
		);
		expect(parsed.report).toContain("confirmed defect");
		expect(parsed.report).toContain(
			"- Impact: Workers following the contributor guidance can skip checks that CI still requires.",
		);
	});

	test("flow_review_render keeps reviewer-authored risk verdict and impact text", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "csv-align loads uploaded CSVs into memory.",
				overallVerdict:
					"This is a release blocker because large uploads can exhaust memory.",
				discoveredSurfaces: [
					reviewSurface({
						name: "Upload pipeline",
						category: "source_runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/api/handlers.rs:128-143"],
					}),
				],
				coverageNotes: [
					"Detailed review achieved; validation was not executed.",
				],
				validationRun: [validationEntry({ command: "cargo test" })],
				findings: [
					reviewFinding({
						title: "Large uploads can create avoidable memory pressure",
						category: "risk",
						confidence: "likely",
						severity: "medium",
						evidence: [
							"src/api/handlers.rs:128-143 reads multipart upload bytes fully into memory.",
							"src/data/csv_loader.rs:20-23 parses full CSV contents from memory.",
						],
						impact:
							"This is a release blocker because large uploads can exhaust memory.",
						remediation:
							"Add upload size ceilings and bounded parsing for large files.",
					}),
				],
				nextSteps: [
					"Add upload size ceilings and bounded parsing for large files.",
				],
			}),
		);
		expect(parsed.report).toContain(
			"Overall verdict: This is a release blocker because large uploads can exhaust memory.",
		);
		expect(parsed.report).toContain(
			"- Risk: This is a release blocker because large uploads can exhaust memory.",
		);
		expect(parsed.report).toContain(
			"Recommendation: No confirmed release blocker was proven in this review, but 'Large uploads can create avoidable memory pressure' is a material risk to address next.",
		);
	});

	test("flow_review_render downgrades deep_audit when discovered surfaces remain unreviewed", async () => {
		const tools = createTestTools();
		const parsed = await renderReview(
			tools,
			sampleReviewReport({
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
				repoSummary: "Repo summary.",
				overallVerdict: "Coverage is incomplete.",
				discoveredSurfaces: [
					reviewSurface({
						name: "Mapped runtime",
						reviewStatus: "directly_reviewed",
						evidence: ["src/main.rs:1-10"],
					}),
					reviewSurface({
						name: "Skipped docs",
						category: "docs_config",
						reviewStatus: "unreviewed",
						reason: "Docs were not inspected in this pass.",
					}),
				],
				coverageNotes: [],
				validationRun: [],
				findings: [],
			}),
		);
		expect(parsed.report).toContain("Achieved depth: broad review");
		expect(parsed.report).toContain(
			"Achieved depth was downgraded from deep_audit because some discovered surfaces remained unreviewed.",
		);
	});
});
