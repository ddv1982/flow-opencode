import { describe, expect, setSystemTime, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareExpectedProvenance } from "../evals/analysis.js";
import { catalogFor } from "../evals/benchmark-run.js";
import { CampaignCancelled } from "../evals/campaign-stop.js";
import { parseCaseCatalog } from "../evals/catalog.js";
import {
	freezeMaskedAnalysis,
	revealPairedAnalysis,
} from "../evals/experiment.js";
import { EvaluationPersistenceError } from "../evals/failure-origin.js";
import { parseReport } from "../evals/report.js";
import { prepareStudyManifest } from "../evals/study-manifest.js";
import { studyHostConfigSha256 } from "../evals/study-protocol.js";
import { executeStudy } from "../evals/study-runner.js";
import {
	fakeStudyTransport,
	studyArtifact,
	studyCase,
	studyManifest,
} from "./study-support.js";

describe("paired-study runner", () => {
	test("retention failure preserves the first attempt and halts before reserves", async () => {
		const directory = await mkdtemp(join(tmpdir(), "study-retention-failure-"));
		try {
			const persistence = new EvaluationPersistenceError(
				"benchmark-inputs",
				new Error("Injected retention failure."),
			);
			const fake = fakeStudyTransport({
				afterRun: (index) => {
					if (index === 1) throw new Error("Retryable request failure.");
				},
				beforeRetain: (index) => {
					if (index === 1) throw persistence;
				},
			});
			let finalized = false;
			await expect(
				executeStudy(await prepareStudyManifest(studyManifest(), directory), {
					directory,
					benchmarks: [studyCase],
					transport: fake.transport,
					beginFinalization: () => {
						finalized = true;
					},
				}),
			).rejects.toBe(persistence);
			expect(fake.dispatches).toHaveLength(1);
			expect(fake.starts).toHaveLength(1);
			expect(finalized).toBe(false);
			const attempts = await readdir(join(directory, "attempts"));
			expect(attempts).toHaveLength(1);
			expect(
				JSON.parse(
					await readFile(
						join(directory, "attempts", attempts[0] ?? "missing"),
						"utf8",
					),
				),
			).toMatchObject({
				outcome: {
					kind: "failure",
					origin: "host",
					code: "command-aborted",
					retryable: true,
				},
				usage: {
					costUsd: 0.25,
					accounting: { tokens: { output: 2, reasoning: 3 } },
				},
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	for (const stage of ["before-dispatch", "after-dispatch"] as const) {
		test(`a failed preflight ${stage} retains an accurate stopped report`, async () => {
			const directory = await mkdtemp(join(tmpdir(), "study-probe-failure-"));
			try {
				const manifest = studyManifest();
				manifest.accounting.preflight = {
					kind: "entitlement",
					maxRequests: 1,
					maxGeneratedOutputTokens: 10,
					maxWallClockMs: 30000,
					maxUsd: 1,
					unknownCostPolicy: "stop",
				};
				const fake = fakeStudyTransport({
					probeError: { stage, error: new Error("Injected probe failure.") },
				});
				const result = await executeStudy(
					await prepareStudyManifest(manifest, directory),
					{ directory, benchmarks: [studyCase], transport: fake.transport },
				);
				expect(result.report.completion).toMatchObject({
					status: "stopped",
					cause: stage === "before-dispatch" ? "host" : "budget",
				});
				expect(result.report.completion.preflight?.[0]).toMatchObject({
					providerCalled: stage === "after-dispatch",
					failure: "Injected probe failure.",
					accounting: { availability: "unobserved", costUsd: null },
				});
				expect(result.report.attempts).toEqual([]);
				expect(fake.dispatches).toEqual([]);
				expect(
					JSON.parse(
						await readFile(join(directory, "preflight", "0.json"), "utf8"),
					),
				).toEqual(result.report.completion.preflight?.[0]);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}, 30000);
	}
	test("supports a Flow/ordinary pair and refuses an artifact relabeling at reveal", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "flow-study-reveal-binding-"),
		);
		try {
			const manifest = studyManifest();
			manifest.arms.candidate.artifact = await studyArtifact(
				directory,
				"flow",
				"8.2.1",
			);
			const prepared = await prepareStudyManifest(manifest, directory);
			const fake = fakeStudyTransport();
			const result = await executeStudy(prepared, {
				directory: join(directory, "report"),
				benchmarks: [studyCase],
				transport: fake.transport,
			});
			expect(fake.dispatches.map((entry) => entry.mode).sort()).toEqual([
				"flow",
				"ordinary",
			]);
			const first = result.report.attempts[0];
			if (!first) throw new Error("Missing first attempt.");
			const other =
				"kind" in first.artifact
					? prepared.policy.arms.candidate
					: prepared.policy.arms.baseline;
			const changed = {
				...result.report,
				attempts: result.report.attempts.map((attempt, index) =>
					index === 0
						? {
								...attempt,
								artifact: other.artifact,
								hostConfigSha256: studyHostConfigSha256(prepared.policy, other),
							}
						: attempt,
				),
			};
			const catalog = parseCaseCatalog(catalogFor([studyCase]));
			if (!catalog.ok) throw new Error("Invalid fixture catalog.");
			const parsed = parseReport(changed, catalog.value);
			if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
			const masked = freezeMaskedAnalysis({
				report: parsed.value,
				scans: result.masked.scans,
				frozenAt: result.masked.frozenAt,
			});
			expect(() =>
				revealPairedAnalysis({
					report: parsed.value,
					masked,
					secret: {
						schemaVersion: 1,
						planSha256: result.allocation.planSha256,
						nonce: result.allocation.nonce,
						blocks: result.allocation.blocks,
					},
					revealedAt: result.allocation.revealedAt,
				}),
			).toThrow("Attempt artifacts do not match the revealed allocation");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);
	test("a failed request with zero reported counters does not establish free usage", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-failed-zero-"));
		try {
			const manifest = studyManifest();
			manifest.budget.maxUsd = 1;
			manifest.budget.unknownCostPolicy = "stop";
			manifest.accounting.estimate.costUsdPerAttempt = 0.1;
			const fake = fakeStudyTransport({
				costUsd: 0,
				usage: {
					input: 0,
					output: 0,
					reasoning: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				afterRun: () => {
					throw new Error("Interrupted request.");
				},
			});
			const result = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{ directory, benchmarks: [studyCase], transport: fake.transport },
			);
			expect(result.report.completion).toMatchObject({
				status: "stopped",
				cause: "budget",
			});
			expect(result.report.attempts[0]?.usage.costUsd).toBeNull();
			expect(fake.dispatches).toHaveLength(1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);
	test("rechecks the wall-clock allowance after host setup and before provider dispatch", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "flow-study-startup-limit-"),
		);
		try {
			const manifest = studyManifest();
			manifest.budget.maxWallClockMs = 20;
			manifest.accounting.estimate.wallClockMsPerAttempt = 1;
			const fake = fakeStudyTransport({ beforeSession: () => Bun.sleep(30) });
			const result = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{ directory, benchmarks: [studyCase], transport: fake.transport },
			);
			expect(result.report.completion).toMatchObject({
				status: "stopped",
				cause: "budget",
			});
			expect(fake.dispatches).toHaveLength(0);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);
	test("retains independent grades and all categories without a host provider", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-test-"));
		try {
			const study = await prepareStudyManifest(studyManifest(), directory);
			const fake = fakeStudyTransport();
			const result = await executeStudy(study, {
				directory: join(directory, "report"),
				benchmarks: [studyCase],
				transport: fake.transport,
			});
			expect(result.report.completion.status).toBe("complete");
			expect(result.report.attempts).toHaveLength(2);
			expect(result.decision.claim).toBe("inconclusive");
			expect(result.masked.power.method).toBe("unestablished");
			expect(result.report.completion.observed.accounting?.tokens).toEqual({
				input: 10,
				output: 4,
				reasoning: 6,
				cacheRead: 14,
				cacheWrite: 22,
			});
			expect(result.report.completion.observed.outputTokens).toBe(4);
			expect(fake.probes()).toBe(0);
			const first = result.report.attempts[0];
			if (!first) throw new Error("Missing completed attempt.");
			expect(
				compareExpectedProvenance(result.report, {
					kind: "paired",
					evaluator: first.evaluator,
					artifacts: [first.artifact, first.artifact],
					attempts: result.report.attempts.map((attempt) => ({
						cellId: attempt.cellId,
						hostConfigSha256: attempt.hostConfigSha256,
						instructions: attempt.instructions,
						actors: attempt.actors.map((actor) => ({
							role: actor.role,
							requestedModel: actor.requestedModel,
							actualModel: {
								kind: "allow-unobserved" as const,
								value: actor.requestedModel,
								reason:
									"Only host identity was observed by the synthetic transport.",
							},
						})),
					})),
				}),
			).toEqual({ matches: true, mismatches: [] });
			expect(
				result.report.attempts.every(
					(attempt) =>
						attempt.outcome.kind === "product" &&
						attempt.outcome.evidence.kind === "paired-value" &&
						attempt.outcome.evidence.assessment?.inputs,
				),
			).toBe(true);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("runs two same-version Flow artifacts from separate caches and declared variants", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "flow-study-artifact-test-"),
		);
		try {
			const manifest = studyManifest();
			manifest.arms.baseline.artifact = await studyArtifact(
				directory,
				"old",
				"8.2.1",
			);
			manifest.arms.candidate.artifact = await studyArtifact(
				directory,
				"new",
				"8.2.1",
			);
			manifest.arms.baseline.manager.variant = "low";
			manifest.arms.candidate.manager.variant = "high";
			const fake = fakeStudyTransport();
			const result = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{
					directory: join(directory, "report"),
					benchmarks: [studyCase],
					transport: fake.transport,
				},
			);
			expect(result.report.completion.status).toBe("complete");
			expect(new Set(fake.caches).size).toBe(2);
			for (const attempt of result.report.attempts) {
				expect(attempt.artifact).not.toHaveProperty("sourceCommit");
				expect(attempt.artifact).not.toHaveProperty("sourceTreeSha256");
			}
			expect(fake.starts.map((entry) => entry.packageVersion)).toEqual([
				"8.2.1",
				"8.2.1",
			]);
			expect(
				fake.starts.every(
					(entry) =>
						entry.nativeLlm === false &&
						entry.reviewerEnvironment === "disabled",
				),
			).toBe(true);
			expect(fake.dispatches.map((entry) => entry.mode)).toEqual([
				"flow",
				"flow",
			]);
			expect(fake.dispatches.map((entry) => entry.variant).sort()).toEqual([
				"high",
				"low",
			]);
			expect(
				new Set(
					result.report.attempts.map((attempt) =>
						"tarballSha256" in attempt.artifact
							? attempt.artifact.tarballSha256
							: "ordinary",
					),
				).size,
			).toBe(2);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("replaces a retryable environment failure as a whole pair", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-reserve-test-"));
		try {
			const fake = fakeStudyTransport({ failStart: 1 });
			const result = await executeStudy(
				await prepareStudyManifest(studyManifest(), directory),
				{ directory, benchmarks: [studyCase], transport: fake.transport },
			);
			expect(result.report.completion.status).toBe("complete");
			expect(result.report.attempts).toHaveLength(4);
			expect(result.report.completion.activatedReserveCellIds).toHaveLength(2);
			expect(result.masked.completePairs).toBe(1);
			expect(result.masked.observations[0]?.blockId).toContain("reserve-1");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("retains genuine product failures without activating reserves", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-product-test-"));
		try {
			const fake = fakeStudyTransport({ badProduct: 1 });
			const result = await executeStudy(
				await prepareStudyManifest(studyManifest(), directory),
				{ directory, benchmarks: [studyCase], transport: fake.transport },
			);
			expect(result.report.completion.status).toBe("complete");
			expect(result.report.attempts[0]?.outcome).toMatchObject({
				kind: "product",
				passed: false,
			});
			expect(result.report.completion.activatedReserveCellIds).toEqual([]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("counts reasoning toward the generated-output stop threshold", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-quota-test-"));
		try {
			const manifest = studyManifest();
			manifest.accounting.maxGeneratedOutputTokens = 30;
			const fake = fakeStudyTransport({
				usage: {
					input: 0,
					output: 2,
					reasoning: 40,
					cacheRead: 0,
					cacheWrite: 0,
				},
			});
			const result = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{ directory, benchmarks: [studyCase], transport: fake.transport },
			);
			expect(result.report.completion).toMatchObject({
				status: "stopped",
				cause: "budget",
			});
			expect(fake.dispatches).toHaveLength(1);
			expect(result.report.completion.observed.outputTokens).toBe(2);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("operator cancellation preserves the completed arm and leaves the pair unresolved", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-cancel-test-"));
		try {
			const controller = new AbortController();
			const fake = fakeStudyTransport({ afterRun: () => controller.abort() });
			const result = await executeStudy(
				await prepareStudyManifest(studyManifest(), directory),
				{
					directory,
					benchmarks: [studyCase],
					transport: fake.transport,
					signal: controller.signal,
				},
			);
			expect(result.report.completion).toMatchObject({
				status: "stopped",
				cause: "operator",
			});
			expect(result.report.attempts).toHaveLength(1);
			expect(result.masked.unresolvedPairs).toBe(1);
			expect(result.report.completion.activatedReserveCellIds).toEqual([]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("preflight time does not consume task admission, timeouts, or reported study duration", async () => {
		const directory = await mkdtemp(join(tmpdir(), "study-separate-clock-"));
		let now = Date.parse("2026-09-13T00:00:00Z");
		setSystemTime(now);
		try {
			const manifest = studyManifest();
			manifest.budget.maxWallClockMs = 10000;
			manifest.accounting.estimate.wallClockMsPerAttempt = 5000;
			manifest.accounting.preflight = {
				kind: "entitlement",
				maxRequests: 1,
				maxGeneratedOutputTokens: 10,
				maxWallClockMs: 30000,
				maxUsd: 1,
				unknownCostPolicy: "stop",
			};
			const fake = fakeStudyTransport({
				afterProbe: () => {
					now += 15000;
					setSystemTime(now);
				},
				afterRun: () => {
					now += 5000;
					setSystemTime(now);
				},
			});
			const timeouts: number[] = [];
			const startHost = fake.transport.startHost;
			fake.transport.startHost = async (options) => {
				const host = await startHost(options);
				const run = host.runPrompt;
				host.runPrompt = async (...args) => {
					timeouts.push(args[3]?.timeoutMs ?? -1);
					return run(...args);
				};
				return host;
			};
			const result = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{
					directory,
					benchmarks: [studyCase],
					transport: fake.transport,
				},
			);
			expect(fake.probes()).toBe(1);
			expect(result.report.attempts).toHaveLength(2);
			expect(timeouts).toEqual([10000, 5000]);
			expect(result.report.completion).toMatchObject({
				status: "complete",
				preflightWallClockMs: 15000,
				startedAt: "2026-09-13T00:00:15.000Z",
				finishedAt: "2026-09-13T00:00:25.000Z",
				observed: { wallClockMs: 10000 },
			});
		} finally {
			setSystemTime();
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("retains separately funded entitlement usage and rejects an unavailable variant before probing", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "flow-study-preflight-test-"),
		);
		try {
			const manifest = studyManifest();
			manifest.arms.baseline.manager.variant = "high";
			manifest.arms.candidate.manager.variant = "high";
			manifest.accounting.preflight = {
				kind: "entitlement",
				maxRequests: 1,
				maxGeneratedOutputTokens: 10,
				maxWallClockMs: 30000,
				maxUsd: 1,
				unknownCostPolicy: "stop",
			};
			const prepared = await prepareStudyManifest(manifest, directory);
			const fake = fakeStudyTransport();
			const result = await executeStudy(prepared, {
				directory: join(directory, "good"),
				benchmarks: [studyCase],
				transport: fake.transport,
			});
			expect(fake.probes()).toBe(1);
			expect(result.report.completion.preflight?.[0]).toMatchObject({
				providerCalled: true,
				variantAvailability: "listed",
				accounting: { costUsd: 0.01 },
			});
			const catalog = parseCaseCatalog(catalogFor([studyCase]));
			if (!catalog.ok) throw new Error("Invalid fixture catalog.");
			for (const preflight of [
				[],
				result.report.completion.preflight?.map((entry) => ({
					...entry,
					providerCalled: false,
				})),
			]) {
				expect(
					parseReport(
						{
							...result.report,
							completion: { ...result.report.completion, preflight },
						},
						catalog.value,
					).ok,
				).toBe(false);
			}
			expect(
				JSON.parse(
					await readFile(
						join(directory, "good", "preflight", "0.json"),
						"utf8",
					),
				),
			).toEqual(result.report.completion.preflight?.[0]);
			const missing = fakeStudyTransport({ variants: [] });
			const rejected = await executeStudy(prepared, {
				directory: join(directory, "missing"),
				benchmarks: [studyCase],
				transport: missing.transport,
			});
			expect(missing.probes()).toBe(0);
			expect(rejected.report.completion).toMatchObject({
				status: "stopped",
				cause: "host",
			});
			expect(
				rejected.report.completion.preflight?.[0]?.variantAvailability,
			).toBe("missing");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	for (const limit of [5, 9, 10]) {
		test(`stops before another request at an exhausted generated allowance of ${limit}`, async () => {
			const directory = await mkdtemp(join(tmpdir(), "flow-study-limit-test-"));
			try {
				const manifest = studyManifest();
				manifest.accounting.maxGeneratedOutputTokens = limit;
				manifest.accounting.estimate.generatedOutputTokensPerAttempt = 1;
				const fake = fakeStudyTransport();
				const result = await executeStudy(
					await prepareStudyManifest(manifest, directory),
					{ directory, benchmarks: [studyCase], transport: fake.transport },
				);
				expect(fake.dispatches).toHaveLength(limit === 5 ? 1 : 2);
				expect(result.report.completion.status).toBe(
					limit === 10 ? "complete" : "stopped",
				);
				if (limit !== 10) expect(result.report.completion.cause).toBe("budget");
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}, 30000);
	}

	test("zero monetary allowances admit neither a task nor a provider preflight", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-zero-test-"));
		try {
			const manifest = studyManifest();
			manifest.budget.maxUsd = 0;
			manifest.accounting.estimate.costUsdPerAttempt = 0;
			const fake = fakeStudyTransport();
			const stopped = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{
					directory: join(directory, "tasks"),
					benchmarks: [studyCase],
					transport: fake.transport,
				},
			);
			expect(stopped.report.completion.cause).toBe("budget");
			expect(fake.starts).toHaveLength(0);
			manifest.budget.maxUsd = null;
			manifest.accounting.preflight = {
				kind: "entitlement",
				maxRequests: 1,
				maxGeneratedOutputTokens: 10,
				maxWallClockMs: 30000,
				maxUsd: 0,
				unknownCostPolicy: "stop",
			};
			const preflight = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{
					directory: join(directory, "preflight"),
					benchmarks: [studyCase],
					transport: fake.transport,
				},
			);
			expect(preflight.report.completion.cause).toBe("budget");
			expect(fake.probes()).toBe(0);
			expect(fake.dispatches).toHaveLength(0);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("an interrupted paid preflight retains its observed usage receipt", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-probe-cancel-"));
		try {
			const manifest = studyManifest();
			manifest.accounting.preflight = {
				kind: "entitlement",
				maxRequests: 1,
				maxGeneratedOutputTokens: 10,
				maxWallClockMs: 30000,
				maxUsd: 1,
				unknownCostPolicy: "stop",
			};
			const controller = new AbortController();
			const fake = fakeStudyTransport({
				afterProbe: () => {
					controller.abort(new CampaignCancelled(130));
					throw controller.signal.reason;
				},
			});
			const result = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{
					directory,
					benchmarks: [studyCase],
					transport: fake.transport,
					signal: controller.signal,
				},
			);
			expect(result.report.completion.cause).toBe("operator");
			expect(result.report.completion.preflight).toHaveLength(1);
			expect(result.report.completion.preflight?.[0]).toMatchObject({
				providerCalled: true,
				accounting: { costUsd: 0.01, tokens: { reasoning: 2 } },
			});
			expect(result.report.attempts).toEqual([]);
			expect(
				JSON.parse(
					await readFile(join(directory, "preflight", "0.json"), "utf8"),
				),
			).toEqual(result.report.completion.preflight?.[0]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);

	test("known profile substitution and missing usage cannot become scored products", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flow-study-observation-"));
		try {
			const manifest = studyManifest();
			manifest.arms.baseline.manager.variant = "high";
			manifest.arms.candidate.manager.variant = "high";
			const mismatch = fakeStudyTransport({ observedVariant: "low" });
			const rejected = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{
					directory: join(directory, "profile"),
					benchmarks: [studyCase],
					transport: mismatch.transport,
				},
			);
			expect(
				rejected.report.attempts.every(
					(attempt) =>
						attempt.outcome.kind === "failure" &&
						attempt.outcome.code === "profile-observation-mismatch",
				),
			).toBe(true);
			const missing = fakeStudyTransport({
				usage: {
					input: 0,
					output: 0,
					reasoning: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				usageAvailability: "unobserved",
				costUsd: 0.5,
			});
			const unknown = await executeStudy(
				await prepareStudyManifest(manifest, directory),
				{
					directory: join(directory, "usage"),
					benchmarks: [studyCase],
					transport: missing.transport,
				},
			);
			expect(unknown.report.completion).toMatchObject({
				status: "stopped",
				cause: "budget",
			});
			expect(unknown.report.attempts[0]?.outcome).toMatchObject({
				kind: "failure",
				code: "usage-unavailable",
			});
			expect(unknown.report.completion.observed.accounting?.availability).toBe(
				"unobserved",
			);
			expect(missing.dispatches).toHaveLength(1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);
});
