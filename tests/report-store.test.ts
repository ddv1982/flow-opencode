import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseCaseCatalog,
	type ValidatedCaseCatalog,
} from "../evals/catalog.js";
import {
	type AttemptRecordV2,
	type CampaignCompletion,
	type CampaignPlan,
	campaignPlanSha256,
} from "../evals/report.js";
import {
	createReportStore,
	type PersistenceCheckpoint,
	ReportStoreError,
} from "../evals/report-store.js";

const temporary: string[] = [];
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function directory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "flow-report-store-"));
	temporary.push(path);
	return path;
}

function model() {
	return {
		routeProvider: "openai",
		gateway: null,
		family: "gpt",
		model: "test",
		revision: null,
	};
}

function catalog(): ValidatedCaseCatalog {
	const parsed = parseCaseCatalog([
		{
			caseId: "case",
			caseVersion: 1,
			evidenceClass: "conformance",
			oracle: "durable-state",
			release: "required",
			minProviders: 1,
			minScoredAttempts: 1,
			minPassRate: 1,
			reviewerPromotionRecordSha256: null,
		},
	]);
	if (!parsed.ok) throw new Error("Fixture catalog must parse.");
	return parsed.value;
}

function plan(count = 1): CampaignPlan {
	const value: CampaignPlan = {
		schemaVersion: 1,
		planId: "plan",
		planSha256: digest("a"),
		randomizationSeed: "seed",
		cells: Array.from({ length: count }, (_, index) => ({
			cellId: `cell-${index}`,
			blockId: `block-${index}`,
			caseId: "case",
			caseVersion: 1,
			armToken: null,
			repetition: index,
			managerModel: model(),
			reviewerModel: null,
			schedule: "primary",
		})),
		abortPolicy: { retry: "never", maxReplacementBlocks: 0 },
		stoppingRule: { kind: "fixed-attempts", count },
		analysis: {
			kind: "rate",
			primaryOutcome: "pass",
			versionSha256: digest("b"),
		},
		budget: {
			maxUsd: 10,
			unknownCostPolicy: "stop",
			maxOutputTokens: 100,
			maxWallClockMs: 10_000,
			maxAttempts: count,
		},
	};
	value.planSha256 = campaignPlanSha256(value);
	return value;
}

function attempt(
	campaign: CampaignPlan,
	index: number,
	attemptId = `attempt-${index}`,
): AttemptRecordV2 {
	const cell = campaign.cells[index];
	if (!cell) throw new Error("Fixture cell is missing.");
	const requestedModel = cell.managerModel;
	if (!requestedModel) throw new Error("Fixture manager is missing.");
	return {
		schemaVersion: 2,
		attemptId,
		cellId: cell.cellId,
		blockId: cell.blockId,
		caseId: cell.caseId,
		caseVersion: cell.caseVersion,
		armToken: cell.armToken,
		repetition: cell.repetition,
		artifact: {
			packageVersion: "1.0.0",
			sourceCommit: "commit",
			sourceTreeSha256: digest("c"),
			tarballSha256: digest("d"),
			unpackedManifestSha256: digest("e"),
		},
		evaluator: {
			sourceCommit: "evaluator",
			caseCatalogSha256: digest("f"),
			policyCatalogSha256: digest("0"),
			graderBundleSha256: digest("1"),
		},
		hostConfigSha256: digest("2"),
		actors: [
			{
				role: "manager",
				requestedModel,
				actualModel: { kind: "observed", value: requestedModel },
				sessionIds: ["session"],
			},
		],
		instructions: [
			{
				source: "guidance",
				name: "flow-run",
				sequence: 0,
				sha256: digest("3"),
				bytes: 1,
			},
		],
		transcript: { sha256: digest("4"), artifact: `attempt-${index}.json` },
		outcome: {
			kind: "product",
			passed: true,
			endedBy: "quiet",
			issues: [],
			evidence: {
				kind: "conformance",
				falseCompletion: false,
				unsubmittedReviews: 0,
				facts: { fixture: true },
			},
		},
		usage: { durationMs: 10, outputTokens: 1, costUsd: 1 },
	};
}

function completion(count: number): CampaignCompletion {
	return {
		status: "complete",
		cause: "fixed-target",
		startedAt: "2026-08-25T00:00:00.000Z",
		finishedAt: "2026-08-25T00:00:01.000Z",
		activatedReserveCellIds: [],
		observed: {
			attempts: count,
			outputTokens: count,
			costUsd: count,
			wallClockMs: 1_000,
		},
	};
}

describe("report store", () => {
	test("writes immutable attempts and reconciles them in frozen plan order", async () => {
		const root = await directory();
		const campaign = plan(2);
		const store = createReportStore({ directory: root, catalog: catalog() });
		expect(await store.initialize(campaign)).toBe("written");
		expect(await store.writeAttempt(attempt(campaign, 1))).toBe("written");
		expect(await store.writeAttempt(attempt(campaign, 0))).toBe("written");
		const report = await store.finalize({
			reportId: "report",
			completion: completion(2),
			allocationCommitmentSha256: null,
		});
		expect(report.attempts.map((item) => item.cellId)).toEqual([
			"cell-0",
			"cell-1",
		]);
	});

	test("allows only byte-identical replay and rejects conflicting ids or cells", async () => {
		const root = await directory();
		const campaign = plan();
		const store = createReportStore({ directory: root, catalog: catalog() });
		await store.initialize(campaign);
		const first = attempt(campaign, 0);
		expect(await store.writeAttempt(first)).toBe("written");
		expect(await store.writeAttempt(first)).toBe("replayed");
		await expect(
			store.writeAttempt({
				...first,
				usage: { ...first.usage, outputTokens: 2 },
			}),
		).rejects.toBeInstanceOf(ReportStoreError);
		await expect(
			store.writeAttempt(attempt(campaign, 0, "other-id")),
		).rejects.toBeInstanceOf(ReportStoreError);
	});

	test("stores transcripts immutably beside attempts", async () => {
		const root = await directory();
		const campaign = plan();
		const store = createReportStore({ directory: root, catalog: catalog() });
		await store.initialize(campaign);
		const text = '{"redacted":true}\n';
		const stored = await store.writeTranscript({
			attemptId: "attempt-0",
			text,
		});
		expect(stored.artifact).toBe("transcripts/YXR0ZW1wdC0w.json");
		expect(stored.sha256).toBe(
			`sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
		);
		expect(await Bun.file(join(root, stored.artifact)).text()).toBe(text);
		expect(
			await store.writeTranscript({ attemptId: "attempt-0", text }),
		).toEqual(stored);
		await expect(
			store.writeTranscript({ attemptId: "attempt-0", text: "changed" }),
		).rejects.toBeInstanceOf(ReportStoreError);
	});

	test("publishes only one conflicting concurrent attempt", async () => {
		const root = await directory();
		const campaign = plan();
		const stable = createReportStore({ directory: root, catalog: catalog() });
		await stable.initialize(campaign);
		const first = attempt(campaign, 0);
		const second: AttemptRecordV2 = {
			...first,
			usage: { ...first.usage, outputTokens: 2 },
		};
		const results = await Promise.allSettled([
			createReportStore({ directory: root, catalog: catalog() }).writeAttempt(
				first,
			),
			createReportStore({ directory: root, catalog: catalog() }).writeAttempt(
				second,
			),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			results.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		expect(
			(await readdir(join(root, "attempts"))).filter((file) =>
				file.endsWith(".json"),
			),
		).toHaveLength(1);
	});

	test("recovers at every persistence interruption and ignores temporary files", async () => {
		const checkpoints: readonly PersistenceCheckpoint[] = [
			"before-write",
			"after-file-sync",
			"after-rename",
			"before-directory-sync",
		];
		for (const checkpoint of checkpoints) {
			const root = await directory();
			const campaign = plan();
			const stable = createReportStore({ directory: root, catalog: catalog() });
			await stable.initialize(campaign);
			const interrupted = createReportStore({
				directory: root,
				catalog: catalog(),
				hooks: {
					checkpoint: async (actual) => {
						if (actual === checkpoint) throw new Error(`interrupted ${actual}`);
					},
				},
			});
			await expect(
				interrupted.writeAttempt(attempt(campaign, 0)),
			).rejects.toThrow(`interrupted ${checkpoint}`);
			await expect(readdir(join(root, "attempts"))).resolves.toBeInstanceOf(
				Array,
			);
			expect(await stable.writeAttempt(attempt(campaign, 0))).toMatch(
				/written|replayed/,
			);
			await expect(
				stable.finalize({
					reportId: "report",
					completion: completion(1),
					allocationCommitmentSha256: null,
				}),
			).resolves.toMatchObject({ reportId: "report" });
		}
	});

	test("never commits completion or report from a truncated ledger", async () => {
		const root = await directory();
		const campaign = plan(2);
		const store = createReportStore({ directory: root, catalog: catalog() });
		await store.initialize(campaign);
		await store.writeAttempt(attempt(campaign, 0));
		await expect(
			store.finalize({
				reportId: "report",
				completion: completion(2),
				allocationCommitmentSha256: null,
			}),
		).rejects.toBeInstanceOf(ReportStoreError);
		await expect(access(join(root, "completion.json"))).rejects.toBeDefined();
		await expect(access(join(root, "report.json"))).rejects.toBeDefined();
	});
});
