import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevConfiguration } from "../evals/recovery-decisions/campaign.js";
import { reduceEpisodeReceipt } from "../evals/recovery-decisions/episode-receipts.js";
import {
	registerEpisodes,
	reportEpisodes,
} from "../evals/recovery-decisions/episodes.js";
import { datasetDigest as hash } from "../evals/recovery-decisions/schema.js";

async function fixture() {
	const manager = {
		model: "fixture",
		prompt: "fixture",
		harnessDigest: hash("harness"),
	};
	const episode = {
		id: "one",
		taskDigest: hash("task"),
		initialStateDigest: hash("state"),
		completionCriteria: "Acceptance tests pass",
		sourceReference: "fixture",
		independenceGroupId: "one",
	};
	const registration = await registerEpisodes({
		schemaVersion: 1,
		split: "calibration",
		calibrationEvidenceDigest: null,
		episodes: [episode],
		arms: {
			managerOnly: manager,
			managerPlusJev: { ...manager, jev: JevConfiguration },
		},
		execution: { timeoutMs: 1000, resetProtocol: "Restore fixture state" },
		inference: {
			method: "paired-bootstrap-percentile-v1",
			seed: 42,
			resamples: 2000,
			confidence: 0.95,
		},
	});
	const receipt = {
		schemaVersion: 1,
		registrationDigest: hash(registration),
		arm: "manager-only",
		armDigest: hash(manager),
		episodeId: episode.id,
		episodeDigest: hash(episode),
		initialStateDigest: episode.initialStateDigest,
		declaredOrigin: "simulation",
		recordedBy: "fixture",
		startedAt: "2026-09-21T00:00:00.000Z",
		reservationCoverage: "complete",
		events: [
			{ kind: "start", atMs: 0 },
			{ kind: "reservation", atMs: 10, id: "request-1", usd: 0.01 },
			{ kind: "wait-start", atMs: 20 },
			{ kind: "intervention", atMs: 30 },
			{ kind: "wait-end", atMs: 70 },
			{ kind: "terminal", atMs: 100, outcome: "failed" },
		],
	};
	return { registration, receipt };
}

test("receipt intervals partition elapsed time and remain report-compatible", async () => {
	const { registration, receipt } = await fixture();
	const draft = await reduceEpisodeReceipt(registration, receipt);
	expect(draft.status).toBe("awaiting-review");
	expect(draft.observation).toMatchObject({
		activeRuntimeMs: 50,
		humanWaitMs: 50,
		interruptions: 1,
		reservedUsd: 0.01,
		result: { kind: "terminal", outcome: "failed" },
		receiptDigest: hash(receipt),
		unsafeAcceptedActions: null,
		safetyReview: null,
	});
	const arm = {
		schemaVersion: 1,
		qualification: "inconclusive",
		registrationDigest: hash(registration),
		arm: receipt.arm,
		armDigest: receipt.armDigest,
		origin: { kind: "simulation" },
		observations: [draft.observation],
	};
	const report = await reportEpisodes(registration, arm, {
		...arm,
		arm: "manager-plus-jev",
		armDigest: hash(registration.protocol.arms.managerPlusJev),
		observations: [],
	});
	expect(report.qualification).toBe("inconclusive");
});

test("terminal waiting is counted, while incomplete receipts leave totals unknown", async () => {
	const { registration, receipt } = await fixture();
	receipt.events.splice(4, 1);
	const terminal = await reduceEpisodeReceipt(registration, receipt);
	expect(terminal.observation.activeRuntimeMs).toBe(20);
	expect(terminal.observation.humanWaitMs).toBe(80);
	receipt.events.pop();
	const incomplete = await reduceEpisodeReceipt(registration, receipt);
	expect(incomplete.observation.result.kind).toBe("unavailable");
	for (const field of [
		"activeRuntimeMs",
		"humanWaitMs",
		"interruptions",
		"reservedUsd",
	] as const)
		expect(incomplete.observation[field]).toBeNull();
});

test("rejects malformed timelines and duplicate reservations", async () => {
	const { registration, receipt } = await fixture();
	const invalid = [
		receipt.events.slice(1),
		[...receipt.events, { kind: "intervention", atMs: 101 }],
		[receipt.events[0], { kind: "start", atMs: 0 }],
		[receipt.events[0], { kind: "wait-end", atMs: 1 }],
		[...receipt.events.slice(0, 3), { kind: "wait-start", atMs: 25 }],
		[...receipt.events.slice(0, 3), { kind: "intervention", atMs: 19 }],
		[...receipt.events.slice(0, 2), receipt.events[1]],
		[receipt.events[0], { kind: "intervention", atMs: -1 }],
	];
	for (const events of invalid)
		await expect(
			reduceEpisodeReceipt(registration, { ...receipt, events }),
		).rejects.toThrow();
});

test("rejects stale bindings and does not infer safety or complete spending coverage", async () => {
	const { registration, receipt } = await fixture();
	for (const key of [
		"registrationDigest",
		"armDigest",
		"episodeDigest",
		"initialStateDigest",
	])
		await expect(
			reduceEpisodeReceipt(registration, { ...receipt, [key]: hash("wrong") }),
		).rejects.toThrow();
	await expect(
		reduceEpisodeReceipt({ ...registration, sourceDigests: {} }, receipt),
	).rejects.toThrow();
	await expect(
		reduceEpisodeReceipt(registration, { ...receipt, episodeId: "unknown" }),
	).rejects.toThrow();
	const draft = await reduceEpisodeReceipt(registration, {
		...receipt,
		declaredOrigin: "live",
		reservationCoverage: "unknown",
	});
	expect(draft.status).toBe("awaiting-review");
	expect(draft.observation.reservedUsd).toBeNull();
	expect(draft.observation.forbiddenMutations).toBeNull();
});

test("CLI writes a draft once and refuses to overwrite it", async () => {
	const { registration, receipt } = await fixture();
	const directory = await mkdtemp(join(tmpdir(), "episode-receipt-"));
	try {
		const registrationPath = join(directory, "registration.json");
		const receiptPath = join(directory, "receipt.json");
		const output = join(directory, "draft.json");
		await writeFile(registrationPath, JSON.stringify(registration));
		await writeFile(receiptPath, JSON.stringify(receipt));
		const run = () =>
			Bun.spawn(
				[
					"bun",
					"evals/recovery-decisions/run.ts",
					"episode-reduce",
					registrationPath,
					receiptPath,
					output,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
		expect(await run().exited).toBe(0);
		const bytes = await readFile(output, "utf8");
		expect(JSON.parse(bytes).observation.activeRuntimeMs).toBe(50);
		expect(await run().exited).toBe(2);
		expect(await readFile(output, "utf8")).toBe(bytes);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
