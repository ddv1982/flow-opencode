import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevConfiguration } from "../evals/recovery-decisions/campaign.js";
import {
	EpisodeReceiptSchema,
	reduceEpisodeReceipt,
} from "../evals/recovery-decisions/episode-receipts.js";
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

test("artifact verification requires its exact recorded manifest and matching observation method", async () => {
	const { registration, receipt } = await fixture();
	const file = {
		version: "1.0.0",
		bytes: { sha256: hash("bytes"), size: 5, executable: true },
	};
	const expectedHostArtifacts = {
		schemaVersion: 1,
		platform: "linux",
		architecture: "x64",
		bun: file,
		opencode: file,
		packageCache: null,
	};
	const artifactVerification = {
		manifestDigest: hash(expectedHostArtifacts),
		method: "copied-files-and-linux-process",
	};
	const recorded = { ...receipt, expectedHostArtifacts, artifactVerification };
	expect(
		(await reduceEpisodeReceipt(registration, recorded)).observation
			.receiptDigest,
	).toBe(hash(recorded));
	for (const invalid of [
		{ ...receipt, expectedHostArtifacts },
		{ ...receipt, artifactVerification },
		{
			...recorded,
			artifactVerification: {
				...artifactVerification,
				manifestDigest: hash("other"),
			},
		},
		{
			...recorded,
			artifactVerification: {
				...artifactVerification,
				method: "copied-files-and-direct-spawn",
			},
		},
	])
		await expect(reduceEpisodeReceipt(registration, invalid)).rejects.toThrow(
			"does not match",
		);
});

async function reconciledFixture() {
	const f = await fixture();
	const scope = {
		executionId: randomUUID(),
		registrationDigest: hash(f.registration),
		episodeId: "one",
		arm: "manager-only",
		harnessDigest: f.registration.protocol.arms.managerOnly.harnessDigest,
	};
	const authorization = {
		schemaVersion: 1,
		origin: "simulation",
		purpose: "receipt test",
		maxRequests: 4,
		maxMicroUsd: 20000,
		expiresAt: "2026-09-30T00:00:00.000Z",
		models: [
			{
				model: "xai/grok-4.6",
				reservationMicroUsd: 5000,
				basis: { kind: "simulation" },
			},
		],
	};
	const claims = [
		{
			schemaVersion: 2,
			authorizationDigest: hash(authorization),
			sequence: 1,
			model: "xai/grok-4.6",
			reservationMicroUsd: 5000,
			at: "2026-09-22T00:00:00.000Z",
			scope,
		},
	];
	const reconciliation = {
		scope,
		authorization,
		authorizationDigest: hash(authorization),
		claims,
		claimsDigest: hash(claims),
		totalMicroUsd: 5000,
	};
	const receipt = EpisodeReceiptSchema.parse({
		...f.receipt,
		reservationCoverage: "unknown",
		reservationScope: scope,
		events: [
			{ kind: "start", atMs: 0 },
			{ kind: "reservation-reconciliation", atMs: 100, reconciliation },
			{ kind: "terminal", atMs: 100, outcome: "completed" },
		],
	});
	return { ...f, receipt };
}
test("reconciled receipts verify every binding, amount, ordered claim and final event", async () => {
	const { registration, receipt } = await reconciledFixture();
	expect(
		(await reduceEpisodeReceipt(registration, receipt)).observation,
	).toMatchObject({ reservedUsd: 0.005, activeRuntimeMs: 100, humanWaitMs: 0 });
	const variants: Array<(copy: typeof receipt) => void> = [
		(copy) => {
			copy.reservationScope = undefined;
		},
		(copy) => {
			if (copy.reservationScope)
				copy.reservationScope.executionId = randomUUID();
		},
		(copy) => {
			copy.reservationCoverage = "complete";
		},
		(copy) => {
			copy.events.splice(1, 0, {
				kind: "reservation",
				id: "legacy",
				usd: 1,
				atMs: 0,
			});
		},
		(copy) => {
			copy.events.splice(2, 0, { kind: "wait-start", atMs: 100 });
		},
		(copy) => {
			copy.events.push({ kind: "terminal", atMs: 100, outcome: "completed" });
		},
		(copy) => {
			const end = copy.events.at(-1);
			if (end) end.atMs = 101;
		},
	];
	for (const mutate of variants) {
		const copy = structuredClone(receipt);
		mutate(copy);
		await expect(reduceEpisodeReceipt(registration, copy)).rejects.toThrow();
	}
	for (const change of [
		"scope",
		"authorization",
		"amount",
		"sum",
		"digest",
		"duplicate",
		"omitted",
	]) {
		const copy = structuredClone(receipt),
			event = copy.events[1];
		if (event?.kind !== "reservation-reconciliation")
			throw new Error("Missing fixture reconciliation.");
		const row = event.reconciliation,
			claim = row.claims[0];
		if (!claim) throw new Error("Missing fixture claim.");
		if (change === "scope") claim.scope.episodeId = "other";
		if (change === "authorization") claim.authorizationDigest = "f".repeat(64);
		if (change === "amount") {
			claim.reservationMicroUsd = 6000;
			row.totalMicroUsd = 6000;
			row.claimsDigest = hash(row.claims);
		}
		if (change === "sum") row.totalMicroUsd++;
		if (change === "digest") row.claimsDigest = "f".repeat(64);
		if (change === "duplicate") {
			row.claims.push(claim);
			row.totalMicroUsd *= 2;
			row.claimsDigest = hash(row.claims);
		}
		if (change === "omitted") row.claims = [];
		await expect(reduceEpisodeReceipt(registration, copy)).rejects.toThrow();
	}
	receipt.events.pop();
	expect(
		(await reduceEpisodeReceipt(registration, receipt)).observation.reservedUsd,
	).toBeNull();
});
