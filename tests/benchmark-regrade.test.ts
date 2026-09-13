import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchmarkProbe } from "../evals/benchmark-evidence.js";
import {
	bindBenchmarkCase,
	gradeRetainedBenchmark,
	retainBenchmarkInputs,
} from "../evals/benchmark-grader.js";
import { canonicalJson } from "../evals/canonical-json.js";
import { parseCaseCatalog } from "../evals/catalog.js";
import { assessCompletionDeclaration } from "../evals/completion-claim.js";
import { EvidenceStore } from "../evals/evidence-store.js";
import { createPairedPlan } from "../evals/experiment.js";
import { regradeBenchmarkReport } from "../evals/regrade-benchmark.js";
import {
	type AttemptRecordV2,
	type EvalReportV2,
	parseReport,
} from "../evals/report.js";
import { renderEvidence } from "../evals/report-render.js";
import { createReportStore } from "../evals/report-store.js";

const digest = `sha256:${"a".repeat(64)}`;
const model = {
	routeProvider: "fixture",
	gateway: null,
	family: "fixture",
	model: "fixture",
	revision: null,
};
const benchmark = {
	id: "value-contract",
	caseVersion: 1,
	files: { "src/value.ts": "export const value = () => 0;" },
	probes: [
		{
			id: "value",
			module: "src/value.ts",
			exportName: "value",
			args: [2],
			expected: { kind: "return", value: 5 },
		},
	] as readonly BenchmarkProbe[],
};

async function campaign(
	action: (input: {
		directory: string;
		report: EvalReportV2;
		catalog: unknown;
		attempts: AttemptRecordV2[];
	}) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "regrade-check-"));
	try {
		const project = join(directory, "project");
		await mkdir(join(project, "src"), { recursive: true });
		await writeFile(
			join(project, "src/value.ts"),
			"export const value = n => n*2+1;",
		);
		const evidenceStore = new EvidenceStore(directory);
		const inputs = await retainBenchmarkInputs({
			project,
			benchmark,
			store: evidenceStore,
		});
		const grade = await gradeRetainedBenchmark({
			inputs,
			store: evidenceStore,
		});
		expect(grade.passed).toBe(true);
		const receipt = await evidenceStore.writeJson(grade);
		const experiment = createPairedPlan({
			cases: [{ caseId: benchmark.id, caseVersion: 1 }],
			model,
			repetitions: 1,
			reservePairsPerBlock: 0,
			randomizationSeed: "order",
			allocationSeed: "allocation",
			commitmentNonce: "sixteen-character-nonce",
			benchmarkCases: [bindBenchmarkCase(benchmark, inputs.runtime.sha256)],
			budget: {
				maxUsd: null,
				unknownCostPolicy: "stop",
				maxOutputTokens: 100,
				maxWallClockMs: 100000,
				maxAttempts: 2,
			},
		});
		const rawCatalog = [
			{
				caseId: benchmark.id,
				caseVersion: 1,
				evidenceClass: "paired-value",
				oracle: "hidden-executable",
				release: "report-only",
				minProviders: 1,
				minScoredAttempts: 1,
				minPassRate: null,
				reviewerPromotionRecordSha256: null,
			},
		];
		const catalog = parseCaseCatalog(rawCatalog);
		if (!catalog.ok) throw new Error("Invalid test catalog.");
		const store = createReportStore({ directory, catalog: catalog.value });
		await store.initialize(experiment.plan);
		await store.writeCatalog(catalog.value);
		const attempts: AttemptRecordV2[] = [];
		for (const [index, cell] of experiment.plan.cells.entries()) {
			const attemptId = `attempt-${cell.cellId}`;
			const finalText =
				index === 0 ? "Task status: complete" : "Implemented and checked.";
			const completion = assessCompletionDeclaration(finalText);
			const transcript = await store.writeTranscript({
				attemptId,
				text: canonicalJson({
					schemaVersion: 1,
					calls: [],
					finalText,
					workflowDocuments: [],
				}),
			});
			const attempt: AttemptRecordV2 = {
				schemaVersion: 2,
				attemptId,
				cellId: cell.cellId,
				blockId: cell.blockId,
				caseId: cell.caseId,
				caseVersion: cell.caseVersion,
				armToken: cell.armToken,
				repetition: cell.repetition,
				artifact:
					index === 0
						? {
								packageVersion: "1.0.0",
								sourceCommit: "fixture",
								sourceTreeSha256: digest,
								tarballSha256: digest,
								unpackedManifestSha256: digest,
							}
						: { kind: "ordinary-opencode" },
				evaluator: {
					sourceCommit: "fixture",
					caseCatalogSha256: digest,
					policyCatalogSha256: digest,
					graderBundleSha256: digest,
				},
				hostConfigSha256: digest,
				actors: [
					{
						role: "manager",
						requestedModel: model,
						actualModel: {
							kind: "unobserved",
							reason: "Deterministic fixture",
						},
						sessionIds: [`session-${index}`],
					},
				],
				instructions: [
					{
						source: "command",
						name: "task",
						sequence: 0,
						bytes: 4,
						sha256: digest,
					},
				],
				transcript,
				usage: { durationMs: 1, outputTokens: 0, costUsd: 0 },
				outcome: {
					kind: "product",
					passed: grade.passed,
					endedBy: "quiet",
					issues: [],
					evidence: {
						kind: "paired-value",
						hiddenCorrectness: true,
						claimedComplete:
							completion.kind === "declared" ? completion.complete : null,
						falseCompletion: false,
						assessment: {
							schemaVersion: 1,
							inputs,
							receipt,
							completion,
							workflowCompleted: false,
							containment: grade.containment,
						},
					},
				},
			};
			await store.writeAttempt(attempt);
			attempts.push(attempt);
		}
		await rm(project, { recursive: true });
		await store.finalize({
			reportId: "retained-test",
			allocationCommitmentSha256: experiment.allocationCommitmentSha256,
			completion: {
				status: "complete",
				cause: "fixed-target",
				startedAt: "2026-09-01T00:00:00.000Z",
				finishedAt: "2026-09-01T00:00:00.001Z",
				activatedReserveCellIds: [],
				observed: { attempts: 2, outputTokens: 0, costUsd: 0, wallClockMs: 1 },
			},
		});
		const report = JSON.parse(
			await readFile(join(directory, "report.json"), "utf8"),
		) as EvalReportV2;
		await action({ directory, report, catalog: rawCatalog, attempts });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("offline CLI path reproduces complete grades and explicit unknown claims after fixture cleanup", async () => {
	await campaign(async ({ directory, report, catalog: raw }) => {
		expect(
			await regradeBenchmarkReport(join(directory, "report.json")),
		).toEqual({ attempts: 2, passed: 2 });
		const second = report.attempts[1]?.outcome;
		expect(
			second?.kind === "product" &&
				second.evidence.kind === "paired-value" &&
				second.evidence.claimedComplete,
		).toBeNull();
		const catalog = parseCaseCatalog(raw);
		if (!catalog.ok) throw new Error("Invalid test catalog.");
		const parsed = parseReport(report, catalog.value);
		if (!parsed.ok) throw new Error("Invalid test report.");
		expect(renderEvidence(parsed.value).completionClaims).toEqual({
			declaredComplete: 1,
			declaredIncomplete: 0,
			unassessed: 1,
			historicalBoolean: 0,
		});
	});
});

test("offline regrade rejects missing transcripts and consistent but invented completion declarations", async () => {
	await campaign(async ({ directory, report }) => {
		const first = report.attempts[0];
		if (
			!first?.transcript ||
			first.outcome.kind !== "product" ||
			first.outcome.evidence.kind !== "paired-value" ||
			!first.outcome.evidence.assessment
		)
			throw new Error("Missing fixture attempt.");
		first.outcome.evidence.assessment.completion = {
			kind: "declared",
			complete: false,
			evidence: "Task status: blocked",
		};
		first.outcome.evidence.claimedComplete = false;
		await writeFile(join(directory, "report.json"), canonicalJson(report));
		await expect(
			regradeBenchmarkReport(join(directory, "report.json")),
		).rejects.toThrow("assessment");
		await unlink(join(directory, first.transcript.artifact));
		await expect(
			regradeBenchmarkReport(join(directory, "report.json")),
		).rejects.toThrow();
	});
});

test("retained oracle and runtime substitutions cannot detach from the frozen plan", async () => {
	await campaign(async ({ report, catalog: raw }) => {
		const catalog = parseCaseCatalog(raw);
		if (!catalog.ok) throw new Error("Invalid test catalog.");
		const first = report.attempts[0];
		if (
			first?.outcome.kind !== "product" ||
			first.outcome.evidence.kind !== "paired-value" ||
			!first.outcome.evidence.assessment
		)
			throw new Error("Missing fixture attempt.");
		first.outcome.evidence.assessment.inputs.oracle.sha256 = digest;
		expect(parseReport(report, catalog.value).ok).toBe(false);
	});
});
