import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairedBudgetExceeded } from "../evals/benchmark-run.js";
import { BENCHMARK_CASES } from "../evals/benchmarks.js";
import {
	parseCaseCatalog,
	type ValidatedCaseCatalog,
} from "../evals/catalog.js";
import {
	type AllocationSecret,
	allocationCommitmentSha256,
	armForCell,
	createPairedPlan,
	freezeMaskedAnalysis,
	type MaskedPairObservation,
	maskedAnalysisSha256,
	PAIRED_ANALYSIS_VERSION_SHA256,
	pairedBlocks,
	revealPairedAnalysis,
	scanPairedTranscript,
	taskStratifiedPairedBootstrap,
} from "../evals/experiment.js";
import {
	type ArtifactIdentity,
	type EvalReportV2,
	EvalReportV2Schema,
	parseReport,
	type ValidatedReport,
} from "../evals/report.js";
import { createReportStore } from "../evals/report-store.js";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const model = {
	routeProvider: "openai",
	gateway: null,
	family: "gpt",
	model: "test",
	revision: null,
};
const candidate: ArtifactIdentity = {
	packageVersion: "1.0.0",
	sourceCommit: "commit",
	sourceTreeSha256: digest("a"),
	tarballSha256: digest("b"),
	unpackedManifestSha256: digest("c"),
};
const ordinary = { kind: "ordinary-opencode" as const };

type Fixture = {
	readonly report: ValidatedReport;
	readonly secret: AllocationSecret;
	readonly scans: ReturnType<typeof scanPairedTranscript>[];
	readonly catalog: ValidatedCaseCatalog;
};

function fixture(
	input: {
		readonly cases?: readonly string[];
		readonly repetitions?: number;
		readonly reserves?: number;
		readonly allocationSeed?: string;
		readonly failPrimary?: boolean;
		readonly activateReserve?: boolean;
		readonly candidateCorrect?: boolean;
		readonly baselineCorrect?: boolean;
	} = {},
): Fixture {
	const cases = input.cases ?? ["task-a"];
	const repetitions = input.repetitions ?? 1;
	const planned = createPairedPlan({
		cases: cases.map((caseId) => ({ caseId, caseVersion: 1 })),
		model,
		repetitions,
		reservePairsPerBlock: input.reserves ?? 0,
		randomizationSeed: "public-order",
		allocationSeed: input.allocationSeed ?? "private-allocation",
		commitmentNonce: "nonce-with-at-least-sixteen-bytes",
		budget: {
			maxUsd: 100,
			unknownCostPolicy: "stop",
			maxOutputTokens: 100_000,
			maxWallClockMs: 100_000,
			maxAttempts: 1_000,
		},
	});
	const catalog = parseCaseCatalog(
		cases.map((caseId) => ({
			caseId,
			caseVersion: 1,
			evidenceClass: "paired-value" as const,
			oracle: "hidden-executable" as const,
			release: "report-only" as const,
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: null,
			reviewerPromotionRecordSha256: null,
		})),
	);
	if (!catalog.ok) throw new Error("Fixture catalog failed to parse.");
	const cleanScan = scanPairedTranscript("neutral task output");
	const blocks = pairedBlocks(planned.plan);
	const activeBlocks = blocks.filter(
		(block) =>
			block.schedule === "primary" ||
			(input.activateReserve && block.schedule === "replacement-reserve"),
	);
	const activatedReserveCellIds = activeBlocks
		.filter((block) => block.schedule === "replacement-reserve")
		.flatMap((block) => block.cells.map((cell) => cell.cellId));
	const attempts = activeBlocks.flatMap((block) =>
		block.cells.map((cell, cellIndex) => {
			const arm = armForCell(planned.secret, cell);
			const hiddenCorrectness =
				arm === "candidate"
					? (input.candidateCorrect ?? true)
					: (input.baselineCorrect ?? false);
			const failed =
				input.failPrimary === true &&
				block.schedule === "primary" &&
				cellIndex === 0;
			return {
				schemaVersion: 2 as const,
				attemptId: `attempt-${cell.cellId}`,
				cellId: cell.cellId,
				blockId: cell.blockId,
				caseId: cell.caseId,
				caseVersion: cell.caseVersion,
				armToken: cell.armToken,
				repetition: cell.repetition,
				artifact: arm === "candidate" ? candidate : ordinary,
				evaluator: {
					sourceCommit: "evaluator",
					caseCatalogSha256: digest("d"),
					policyCatalogSha256: digest("e"),
					graderBundleSha256: digest("f"),
				},
				hostConfigSha256: digest("1"),
				actors: [
					{
						role: "manager" as const,
						requestedModel: model,
						actualModel: { kind: "observed" as const, value: model },
						sessionIds: [`session-${cell.cellId}`],
					},
				],
				instructions: [
					{
						source: "command" as const,
						name: "task",
						sequence: 0,
						sha256: digest("2"),
						bytes: 4,
					},
				],
				transcript: {
					sha256: cleanScan.transcriptSha256,
					artifact: `transcripts/${cell.cellId}.json`,
				},
				outcome: failed
					? {
							kind: "failure" as const,
							origin: "host" as const,
							code: "host-failure",
							retryable: true,
						}
					: {
							kind: "product" as const,
							passed: hiddenCorrectness,
							endedBy: "quiet" as const,
							issues: hiddenCorrectness ? [] : ["hidden check failed"],
							evidence: {
								kind: "paired-value" as const,
								hiddenCorrectness,
								claimedComplete: true,
								falseCompletion: !hiddenCorrectness,
							},
						},
				usage: { durationMs: 1, outputTokens: 1, costUsd: 0.01 },
			};
		}),
	);
	const complete = !input.failPrimary || input.activateReserve === true;
	const raw: EvalReportV2 = {
		schemaVersion: 2,
		reportId: "paired-fixture",
		plan: planned.plan,
		attempts,
		completion: {
			status: complete ? "complete" : "stopped",
			cause: complete ? "fixed-target" : "host",
			startedAt: "2026-08-25T00:00:00.000Z",
			finishedAt: "2026-08-25T00:00:00.001Z",
			activatedReserveCellIds,
			observed: {
				attempts: attempts.length,
				outputTokens: attempts.length,
				costUsd: attempts.length * 0.01,
				wallClockMs: 1,
			},
		},
		allocationCommitmentSha256: planned.allocationCommitmentSha256,
	};
	const parsed = parseReport(raw, catalog.value);
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
	return {
		report: parsed.value,
		secret: planned.secret,
		scans: attempts.map(() => cleanScan),
		catalog: catalog.value,
	};
}

function freeze(value: Fixture) {
	return freezeMaskedAnalysis({
		report: value.report,
		scans: value.scans,
		frozenAt: "2026-08-25T00:00:01.000Z",
	});
}

describe("paired plan and scanner", () => {
	test("creates deterministic opaque blocks and nonce-backed commitments", () => {
		const first = fixture();
		const second = fixture();
		expect(first.report.plan).toEqual(second.report.plan);
		expect(first.secret).toEqual(second.secret);
		expect(first.report.plan.analysis.versionSha256).toBe(
			PAIRED_ANALYSIS_VERSION_SHA256,
		);
		expect(
			allocationCommitmentSha256({
				...first.secret,
				nonce: "different-nonce-value",
			}),
		).not.toBe(allocationCommitmentSha256(first.secret));
	});

	test("preallocates same-token reserve mappings for every primary slot", () => {
		const value = fixture({ reserves: 1 });
		const [primary, reserve] = pairedBlocks(value.report.plan);
		if (!primary || !reserve)
			throw new Error("Expected primary and reserve blocks.");
		expect(primary.cells.map((cell) => cell.armToken).sort()).toEqual(
			reserve.cells.map((cell) => cell.armToken).sort(),
		);
		expect(value.secret.blocks.map((block) => block.blockId)).toEqual([
			primary.blockId,
			reserve.blockId,
		]);
	});

	test("rejects reserved labels and evaluator surfaces but records the honest limitation", () => {
		expect(scanPairedTranscript("neutral task output").passed).toBe(true);
		expect(
			scanPairedTranscript("candidate hidden grader in evals/").passed,
		).toBe(false);
		expect(scanPairedTranscript("candidate baseline").passed).toBe(false);
		expect(freeze(fixture()).treatmentBlinding).toBe(
			"flow-tool-presence-visible",
		);
	});

	test("keeps every model-facing benchmark prompt free of reserved labels", () => {
		for (const benchmark of BENCHMARK_CASES) {
			expect(scanPairedTranscript(benchmark.prompt)).toMatchObject({
				passed: true,
				findings: [],
			});
		}
	});
});

describe("paired bootstrap", () => {
	test("macro-averages tasks instead of weighting repeated tasks", () => {
		const observations: MaskedPairObservation[] = [
			{
				blockId: "a",
				caseId: "one",
				caseVersion: 1,
				repetition: 0,
				armTokens: ["a", "b"],
				outcomes: [true, false],
			},
			{
				blockId: "b",
				caseId: "two",
				caseVersion: 1,
				repetition: 0,
				armTokens: ["c", "d"],
				outcomes: [false, true],
			},
			{
				blockId: "c",
				caseId: "two",
				caseVersion: 1,
				repetition: 1,
				armTokens: ["e", "f"],
				outcomes: [false, true],
			},
			{
				blockId: "d",
				caseId: "two",
				caseVersion: 1,
				repetition: 2,
				armTokens: ["g", "h"],
				outcomes: [false, true],
			},
		];
		const result = taskStratifiedPairedBootstrap({
			observations,
			seed: "seed",
			samples: 200,
		});
		expect(result.estimate).toBe(0);
		expect(result).toEqual(
			taskStratifiedPairedBootstrap({
				observations,
				seed: "seed",
				samples: 200,
			}),
		);
	});

	test("rejects invalid bootstrap sample counts", () => {
		expect(() =>
			taskStratifiedPairedBootstrap({
				observations: [],
				seed: "seed",
				samples: 0,
			}),
		).toThrow("positive bounded integer");
	});
});

describe("paired runner budgets", () => {
	test("stops on unknown priced cost and observed resource ceilings", () => {
		const budget = {
			maxUsd: 1,
			unknownCostPolicy: "stop" as const,
			maxOutputTokens: 10,
			maxWallClockMs: 100,
			maxAttempts: 2,
		};
		expect(
			pairedBudgetExceeded({
				budget,
				attempts: [
					{ usage: { durationMs: 1, outputTokens: 1, costUsd: null } },
				],
				elapsedMs: 1,
			}),
		).toBe(true);
		expect(
			pairedBudgetExceeded({
				budget: { ...budget, maxUsd: null },
				attempts: [
					{ usage: { durationMs: 1, outputTokens: 11, costUsd: null } },
				],
				elapsedMs: 1,
			}),
		).toBe(true);
		expect(
			pairedBudgetExceeded({
				budget: { ...budget, maxUsd: null },
				attempts: [
					{ usage: { durationMs: 1, outputTokens: 1, costUsd: null } },
				],
				elapsedMs: 1,
			}),
		).toBe(false);
	});
});

describe("masked freeze and controlled reveal", () => {
	test("freezes an opaque record with no allocation labels", () => {
		const masked = freeze(fixture());
		expect(masked.sha256).toBe(maskedAnalysisSha256(masked));
		expect(JSON.stringify(masked)).not.toMatch(/candidate|baseline/i);
	});

	test("reveals an arm-order-invariant candidate-minus-baseline effect", () => {
		const first = fixture({ repetitions: 300, allocationSeed: "first" });
		const second = fixture({ repetitions: 300, allocationSeed: "second" });
		const firstResult = revealPairedAnalysis({
			report: first.report,
			masked: freeze(first),
			secret: first.secret,
			revealedAt: "2026-08-25T00:00:02.000Z",
		});
		const secondResult = revealPairedAnalysis({
			report: second.report,
			masked: freeze(second),
			secret: second.secret,
			revealedAt: "2026-08-25T00:00:02.000Z",
		});
		expect(firstResult.decision.candidateMinusBaseline).toBe(1);
		expect(secondResult.decision.candidateMinusBaseline).toBe(1);
		expect(firstResult.decision.claim).toBe("candidate-better");
	});

	test("binds reveal to the exact masked hash, nonce, map, report, and artifacts", () => {
		const value = fixture({ repetitions: 8 });
		const masked = freeze(value);
		expect(() =>
			revealPairedAnalysis({
				report: value.report,
				masked: { ...masked, reportSha256: digest("9") },
				secret: value.secret,
				revealedAt: "2026-08-25T00:00:02.000Z",
			}),
		).toThrow("exact plan, report, masked record");
		expect(() =>
			revealPairedAnalysis({
				report: value.report,
				masked,
				secret: { ...value.secret, nonce: "tampered-nonce-value" },
				revealedAt: "2026-08-25T00:00:02.000Z",
			}),
		).toThrow("exact plan, report, masked record");
		const alteredBase = {
			...masked,
			observations: masked.observations.map((observation, index) =>
				index === 0
					? {
							...observation,
							armTokens: ["unknown-arm", observation.armTokens[1]] as const,
						}
					: observation,
			),
		};
		const altered = {
			...alteredBase,
			sha256: maskedAnalysisSha256(alteredBase),
		};
		expect(() =>
			revealPairedAnalysis({
				report: value.report,
				masked: altered,
				secret: value.secret,
				revealedAt: "2026-08-25T00:00:02.000Z",
			}),
		).toThrow("exact plan, report, masked record");
	});

	test("uses a complete activated reserve for its unresolved primary slot", () => {
		const value = fixture({
			reserves: 1,
			failPrimary: true,
			activateReserve: true,
		});
		const masked = freeze(value);
		expect(masked.completePairs).toBe(1);
		expect(masked.unresolvedPairs).toBe(0);
		expect(masked.observations[0]?.blockId).toContain("reserve-1");
		expect(() =>
			revealPairedAnalysis({
				report: value.report,
				masked,
				secret: value.secret,
				revealedAt: "2026-08-25T00:00:02.000Z",
			}),
		).not.toThrow();
	});

	test("keeps unresolved, underpowered, or scanner-failed evidence inconclusive", () => {
		const unresolved = fixture({ failPrimary: true });
		const unresolvedMasked = freeze(unresolved);
		expect(unresolvedMasked.claimEligible).toBe(false);
		expect(unresolvedMasked.gateReasons).toContain("unresolved-pairs");
		const underpowered = freeze(fixture());
		expect(underpowered.gateReasons).toContain("power-insufficient");
		const leaked = fixture();
		const leakedMasked = freezeMaskedAnalysis({
			report: leaked.report,
			scans: leaked.scans.map(() =>
				scanPairedTranscript("candidate allocation"),
			),
			frozenAt: "2026-08-25T00:00:01.000Z",
		});
		expect(leakedMasked.gateReasons).toContain("scan-failed");
		const mismatched = freezeMaskedAnalysis({
			report: leaked.report,
			scans: leaked.scans.map(() =>
				scanPairedTranscript("different neutral output"),
			),
			frozenAt: "2026-08-25T00:00:01.000Z",
		});
		expect(mismatched.gateReasons).toContain("scan-binding-mismatch");
	});

	test("persists masked analysis before accepting the exact allocation", async () => {
		const value = fixture();
		const directory = await mkdtemp(join(tmpdir(), "flow-paired-store-"));
		try {
			const store = createReportStore({ directory, catalog: value.catalog });
			const mutable = EvalReportV2Schema.parse(value.report);
			await store.initialize(mutable.plan);
			await store.writeCatalog(value.catalog);
			for (const attempt of mutable.attempts) {
				await store.writeAttempt(attempt);
			}
			const report = await store.finalize({
				reportId: mutable.reportId,
				completion: mutable.completion,
				allocationCommitmentSha256: value.report.allocationCommitmentSha256,
			});
			const masked = freezeMaskedAnalysis({
				report,
				scans: value.scans,
				frozenAt: "2026-08-25T00:00:01.000Z",
			});
			const revealed = revealPairedAnalysis({
				report,
				masked,
				secret: value.secret,
				revealedAt: "2026-08-25T00:00:02.000Z",
			});
			await expect(store.writeAllocation(revealed.allocation)).rejects.toThrow(
				"masked analysis",
			);
			const fabricatedBase = {
				...masked,
				observations: masked.observations.map((observation) => ({
					...observation,
					outcomes: [false, false] as const,
				})),
				ties: masked.completePairs,
				opaqueEstimate: 0,
				interval95: [0, 0] as const,
			};
			const fabricated = {
				...fabricatedBase,
				sha256: maskedAnalysisSha256(fabricatedBase),
			};
			await expect(store.writeMaskedAnalysis(fabricated)).rejects.toThrow(
				"does not bind",
			);
			await store.writeMaskedAnalysis(masked);
			await store.writeAllocation(revealed.allocation);
			expect(
				JSON.parse(await readFile(join(directory, "allocation.json"), "utf8")),
			).toEqual(revealed.allocation);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
