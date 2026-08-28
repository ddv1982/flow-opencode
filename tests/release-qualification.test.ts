import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatorIdentity } from "../evals/provenance.js";
import {
	RELEASE_POLICY_CATALOG_SHA256,
	releaseCaseCatalogSha256,
	releaseCatalog,
	releaseGraderBundle,
	releaseHostConfigSha256,
	releaseScenarioCatalog,
} from "../evals/release-policy.js";
import { campaignPlanSha256 } from "../evals/report.js";
import {
	reportStoreAttemptFileName,
	reportStoreCellFileName,
} from "../evals/report-store.js";
import { campaignPlanFor, releaseScenarios } from "../evals/run.js";
import { SCENARIOS } from "../evals/scenarios.js";
import {
	assertCampaignEvidenceLayout,
	decisionRecordFor,
	qualifyV2,
} from "../scripts/qualify-release.js";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const MODELS = ["openai/gpt-test", "xai/grok-test"];
const ARTIFACT = {
	packageVersion: "8.1.2",
	sourceCommit: "measured-commit",
	sourceTreeSha256: digest("a"),
	tarballSha256: digest("b"),
	unpackedManifestSha256: digest("c"),
};

function releaseReport(stopped = false) {
	const scenarios = releaseScenarios();
	const plan = campaignPlanFor({
		models: MODELS,
		scenarios,
		sampling: { kind: "release" },
		opencodeVersion: "1.18.6",
	});
	const evaluator = evaluatorIdentity({
		sourceCommit: ARTIFACT.sourceCommit,
		caseCatalog: releaseScenarioCatalog(scenarios),
		policyCatalog: releaseCatalog(),
		graderBundle: releaseGraderBundle(join(import.meta.dir, "..")),
	});
	const attempts = plan.cells.map((cell, index) => {
		const failed = stopped && index === 0;
		const model = cell.managerModel;
		if (!model) throw new Error("Release fixture requires a manager model.");
		return {
			schemaVersion: 2 as const,
			attemptId: `attempt-${cell.cellId}`,
			cellId: cell.cellId,
			blockId: cell.blockId,
			caseId: cell.caseId,
			caseVersion: cell.caseVersion,
			armToken: null,
			repetition: cell.repetition,
			artifact: ARTIFACT,
			evaluator,
			hostConfigSha256: releaseHostConfigSha256({
				packageVersion: ARTIFACT.packageVersion,
				model,
			}),
			actors: failed
				? []
				: [
						{
							role: "manager" as const,
							requestedModel: model,
							actualModel: { kind: "observed" as const, value: model },
							sessionIds: [`session-${index}`],
						},
					],
			instructions: failed
				? []
				: [
						{
							source: "command" as const,
							name: "flow-auto",
							sequence: 0,
							sha256: digest("e"),
							bytes: 1,
						},
					],
			transcript: failed
				? null
				: {
						sha256: digest("f"),
						artifact: `transcripts/${index}.json`,
					},
			outcome: failed
				? {
						kind: "failure" as const,
						origin: "host" as const,
						code: "host-down",
						retryable: true,
					}
				: {
						kind: "product" as const,
						passed: true,
						endedBy: "quiet" as const,
						issues: [],
						evidence: {
							kind: "conformance" as const,
							falseCompletion: false,
							unsubmittedReviews: 0,
							facts: { fixture: true },
						},
					},
			usage: { durationMs: 1, outputTokens: 1, costUsd: 0 },
		};
	});
	return {
		schemaVersion: 2 as const,
		reportId: stopped ? "release-stopped" : "release-verified",
		plan,
		attempts,
		completion: {
			status: stopped ? ("stopped" as const) : ("complete" as const),
			cause: stopped ? ("host" as const) : ("fixed-target" as const),
			startedAt: "2026-08-28T00:00:00.000Z",
			finishedAt: "2026-08-28T00:01:00.000Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: attempts.length,
				outputTokens: attempts.length,
				costUsd: 0,
				wallClockMs: 60_000,
			},
		},
		allocationCommitmentSha256: null,
	};
}

describe("repository-owned v2 qualification", () => {
	test("requires one canonical attempt and transcript path per cell", () => {
		const attempts = ["a", "b", "c"].map((id) => ({
			attemptId: `attempt-${id}`,
			cellId: `cell-${id}`,
			transcript: {
				artifact: `transcripts/${reportStoreAttemptFileName(`attempt-${id}`)}`,
			},
		}));
		const attemptFiles = attempts.map((attempt) => ({
			name: reportStoreCellFileName(attempt.cellId),
			attemptId: attempt.attemptId,
		}));
		const transcriptFiles = attempts.map((attempt) =>
			reportStoreAttemptFileName(attempt.attemptId),
		);
		const firstAttempt = attempts.at(0);
		const firstFile = attemptFiles.at(0);
		if (!firstAttempt || !firstFile)
			throw new Error("Campaign layout fixture is missing.");
		expect(() =>
			assertCampaignEvidenceLayout({
				attempts,
				attemptFiles,
				transcriptFiles,
			}),
		).not.toThrow();
		expect(() =>
			assertCampaignEvidenceLayout({
				attempts,
				attemptFiles: [...attemptFiles, firstFile],
				transcriptFiles,
			}),
		).toThrow(/duplicated/);
		expect(() =>
			assertCampaignEvidenceLayout({
				attempts: attempts.map((attempt, index) =>
					index === 2
						? { ...attempt, transcript: firstAttempt.transcript }
						: attempt,
				),
				attemptFiles,
				transcriptFiles,
			}),
		).toThrow(/noncanonical evidence path/);
	});
	test("derives all verdicts from the canonical 76-cell policy", () => {
		const verified = qualifyV2({
			reportInput: releaseReport(),
			catalogInput: releaseCatalog(),
			artifact: ARTIFACT,
		});
		expect(verified.decision.verdict).toBe("VERIFIED");
		expect(verified.report.plan.cells).toHaveLength(76);
		expect(decisionRecordFor(verified)).toEqual(decisionRecordFor(verified));

		const notVerified = qualifyV2({
			reportInput: releaseReport(),
			catalogInput: releaseCatalog(),
			artifact: { ...ARTIFACT, tarballSha256: digest("9") },
		});
		expect(notVerified.decision.verdict).toBe("NOT VERIFIED");

		const inconclusive = qualifyV2({
			reportInput: releaseReport(true),
			catalogInput: releaseCatalog(),
			artifact: ARTIFACT,
		});
		expect(inconclusive.decision.verdict).toBe("INCONCLUSIVE");
	});

	test("rejects every caller attempt to weaken or reorder policy", () => {
		const canonical = releaseCatalog();
		const mutations: unknown[] = [
			canonical.slice(1),
			[...canonical].reverse(),
			canonical.map((row, index) =>
				index === 0 ? { ...row, release: "report-only" } : row,
			),
			canonical.map((row, index) =>
				index === 0 ? { ...row, minPassRate: 0.9 } : row,
			),
			canonical.map((row, index) =>
				index === 0 ? { ...row, minProviders: 1 } : row,
			),
		];
		for (const catalogInput of mutations) {
			expect(() =>
				qualifyV2({
					reportInput: releaseReport(),
					catalogInput,
					artifact: ARTIFACT,
				}),
			).toThrow("does not match repository release policy");
		}
	});

	test("rejects every self-consistent but noncanonical evaluator identity", () => {
		for (const field of [
			"caseCatalogSha256",
			"policyCatalogSha256",
			"graderBundleSha256",
		] as const) {
			const report = releaseReport();
			for (const attempt of report.attempts) {
				attempt.evaluator = { ...attempt.evaluator, [field]: digest("9") };
			}
			expect(() =>
				qualifyV2({
					reportInput: report,
					catalogInput: releaseCatalog(),
					artifact: ARTIFACT,
				}),
			).toThrow("does not match repository release authority");
		}
	});

	test("rejects caller-defined release host configuration", () => {
		const report = releaseReport();
		for (const attempt of report.attempts) {
			attempt.hostConfigSha256 = digest("9");
		}
		expect(() =>
			qualifyV2({
				reportInput: report,
				catalogInput: releaseCatalog(),
				artifact: ARTIFACT,
			}),
		).toThrow("host configuration does not match repository release policy");
	});

	test("runner evidence carries independently reconstructed authority hashes", () => {
		const evaluator = releaseReport().attempts[0]?.evaluator;
		const graderFiles = releaseGraderBundle(
			join(import.meta.dir, ".."),
		).files.map((file) => file.path);
		expect(graderFiles).toEqual(
			expect.arrayContaining([
				"evals/catalog.ts",
				"evals/failure-origin.ts",
				"evals/provenance.ts",
				"evals/report-store.ts",
				"evals/report.ts",
				"evals/run.ts",
				"scripts/qualify-release.ts",
			]),
		);
		expect(evaluator?.policyCatalogSha256).toBe(RELEASE_POLICY_CATALOG_SHA256);
		expect(evaluator?.caseCatalogSha256).toBe(
			releaseCaseCatalogSha256(SCENARIOS),
		);
	});

	test("grader authority changes with any transitive evaluator source", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-grader-bundle-"));
		try {
			await mkdir(join(root, "evals"), { recursive: true });
			await mkdir(join(root, "scripts"), { recursive: true });
			await writeFile(
				join(root, "evals", "run.ts"),
				'import { grade } from "./grade.js"; grade();',
			);
			await writeFile(
				join(root, "scripts", "qualify-release.ts"),
				"export {};\n",
			);
			await writeFile(
				join(root, "evals", "qualification-regrade.ts"),
				"export {};\n",
			);
			await writeFile(
				join(root, "evals", "grade.ts"),
				"export const grade = () => 1;\n",
			);
			const before = releaseGraderBundle(root);
			await writeFile(
				join(root, "evals", "grade.ts"),
				"export const grade = () => 2;\n",
			);
			const after = releaseGraderBundle(root);
			expect(after).not.toEqual(before);
			expect(after.files.map((file) => file.path)).toContain("evals/grade.ts");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects non-literal imports from the grader closure", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-grader-bundle-"));
		try {
			await mkdir(join(root, "evals"), { recursive: true });
			await mkdir(join(root, "scripts"), { recursive: true });
			await writeFile(
				join(root, "evals", "run.ts"),
				"const path = './grade.js'; await import(path);\n",
			);
			await writeFile(
				join(root, "scripts", "qualify-release.ts"),
				"export {};\n",
			);
			await writeFile(
				join(root, "evals", "qualification-regrade.ts"),
				"export {};\n",
			);
			expect(() => releaseGraderBundle(root)).toThrow(/non-literal import/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects the old 70-cell plan even after its hash is recomputed", () => {
		const report = releaseReport();
		report.plan.cells = report.plan.cells.filter(
			(cell) => cell.caseId !== "skipped-case-named-binding",
		);
		report.attempts = report.attempts.filter(
			(attempt) => attempt.caseId !== "skipped-case-named-binding",
		);
		report.plan.stoppingRule.count = report.plan.cells.length;
		report.plan.budget.maxAttempts = report.plan.cells.length;
		report.plan.planSha256 = campaignPlanSha256(report.plan);
		report.completion.observed.attempts = report.attempts.length;
		report.completion.observed.outputTokens = report.attempts.length;
		expect(() =>
			qualifyV2({
				reportInput: report,
				catalogInput: releaseCatalog(),
				artifact: ARTIFACT,
			}),
		).toThrow("canonical 76-cell grid");
	});

	test("rejects self-consistent release-control drift", () => {
		for (const mutate of [
			(report: ReturnType<typeof releaseReport>) => {
				if (report.plan.analysis.kind !== "rate") {
					throw new Error("Release fixture requires rate analysis.");
				}
				report.plan.analysis.primaryOutcome = "caller-selected";
			},
			(report: ReturnType<typeof releaseReport>) => {
				report.plan.budget.maxOutputTokens += 1;
			},
			(report: ReturnType<typeof releaseReport>) => {
				report.plan.randomizationSeed = "caller-selected";
			},
			(report: ReturnType<typeof releaseReport>) => {
				const firstCell = report.plan.cells[0];
				const firstAttempt = report.attempts[0];
				if (!firstCell || !firstAttempt) {
					throw new Error("Release fixture requires a first cell.");
				}
				report.plan.cells[0] = {
					...firstCell,
					cellId: "cell-caller-selected",
				};
				report.attempts[0] = {
					...firstAttempt,
					cellId: "cell-caller-selected",
				};
			},
		]) {
			const report = releaseReport();
			mutate(report);
			report.plan.planSha256 = campaignPlanSha256(report.plan);
			expect(() =>
				qualifyV2({
					reportInput: report,
					catalogInput: releaseCatalog(),
					artifact: ARTIFACT,
				}),
			).toThrow(/Release plan/);
		}
	});

	test("rejects legacy summary-only input", () => {
		expect(() =>
			qualifyV2({
				reportInput: { summary: { passRates: {} } },
				catalogInput: releaseCatalog(),
				artifact: ARTIFACT,
			}),
		).toThrow("Invalid v2 report");
	});

	test("requires explicit report, catalog, and artifact paths in the CLI", async () => {
		const process = Bun.spawn(["bun", "run", "scripts/qualify-release.ts"], {
			cwd: new URL("..", import.meta.url).pathname,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [output, exitCode] = await Promise.all([
			new Response(process.stderr).text(),
			process.exited,
		]);
		expect(exitCode).not.toBe(0);
		expect(output).toContain("Usage: bun run qualify");
	});
});
