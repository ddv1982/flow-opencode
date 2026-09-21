import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevConfiguration } from "../evals/recovery-decisions/campaign.js";
import {
	type EpisodeArmEvidence,
	registerEpisodes,
	reportEpisodes,
} from "../evals/recovery-decisions/episodes.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function fixture(count = 3) {
	const protocol = {
		schemaVersion: 1,
		split: "calibration",
		calibrationEvidenceDigest: null,
		episodes: Array.from({ length: count }, (_, i) => ({
			id: `episode-${i}`,
			taskDigest: datasetDigest(`task-${i}`),
			initialStateDigest: datasetDigest(`initial-${i}`),
			completionCriteria:
				"Tests pass and independent acceptance confirms the task.",
			sourceReference: `fixture-${i}`,
			independenceGroupId: `group-${i}`,
		})),
		arms: {
			managerOnly: {
				model: "test-manager",
				prompt: "Complete the frozen task",
				harnessDigest: datasetDigest("test-harness"),
			},
			managerPlusJev: {
				model: "test-manager",
				prompt: "Complete the frozen task",
				harnessDigest: datasetDigest("test-harness"),
				jev: JevConfiguration,
			},
		},
		execution: {
			timeoutMs: 10000,
			resetProtocol:
				"Restore the registered initial state independently for each arm.",
		},
		inference: {
			method: "paired-bootstrap-percentile-v1",
			seed: 42,
			resamples: 2000,
			confidence: 0.95,
		},
	};
	const registration = await registerEpisodes(protocol);
	const arm = (
		name: "manager-only" | "manager-plus-jev",
	): EpisodeArmEvidence => ({
		schemaVersion: 1,
		qualification: "inconclusive",
		registrationDigest: datasetDigest(registration),
		arm: name,
		armDigest: datasetDigest(
			name === "manager-only"
				? protocol.arms.managerOnly
				: protocol.arms.managerPlusJev,
		),
		origin: { kind: "simulation" },
		observations: protocol.episodes.map((episode, i) => ({
			episodeId: episode.id,
			episodeDigest: datasetDigest(episode),
			receiptDigest: datasetDigest(`receipt-${name}-${i}`),
			result: {
				kind: "terminal",
				outcome:
					i === 2
						? "failed"
						: name === "manager-plus-jev" && i === 1
							? "cancelled"
							: "completed",
			},
			interruptions: (i + 1) * (name === "manager-only" ? 2 : 1),
			activeRuntimeMs:
				(name === "manager-only" ? [10, 100, 1000] : [20, 110, 900])[i % 3] ??
				10,
			humanWaitMs: null,
			unsafeAcceptedActions: null,
			forbiddenMutations: null,
			reservedUsd: null,
			safetyReview: null,
		})),
	});
	return {
		protocol,
		registration,
		manager: arm("manager-only"),
		jev: arm("manager-plus-jev"),
	};
}

test("episode ratios use arm medians and terminal failures count noncompletion", async () => {
	const { registration, manager, jev } = await fixture();
	const report = await reportEpisodes(registration, manager, jev);
	expect(report.metrics.interruptionReduction.point).toBe(0.5);
	expect(report.metrics.completionDelta.point).toBeCloseTo(-1 / 3);
	expect(report.metrics.completionDelta.percentagePoints).toBeCloseTo(-100 / 3);
	expect(report.metrics.activeRuntimeGrowth.point).toBeCloseTo(0.1);
	expect(report.arms.jev.cancelled).toBe(1);
	expect(report.arms.jev.failed).toBe(1);
	expect(report.arms.jev.completed).toBe(1);
	expect(report.metrics.interruptionReduction.interval.reason).toBe(
		"degenerate-distribution",
	);
	expect(report.arms.jev.humanWaitMs).toMatchObject({ samples: 0, missing: 3 });
	expect(report.arms.jev.unsafeAcceptedActions.missing).toBe(3);
	expect(report.qualification).toBe("inconclusive");
});

test("missing and unavailable observations and null telemetry suppress their intervals", async () => {
	const { registration, manager, jev } = await fixture();
	const first = jev.observations[0];
	if (!first) throw new Error("Missing fixture");
	first.activeRuntimeMs = null;
	let report = await reportEpisodes(registration, manager, jev);
	expect(report.metrics.activeRuntimeGrowth.interval.reason).toBe(
		"missing-coverage",
	);
	expect(report.metrics.completionDelta.observedPairs).toBe(3);
	first.result = {
		kind: "unavailable",
		reason: "No retained terminal outcome",
	};
	jev.observations.pop();
	report = await reportEpisodes(registration, manager, jev);
	expect(report.arms.jev.unavailable).toBe(1);
	expect(report.arms.jev.missing).toBe(1);
	expect(report.metrics.completionDelta.observedPairs).toBe(1);
	expect(report.metrics.completionDelta.interval.reason).toBe(
		"missing-coverage",
	);
	expect(report.metrics.completionDelta.excluded).toEqual([
		{ episodeId: "episode-0", reasons: ["jev-unavailable"] },
		{ episodeId: "episode-2", reasons: ["jev-missing"] },
	]);
});

test("undefined denominators and bootstrap draws and single pairs never imply certainty", async () => {
	const { registration, manager, jev } = await fixture();
	for (const row of manager.observations) row.interruptions = 0;
	let report = await reportEpisodes(registration, manager, jev);
	expect(report.metrics.interruptionReduction.point).toBeNull();
	expect(report.metrics.interruptionReduction.interval.reason).toBe(
		"undefined-point",
	);
	const last = manager.observations.at(-1);
	if (!last) throw new Error("Missing fixture");
	last.interruptions = 1;
	report = await reportEpisodes(registration, manager, jev);
	expect(report.metrics.interruptionReduction.interval.reason).toBe(
		"undefined-resamples",
	);
	expect(
		report.metrics.interruptionReduction.interval.undefinedDraws,
	).toBeGreaterThan(0);
	const one = await fixture(1);
	expect(
		(await reportEpisodes(one.registration, one.manager, one.jev)).metrics
			.completionDelta.interval.reason,
	).toBe("fewer-than-two-pairs");
	const tiny = manager.observations[0];
	if (!tiny) throw new Error("Missing fixture");
	for (const row of manager.observations)
		row.activeRuntimeMs = Number.MIN_VALUE;
	report = await reportEpisodes(registration, manager, jev);
	expect(report.metrics.activeRuntimeGrowth.point).toBeNull();
	expect(JSON.stringify(report)).not.toContain("Infinity");
});

test("fixed paired seed is reproducible and observation order cannot alter estimates", async () => {
	const { registration, manager, jev } = await fixture();
	const first = jev.observations[0];
	if (!first) throw new Error("Missing fixture");
	first.interruptions = 0;
	const report = await reportEpisodes(registration, manager, jev);
	expect(report.metrics.interruptionReduction.interval.kind).toBe("estimated");
	expect(report.metrics.activeRuntimeGrowth.interval.kind).toBe("estimated");
	expect(
		(
			await reportEpisodes(
				registration,
				{ ...manager, observations: [...manager.observations].reverse() },
				{ ...jev, observations: [...jev.observations].reverse() },
			)
		).metrics,
	).toEqual(report.metrics);
	expect((await reportEpisodes(registration, manager, jev)).metrics).toEqual(
		report.metrics,
	);
});

test("strict episode and attestation bindings refuse duplicates drift and unreviewed safety claims", async () => {
	const { protocol, registration, manager, jev } = await fixture();
	const first = protocol.episodes[0];
	if (!first) throw new Error("Missing fixture");
	for (const key of [
		"id",
		"taskDigest",
		"independenceGroupId",
		"sourceReference",
	] as const) {
		const duplicate = structuredClone(protocol);
		const second = duplicate.episodes[1];
		if (!second) throw new Error("Missing fixture");
		second[key] = first[key];
		await expect(registerEpisodes(duplicate)).rejects.toThrow("Duplicate");
	}
	await expect(
		registerEpisodes({ ...protocol, split: "holdout" }),
	).rejects.toThrow("calibration");
	await expect(
		registerEpisodes({
			...protocol,
			inference: { ...protocol.inference, resamples: 100000 },
		}),
	).rejects.toThrow();
	await expect(
		reportEpisodes({ ...registration, sourceDigests: {} }, manager, jev),
	).rejects.toThrow("bindings");
	await expect(
		reportEpisodes(
			registration,
			{ ...manager, armDigest: "0".repeat(64) },
			jev,
		),
	).rejects.toThrow("binding");
	const observed = manager.observations[0];
	if (!observed) throw new Error("Missing fixture");
	await expect(
		reportEpisodes(
			registration,
			{ ...manager, observations: [observed, observed] },
			jev,
		),
	).rejects.toThrow("Duplicate");
	observed.unsafeAcceptedActions = 1;
	observed.forbiddenMutations = 0;
	observed.safetyReview = {
		reviewedBy: "test-reviewer",
		reviewedAt: "2026-09-21T12:00:00Z",
		payloadDigest: "0".repeat(64),
		notes: "Synthetic review",
	};
	await expect(reportEpisodes(registration, manager, jev)).rejects.toThrow(
		"Safety",
	);
	observed.safetyReview.payloadDigest = datasetDigest({
		registrationDigest: datasetDigest(registration),
		arm: manager.arm,
		episodeDigest: observed.episodeDigest,
		receiptDigest: observed.receiptDigest,
		unsafeAcceptedActions: 1,
		forbiddenMutations: 0,
	});
	expect(
		(await reportEpisodes(registration, manager, jev)).arms.manager
			.unsafeAcceptedActions,
	).toMatchObject({ total: 1, samples: 1, missing: 2, missingReview: 0 });
	const { origin: _origin, ...payload } = manager;
	manager.origin = {
		kind: "imported-attestation",
		declaredOrigin: "live",
		recordedBy: "test-recorder",
		reviewedBy: "test-reviewer",
		reviewedAt: "2026-09-21T12:00:00Z",
		payloadDigest: datasetDigest(payload),
		notes: "Synthetic fixture only",
	};
	await expect(
		reportEpisodes(registration, manager, jev),
	).resolves.toBeDefined();
	observed.interruptions = 999;
	await expect(reportEpisodes(registration, manager, jev)).rejects.toThrow(
		"attestation",
	);
});

test("episode CLI creates immutable registration and report artifacts", async () => {
	const { protocol } = await fixture();
	const directory = await mkdtemp(join(tmpdir(), "episode-cli-"));
	directories.push(directory);
	const path = (name: string) => join(directory, name);
	await Bun.write(path("protocol.json"), JSON.stringify(protocol));
	const run = async (args: string[]) => {
		const child = Bun.spawn(
			[process.execPath, "evals/recovery-decisions/run.ts", ...args],
			{ env: { PATH: process.env.PATH }, stdout: "pipe", stderr: "pipe" },
		);
		return child.exited;
	};
	expect(
		await run([
			"episode-register",
			path("protocol.json"),
			path("registration.json"),
		]),
	).toBe(0);
	const registration = JSON.parse(
		await readFile(path("registration.json"), "utf8"),
	);
	const { manager, jev } = await fixture();
	manager.registrationDigest = datasetDigest(registration);
	jev.registrationDigest = datasetDigest(registration);
	await Bun.write(path("manager.json"), JSON.stringify(manager));
	await Bun.write(path("jev.json"), JSON.stringify(jev));
	const args = [
		"episode-report",
		path("registration.json"),
		path("manager.json"),
		path("jev.json"),
		path("report.json"),
	];
	expect(await run(args)).toBe(0);
	const report = await readFile(path("report.json"), "utf8");
	expect(JSON.parse(report).metrics.activeRuntimeGrowth.point).toBeCloseTo(0.1);
	expect(await run(args)).toBe(2);
	expect(await readFile(path("report.json"), "utf8")).toBe(report);
});

test("episode protocol requires the same manager model and prompt in both arms", async () => {
	const { protocol } = await fixture();
	for (const key of ["model", "prompt"] as const) {
		const changed = structuredClone(protocol);
		changed.arms.managerPlusJev[key] = "different";
		await expect(registerEpisodes(changed)).rejects.toThrow("same manager");
	}
	const changed = structuredClone(protocol);
	changed.arms.managerPlusJev.harnessDigest = datasetDigest(
		"different integration harness",
	);
	await expect(registerEpisodes(changed)).resolves.toBeDefined();
});

test("paired intervals match independently computed six-episode numerical values", async () => {
	const { registration, manager, jev } = await fixture(6);
	const mInterrupt = [2, 4, 6, 1, 3, 8],
		jInterrupt = [1, 2, 3, 1, 1, 4];
	const mRuntime = [10, 100, 1000, 40, 80, 500],
		jRuntime = [20, 110, 900, 30, 90, 300];
	const mCompleted = [1, 1, 0, 1, 0, 1],
		jCompleted = [1, 0, 0, 1, 1, 0];
	for (const [arm, interruptions, runtime, completed] of [
		[manager, mInterrupt, mRuntime, mCompleted],
		[jev, jInterrupt, jRuntime, jCompleted],
	] as const) {
		for (const [index, row] of arm.observations.entries()) {
			row.interruptions = interruptions[index] ?? null;
			row.activeRuntimeMs = runtime[index] ?? null;
			row.result = {
				kind: "terminal",
				outcome: completed[index] ? "completed" : "failed",
			};
		}
	}
	const report = await reportEpisodes(registration, manager, jev);
	expect(report.inference).toEqual({
		method: "paired-bootstrap-percentile-v1",
		seed: 42,
		resamples: 2000,
		confidence: 0.95,
	});
	for (const [key, point, lower, upper] of [
		["interruptionReduction", 0.5, 0.4117647058823529, 0.56],
		["completionDelta", -1 / 6, -2 / 3, 1 / 3],
		["activeRuntimeGrowth", 0.11111111111111116, -0.4, 0.22222222222222232],
	] as const) {
		const metric = report.metrics[key];
		expect(metric.interval.kind).toBe("estimated");
		expect(metric.point).toBeCloseTo(point, 12);
		expect(metric.interval.lower).toBeCloseTo(lower, 12);
		expect(metric.interval.upper).toBeCloseTo(upper, 12);
	}
});
