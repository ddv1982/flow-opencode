import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
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
import {
	createRequestBudget,
	type EpisodeReservationScope,
	reconcileRequestReservations,
	reserveRequest,
} from "../evals/recovery-decisions/request-budget.js";
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
	const f = await fixture(1000);
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

test("external abort during execution cancels the episode", async () => {
	const f = await fixture();
	const controller = new AbortController();
	let entered: () => void = () => {};
	const running = new Promise<void>((resolve) => {
		entered = resolve;
	});
	try {
		f.options.driver.run = async ({ signal }) => {
			entered();
			await new Promise<void>((resolve) => {
				signal.addEventListener("abort", () => resolve(), { once: true });
			});
		};
		const episode = runEpisode({ ...f.options, signal: controller.signal });
		await running;
		controller.abort();
		expect((await episode)?.observation.result).toEqual({
			kind: "terminal",
			outcome: "cancelled",
		});
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
	const f = await fixture(1000);
	try {
		f.options.driver.evaluate = async () => {
			throw new Error("evaluation failed");
		};
		f.options.driver.stop = async () => {
			await new Promise((resolve) => setTimeout(resolve, 1200));
		};
		const result = await runEpisode(f.options);
		expect(result?.observation.result.kind).toBe("unavailable");
		expect(result?.observation.activeRuntimeMs).toBeNull();
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("completed episode excludes confirmed cleanup past the deadline", async () => {
	const f = await fixture(2000);
	try {
		f.options.driver.stop = async () => {
			await new Promise((resolve) => setTimeout(resolve, 2500));
		};
		const result = await runEpisode(f.options);
		expect(result?.observation.result).toEqual({
			kind: "terminal",
			outcome: "completed",
		});
		expect(result?.observation.activeRuntimeMs).toBeLessThan(2000);
		expect(
			JSON.parse(
				await readFile(join(f.options.outputDirectory, "status.json"), "utf8"),
			).reason,
		).toBe("criteria-evaluated");
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("execution deadline starts after the durable start event", async () => {
	const f = await fixture();
	const original = globalThis.setTimeout;
	const scheduled: { header: boolean; start: boolean }[] = [];
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		const [handler, delay, ...parameters] = args;
		if (delay === 1000)
			scheduled.push({
				header: existsSync(join(f.options.outputDirectory, "header.json")),
				start: existsSync(
					join(f.options.outputDirectory, "events", "000000.json"),
				),
			});
		return original(handler, delay, ...parameters);
	}) as typeof setTimeout;
	try {
		const result = await runEpisode(f.options);
		expect(result?.observation.result).toEqual({
			kind: "terminal",
			outcome: "completed",
		});
		expect(scheduled).toEqual([
			{ header: false, start: false },
			{ header: true, start: true },
		]);
	} finally {
		globalThis.setTimeout = original;
		await rm(f.root, { recursive: true, force: true });
	}
});

test.each([
	["completed", true],
	["failed", false],
] as const)(
	"external abort during cleanup cannot replace a %s outcome",
	async (outcome, met) => {
		const f = await fixture();
		const controller = new AbortController();
		let entered: () => void = () => {};
		let release: () => void = () => {};
		const stopping = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			f.options.driver.evaluate = async () => ({
				met,
				evidence: { file: "after" },
			});
			f.options.driver.stop = async () => {
				entered();
				await barrier;
			};
			const running = runEpisode({ ...f.options, signal: controller.signal });
			await stopping;
			controller.abort();
			release();
			const result = await running;
			expect(result?.observation.result).toEqual({
				kind: "terminal",
				outcome,
			});
		} finally {
			release();
			await rm(f.root, { recursive: true, force: true });
		}
	},
);

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

async function meteredFixture() {
	const f = await fixture();
	const directory = join(f.root, "budget");
	const authorization = await createRequestBudget(directory, {
		schemaVersion: 1,
		origin: "simulation",
		purpose: "runner test",
		maxRequests: 4,
		maxMicroUsd: 20000,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
		models: [
			{
				model: "xai/grok-4.6",
				reservationMicroUsd: 5000,
				basis: { kind: "simulation" },
			},
		],
	});
	let scope: EpisodeReservationScope | undefined;
	const prepare = f.options.driver.prepare;
	f.options.driver.prepare = async (signal, input) => {
		scope = input;
		return prepare(signal, input);
	};
	f.options.driver.run = async () => {
		if (!scope) throw new Error("Missing reservation scope.");
		await reserveRequest(
			directory,
			"xai/grok-4.6",
			hash(authorization),
			undefined,
			scope,
		);
	};
	f.options.driver.reconcileReservations = async () => {
		if (!f.stopped() || !scope) throw new Error("Unconfirmed stop.");
		return reconcileRequestReservations(directory, hash(authorization), scope);
	};
	return { ...f, directory };
}
test("runner retains complete scoped reservations and recovers without the original ledger", async () => {
	const f = await meteredFixture();
	try {
		const result = await runEpisode(f.options);
		if (!result) throw new Error("Expected complete receipt.");
		expect(result.observation.reservedUsd).toBe(0.005);
		expect(result?.receipt.reservationCoverage).toBe("unknown");
		expect(result?.receipt.reservationScope).toMatchObject({
			registrationDigest: hash(f.options.registration),
			episodeId: "one",
			arm: "manager-only",
			harnessDigest: f.options.driver.harnessDigest,
		});
		expect(result?.receipt.events.slice(-2).map((event) => event.kind)).toEqual(
			["reservation-reconciliation", "terminal"],
		);
		await rm(f.directory, { recursive: true });
		expect(
			await recoverEpisodeJournal(
				f.options.registration,
				f.options.outputDirectory,
			),
		).toEqual(result);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("reconciliation failures preserve completed outcome with unknown spending", async () => {
	for (const malformed of [false, true]) {
		const f = await meteredFixture();
		try {
			const reconcile = f.options.driver.reconcileReservations;
			f.options.driver.reconcileReservations = async () => {
				if (!reconcile || !malformed) throw new Error("Ledger unavailable");
				const value = await reconcile();
				return { ...value, totalMicroUsd: value.totalMicroUsd + 1 };
			};
			const result = await runEpisode(f.options);
			expect(result?.observation).toMatchObject({
				reservedUsd: null,
				result: { kind: "terminal", outcome: "completed" },
			});
			expect(
				result?.receipt.events.some(
					(event) => event.kind === "reservation-reconciliation",
				),
			).toBe(false);
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	}
});

test("reconciliation waits do not enter episode timing and failed stops cannot reconcile", async () => {
	const f = await meteredFixture();
	try {
		const reconcile = f.options.driver.reconcileReservations;
		let began = 0,
			finished = 0;
		f.options.driver.reconcileReservations = async () => {
			began = performance.now();
			await new Promise((resolve) => setTimeout(resolve, 100));
			finished = performance.now();
			if (!reconcile) throw new Error("Missing reconciliation.");
			return reconcile();
		};
		const start = performance.now();
		const result = await runEpisode(f.options);
		expect(finished - began).toBeGreaterThanOrEqual(90);
		const events = result?.receipt.events.slice(-2);
		if (!events?.[0] || !events[1])
			throw new Error("Missing terminal accounting events.");
		expect(events[0].atMs).toBe(events[1].atMs);
		expect(
			performance.now() - start - (result?.observation.activeRuntimeMs ?? 0),
		).toBeGreaterThanOrEqual(90);
		expect(result?.observation.reservedUsd).toBe(0.005);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
	const broken = await meteredFixture();
	try {
		let reconciled = false;
		broken.options.driver.stop = async () => {
			throw new Error("Still running");
		};
		broken.options.driver.reconcileReservations = async () => {
			reconciled = true;
			throw new Error("Must not reconcile");
		};
		const result = await runEpisode(broken.options);
		expect(reconciled).toBe(false);
		expect(result?.observation.reservedUsd).toBeNull();
		expect(result?.observation.result.kind).toBe("unavailable");
	} finally {
		await rm(broken.root, { recursive: true, force: true });
	}
});

test("reconciliation can outlive the small-ledger deadline without losing scoped cost", async () => {
	const f = await meteredFixture();
	try {
		const reconcile = f.options.driver.reconcileReservations;
		Object.assign(f.options.driver, { reconciliationTimeoutMs: () => 7000 });
		f.options.driver.reconcileReservations = async () => {
			await new Promise((resolve) => setTimeout(resolve, 5100));
			if (!reconcile) throw new Error("Missing reconciliation.");
			return reconcile();
		};
		const result = await runEpisode(f.options);
		expect(result?.observation).toMatchObject({
			reservedUsd: 0.005,
			result: { kind: "terminal", outcome: "completed" },
		});
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
}, 10000);

test("a stalled reconciliation deadline source cannot hold the terminal receipt", async () => {
	const f = await meteredFixture();
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	try {
		let reconciled = false;
		f.options.driver.reconciliationTimeoutMs = () => new Promise(() => {});
		f.options.driver.reconcileReservations = async () => {
			reconciled = true;
			throw new Error("Must not reconcile after deadline source stalls.");
		};
		const result = await Promise.race([
			runEpisode(f.options),
			new Promise<"stalled">((resolve) => {
				watchdog = setTimeout(() => resolve("stalled"), 8500);
			}),
		]);
		expect(result).not.toBe("stalled");
		if (result === "stalled") return;
		expect(reconciled).toBe(false);
		expect(result?.observation).toMatchObject({
			reservedUsd: null,
			result: { kind: "terminal", outcome: "completed" },
		});
	} finally {
		clearTimeout(watchdog);
		await rm(f.root, { recursive: true, force: true });
	}
}, 11000);
