import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevConfiguration } from "../evals/recovery-decisions/campaign.js";
import {
	type EpisodeDriver,
	recoverEpisodeJournal,
	runEpisode,
} from "../evals/recovery-decisions/episode-runner.js";
import { registerEpisodes } from "../evals/recovery-decisions/episodes.js";
import { datasetDigest as hash } from "../evals/recovery-decisions/schema.js";

async function fixture(timeoutMs = 1000) {
	const manager = {
		model: "fixture",
		prompt: "fixture",
		harnessDigest: hash("driver"),
	};
	const registration = await registerEpisodes({
		schemaVersion: 1,
		split: "calibration",
		calibrationEvidenceDigest: null,
		episodes: [
			{
				id: "one",
				taskDigest: hash("task"),
				initialStateDigest: hash({ file: "before" }),
				completionCriteria: "File equals after",
				sourceReference: "fixture",
				independenceGroupId: "one",
			},
		],
		arms: {
			managerOnly: manager,
			managerPlusJev: { ...manager, jev: JevConfiguration },
		},
		execution: { timeoutMs, resetProtocol: "Fresh fixture" },
		inference: {
			method: "paired-bootstrap-percentile-v1",
			seed: 42,
			resamples: 2000,
			confidence: 0.95,
		},
	});
	const root = await mkdtemp(join(tmpdir(), "episode-runner-"));
	let stopped = false;
	const driver: EpisodeDriver = {
		origin: "simulation",
		harnessDigest: manager.harnessDigest,
		async prepare() {
			return { task: "task", initialState: { file: "before" } };
		},
		async run({ record }) {
			await record({ kind: "wait-start" });
			await record({ kind: "intervention" });
			await record({ kind: "wait-end" });
		},
		async evaluate(criteria) {
			expect(criteria).toBe("File equals after");
			return { met: true, evidence: { file: "after" } };
		},
		async stop() {
			stopped = true;
		},
	};
	const options = {
		registration,
		episodeId: "one",
		arm: "manager-only" as const,
		outputDirectory: join(root, "run"),
		recordedBy: "fixture",
		origin: "simulation" as const,
		driver,
	};
	return { root, options, stopped: () => stopped };
}

test("runner persists and recovers a completed episode, refusing overwrite", async () => {
	const f = await fixture();
	try {
		const result = await runEpisode(f.options);
		if (!result) throw new Error("Expected receipt");
		expect(f.stopped()).toBe(true);
		expect(result?.observation).toMatchObject({
			result: { kind: "terminal", outcome: "completed" },
			interruptions: 1,
			reservedUsd: null,
			safetyReview: null,
		});
		expect(
			await recoverEpisodeJournal(
				f.options.registration,
				f.options.outputDirectory,
			),
		).toEqual(result);
		await expect(runEpisode(f.options)).rejects.toThrow();
		const cli = Bun.spawn(
			[
				process.execPath,
				"evals/recovery-decisions/run.ts",
				"episode-recover",
				join(f.options.outputDirectory, "registration.json"),
				f.options.outputDirectory,
				join(f.root, "recovered.json"),
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		expect(await cli.exited).toBe(0);
		expect(
			JSON.parse(await readFile(join(f.root, "recovered.json"), "utf8")),
		).toEqual(result);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("reset mismatch prevents execution and completion failure is retained", async () => {
	const f = await fixture();
	try {
		let ran = false;
		f.options.driver.prepare = async () => ({
			task: "task",
			initialState: "wrong",
		});
		f.options.driver.run = async () => {
			ran = true;
		};
		expect(await runEpisode(f.options)).toBeNull();
		expect(ran).toBe(false);
		expect(f.stopped()).toBe(true);
		f.options.outputDirectory = join(f.root, "failed");
		f.options.driver.prepare = async () => ({
			task: "task",
			initialState: { file: "before" },
		});
		f.options.driver.evaluate = async () => ({
			met: false,
			evidence: "mismatch",
		});
		expect((await runEpisode(f.options))?.observation.result).toEqual({
			kind: "terminal",
			outcome: "failed",
		});
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("deadline during operator wait confirms cleanup and rejects late events", async () => {
	const f = await fixture(60);
	let record: Parameters<EpisodeDriver["run"]>[0]["record"] | undefined;
	try {
		f.options.driver.run = async (context) => {
			record = context.record;
			await context.record({ kind: "wait-start" });
			await new Promise<void>((resolve) => {
				context.signal.addEventListener("abort", () => resolve(), {
					once: true,
				});
			});
		};
		const result = await runEpisode(f.options);
		expect(result?.observation.result).toEqual({
			kind: "terminal",
			outcome: "timed-out",
		});
		expect(f.stopped()).toBe(true);
		expect(result?.observation.humanWaitMs).toBeGreaterThan(0);
		await expect(record?.({ kind: "wait-end" })).rejects.toThrow("stopping");
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("unconfirmed cleanup and evaluator errors preserve unavailable evidence", async () => {
	const f = await fixture();
	try {
		f.options.driver.stop = async () => {
			throw new Error("secret host error");
		};
		expect((await runEpisode(f.options))?.observation.result.kind).toBe(
			"unavailable",
		);
		expect(
			await readFile(join(f.options.outputDirectory, "status.json"), "utf8"),
		).not.toContain("secret");
		f.options.outputDirectory = join(f.root, "evaluation-error");
		f.options.driver.stop = async () => {};
		f.options.driver.evaluate = async () => {
			throw new Error("secret evaluator error");
		};
		expect(
			(await runEpisode(f.options))?.observation.activeRuntimeMs,
		).toBeNull();
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("recovery detects holes and tampering, incomplete journal cannot count completion", async () => {
	const f = await fixture();
	try {
		await runEpisode(f.options);
		const events = join(f.options.outputDirectory, "events");
		await unlink(join(events, "000004.json"));
		expect(
			(
				await recoverEpisodeJournal(
					f.options.registration,
					f.options.outputDirectory,
				)
			).observation.result.kind,
		).toBe("unavailable");
		const path = join(events, "000001.json");
		const event = JSON.parse(await readFile(path, "utf8"));
		event.event.atMs += 1;
		await writeFile(path, JSON.stringify(event));
		await expect(
			recoverEpisodeJournal(f.options.registration, f.options.outputDirectory),
		).rejects.toThrow("chain");
		await unlink(path);
		await expect(
			recoverEpisodeJournal(f.options.registration, f.options.outputDirectory),
		).rejects.toThrow("sequence");
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("live mode and cancelled starts cannot prepare or consume authorization", async () => {
	const f = await fixture();
	try {
		let prepared = false;
		f.options.driver.prepare = async () => {
			prepared = true;
			return { task: "task", initialState: {} };
		};
		f.options.driver.origin = "live";
		await expect(runEpisode({ ...f.options, origin: "live" })).rejects.toThrow(
			"reviewed route cost bounds",
		);
		f.options.driver.origin = "simulation";
		await expect(
			runEpisode({ ...f.options, signal: AbortSignal.abort() }),
		).rejects.toThrow();
		expect(prepared).toBe(false);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("evaluator error stays unavailable when cleanup crosses deadline", async () => {
	const f = await fixture(60);
	try {
		f.options.driver.evaluate = async () => {
			throw new Error("evaluation failed");
		};
		f.options.driver.stop = async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		};
		const result = await runEpisode(f.options);
		expect(result?.observation.result.kind).toBe("unavailable");
		expect(result?.observation.activeRuntimeMs).toBeNull();
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("journal failure prevents acknowledged continuation and invalid transitions poison execution", async () => {
	const f = await fixture();
	try {
		let continued = false;
		f.options.driver.run = async ({ record }) => {
			await writeFile(
				join(f.options.outputDirectory, "events", "000001.json"),
				"occupied",
			);
			await record({ kind: "intervention" });
			continued = true;
		};
		await expect(runEpisode(f.options)).rejects.toThrow();
		expect(continued).toBe(false);
		expect(f.stopped()).toBe(true);
		f.options.outputDirectory = join(f.root, "invalid");
		f.options.driver.run = async ({ record }) => {
			await record({ kind: "wait-end" }).catch(() => {});
		};
		expect((await runEpisode(f.options))?.observation.result.kind).toBe(
			"unavailable",
		);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});
