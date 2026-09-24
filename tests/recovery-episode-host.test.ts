import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	access,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { JevConfiguration } from "../evals/recovery-decisions/campaign.js";
import {
	createEpisodeHostDriver,
	type EpisodeHostOptions,
	episodeHostIdentity,
} from "../evals/recovery-decisions/episode-host.js";
import {
	recoverEpisodeJournal,
	runEpisode,
} from "../evals/recovery-decisions/episode-runner.js";
import { registerEpisodes } from "../evals/recovery-decisions/episodes.js";
import {
	cancelRequestBudget,
	createRequestBudget,
	type EpisodeReservationScope,
	requestBudgetStatus,
	reserveRequest,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});
const fixture = {
	task: { instruction: "Change the result to fixed." },
	files: { "src/result.txt": "broken\n" },
	completion: {
		criteria: "The result file contains fixed followed by a newline.",
		files: { "src/result.txt": "fixed\n" },
	},
};
async function setup(end: "quiet" | "escalated" = "quiet") {
	const project = await mkdtemp(join(tmpdir(), "episode-host-test-"));
	dirs.push(project);
	let starts = 0,
		stops = 0;
	const prompts: unknown[] = [];
	let startOptions:
		| Parameters<NonNullable<EpisodeHostOptions["hostFactory"]>>[0]
		| undefined;
	const options: EpisodeHostOptions = {
		fixture,
		arm: "manager-only",
		manager: { model: "test/model", prompt: "Use the frozen task." },
		host: {
			toolchain: {
				executable: process.execPath,
				actualVersion: "1.4.0",
				expectedVersion: "1.4.0",
				environment: {},
			},
			packageCache: project,
			opencodeExecutable: process.execPath,
			packageVersion: "1.0.0",
			opencodeVersion: Bun.version,
		},
		hostFactory: async (input) => {
			starts++;
			startOptions = input;
			for (const [path, content] of Object.entries(input.files)) {
				await mkdir(dirname(join(project, path)), { recursive: true });
				await writeFile(join(project, path), content);
			}
			await mkdir(join(project, ".git"));
			await mkdir(join(project, ".opencode"));
			await writeFile(join(project, "opencode.json"), "{}");
			return {
				project,
				artifactIdentity: input.frozenArtifacts?.identity,
				artifactVerification: input.frozenArtifacts
					? {
							manifestDigest: datasetDigest(input.frozenArtifacts.identity),
							method:
								process.platform === "linux"
									? "copied-files-and-linux-process"
									: "copied-files-and-direct-spawn",
						}
					: undefined,
				async createSession() {
					return "test-session";
				},
				escalationQuestion(sessionId) {
					return {
						sessionId,
						calls: [
							{
								messageId: "message",
								callId: "call",
								input: {
									questions: [
										{
											question: "Which result?",
											header: "Result",
											options: [],
										},
									],
								},
							},
						],
					};
				},
				async runPrompt() {
					return "quiet" as const;
				},
				async runCommand(...args) {
					prompts.push(args);
					return end;
				},
				async stop() {
					stops++;
				},
			};
		},
	};
	return {
		options,
		project,
		prompts,
		get starts() {
			return starts;
		},
		get stops() {
			return stops;
		},
		get startOptions() {
			return startOptions;
		},
	};
}

test("host adapter binds actual seeded files, manager request, exact completion and idempotent stop", async () => {
	const f = await setup(),
		driver = await createEpisodeHostDriver(f.options);
	expect(driver.origin).toBe("live");
	expect(f.starts).toBe(0);
	const signal = new AbortController().signal;
	expect(await driver.prepare(signal)).toMatchObject({
		task: fixture.task,
		initialState: episodeHostIdentity(fixture).initialState,
	});
	expect(f.startOptions).toMatchObject({
		ambientConfig: "disabled",
		reviewerEnvironment: "disabled",
		nativeLlm: false,
		withFlow: true,
	});
	await driver.run({
		signal,
		async waitForOperator() {
			throw new Error("Unexpected operator wait");
		},
		async record() {
			throw new Error("Unexpected wait");
		},
	});
	expect(f.prompts).toEqual([
		[
			"test-session",
			"flow-auto",
			"Use the frozen task.\n\nChange the result to fixed.",
			"test/model",
		],
	]);
	expect(
		(
			await driver.evaluate(
				episodeHostIdentity(fixture).completionCriteria,
				signal,
			)
		).met,
	).toBe(false);
	await writeFile(join(f.project, "src/result.txt"), "fixed\n");
	expect(
		(
			await driver.evaluate(
				episodeHostIdentity(fixture).completionCriteria,
				signal,
			)
		).met,
	).toBe(true);
	await expect(driver.evaluate("different", signal)).rejects.toThrow(
		"criteria",
	);
	await driver.stop();
	await driver.stop();
	expect(f.stops).toBe(1);
});

test("escalated prompts wait for cancellation without inventing an intervention", async () => {
	const f = await setup("escalated"),
		driver = await createEpisodeHostDriver(f.options),
		controller = new AbortController(),
		events: string[] = [];
	await driver.prepare(controller.signal);
	await expect(
		driver.run({
			signal: controller.signal,
			async record() {},
			async waitForOperator() {
				events.push("wait-start");
				controller.abort();
				throw new Error("Episode wait cancelled.");
			},
		}),
	).rejects.toThrow("cancelled");
	expect(events).toEqual(["wait-start"]);
	expect(f.prompts).toHaveLength(1);
	await driver.stop();
	expect(f.stops).toBe(1);
});

test("traversal reserved paths symlinks and undeclared files are refused", async () => {
	const f = await setup();
	for (const path of [
		"../outside",
		"/absolute",
		"src/../outside",
		".git/config",
		".opencode/plugin.js",
		"opencode.json",
		"C:\\outside",
	]) {
		await expect(
			createEpisodeHostDriver({
				...f.options,
				fixture: { ...fixture, files: { [path]: "content" } },
			}),
		).rejects.toThrow();
	}
	expect(f.starts).toBe(0);
	const driver = await createEpisodeHostDriver(f.options),
		signal = new AbortController().signal;
	await driver.prepare(signal);
	await driver.run({
		signal,
		async waitForOperator() {
			throw new Error("Unexpected operator wait");
		},
		async record() {},
	});
	await writeFile(join(f.project, "undeclared.txt"), "unexpected");
	await expect(
		driver.evaluate(episodeHostIdentity(fixture).completionCriteria, signal),
	).rejects.toThrow("Undeclared");
	await rm(join(f.project, "undeclared.txt"));
	await rm(join(f.project, "src/result.txt"));
	await symlink(
		join(f.project, "opencode.json"),
		join(f.project, "src/result.txt"),
	);
	await expect(
		driver.evaluate(episodeHostIdentity(fixture).completionCriteria, signal),
	).rejects.toThrow("symlinks");
	await driver.stop();
});

test("unsupported treatment and live runner gating refuse before any host start", async () => {
	const f = await setup();
	await expect(
		createEpisodeHostDriver({ ...f.options, arm: "manager-plus-jev" }),
	).rejects.toThrow("requires isolated treatment");
	const driver = await createEpisodeHostDriver(f.options);
	await expect(
		runEpisode({
			registration: {},
			episodeId: "test",
			arm: "manager-only",
			outputDirectory: join(f.project, "run"),
			recordedBy: "test",
			origin: "live",
			driver,
		}),
	).rejects.toThrow("reviewed route cost bounds");
	expect(f.starts).toBe(0);
	await expect(
		runEpisode({
			registration: {},
			episodeId: "test",
			arm: "manager-only",
			outputDirectory: join(f.project, "run"),
			recordedBy: "test",
			origin: "simulation",
			driver,
		}),
	).rejects.toThrow("origin mismatch");
	expect(f.starts).toBe(0);
});

test("fixture definitions share harness identity and failed stop remains unconfirmed", async () => {
	const f = await setup(),
		first = await createEpisodeHostDriver(f.options),
		changed = await createEpisodeHostDriver({
			...f.options,
			fixture: {
				...fixture,
				completion: {
					...fixture.completion,
					files: { "src/result.txt": "other" },
				},
			},
		});
	expect(changed.harnessDigest).toBe(first.harnessDigest);
	const original = f.options.hostFactory;
	if (!original) throw new Error("Missing test factory");
	const failing = await createEpisodeHostDriver({
		...f.options,
		hostFactory: async (options) => ({
			...(await original(options)),
			async stop() {
				throw new Error("process still alive");
			},
		}),
	});
	await failing.prepare(new AbortController().signal);
	await expect(failing.stop()).rejects.toThrow("process still alive");
});

test("episode-specific task reset and completion identity bind fixtures under one harness", async () => {
	const f = await setup();
	const other = {
		task: { instruction: "A different task" },
		files: { "src/result.txt": "another seed" },
		completion: {
			criteria: "Other result",
			files: { "src/result.txt": "another completion" },
		},
	};
	const first = await createEpisodeHostDriver(f.options),
		second = await createEpisodeHostDriver({ ...f.options, fixture: other });
	expect(first.harnessDigest).toBe(second.harnessDigest);
	const identity = episodeHostIdentity(fixture),
		changed = episodeHostIdentity(other);
	expect(identity.task).not.toEqual(changed.task);
	expect(identity.initialState).not.toEqual(changed.initialState);
	expect(identity.completionCriteria).not.toBe(changed.completionCriteria);
	const signal = new AbortController().signal;
	await first.prepare(signal);
	await first.run({
		signal,
		async waitForOperator() {
			throw new Error("Unexpected operator wait");
		},
		async record() {},
	});
	await expect(
		first.evaluate(changed.completionCriteria, signal),
	).rejects.toThrow("criteria");
	await expect(
		first.evaluate(fixture.completion.criteria, signal),
	).rejects.toThrow("criteria");
	await first.stop();
});

test("generated directories are frozen completion allowances and do not weaken reset checks", async () => {
	const f = await setup(),
		allowed = { ...fixture, generatedDirectories: [".flow"] },
		driver = await createEpisodeHostDriver({ ...f.options, fixture: allowed }),
		signal = new AbortController().signal;
	await driver.prepare(signal);
	await driver.run({
		signal,
		async waitForOperator() {
			throw new Error("Unexpected operator wait");
		},
		async record() {},
	});
	await mkdir(join(f.project, ".flow"));
	await writeFile(join(f.project, ".flow/session.json"), "{}");
	await writeFile(join(f.project, "src/result.txt"), "fixed\n");
	expect(
		(
			await driver.evaluate(
				episodeHostIdentity(allowed).completionCriteria,
				signal,
			)
		).met,
	).toBe(true);
	await expect(
		driver.evaluate(episodeHostIdentity(fixture).completionCriteria, signal),
	).rejects.toThrow("criteria");
	await writeFile(join(f.project, "stray.txt"), "unexpected");
	await expect(
		driver.evaluate(episodeHostIdentity(allowed).completionCriteria, signal),
	).rejects.toThrow("Undeclared");
	await driver.stop();
	const fresh = await setup(),
		original = fresh.options.hostFactory;
	if (!original) throw new Error("Missing factory");
	const dirty = await createEpisodeHostDriver({
		...fresh.options,
		fixture: allowed,
		hostFactory: async (options) => {
			const host = await original(options);
			await mkdir(join(host.project, ".flow"));
			await writeFile(join(host.project, ".flow/leftover.json"), "{}");
			return host;
		},
	});
	await expect(dirty.prepare(signal)).rejects.toThrow("Undeclared");
	await dirty.stop();
});

for (const arm of ["manager-only", "manager-plus-jev"] as const)
	test(`simulation episode ${arm} carries the arm into the shared command`, async () => {
		const f = await setup();
		f.options.arm = arm;
		f.options.host.recoveryTreatment = {
			origin: "simulation",
			arm,
			script: { kind: "guarded-reset-v1", outcome: "accepted" },
		};
		const driver = await createEpisodeHostDriver(f.options);
		expect(driver.origin).toBe("simulation");
		const signal = new AbortController().signal;
		await driver.prepare(signal);
		expect(f.startOptions?.recoveryTreatment).toEqual(
			f.options.host.recoveryTreatment,
		);
		await driver.run({
			signal,
			async waitForOperator() {
				throw new Error("Unexpected operator wait");
			},
			async record() {
				throw new Error("Unexpected wait");
			},
		});
		expect(f.prompts).toEqual([
			[
				"test-session",
				"flow-auto",
				`${arm === "manager-plus-jev" ? "--recovery=delegated --recovery-calls=3 --recovery-usd=0.01 " : ""}Use the frozen task.\n\nChange the result to fixed.`,
				"test/model",
			],
		]);
		await driver.stop();
	});

test("host identity freezes its operator policy before execution", async () => {
	const f = await setup();
	const policy = { kind: "file-mailbox-v1" as const, maxInterventions: 1 };
	const driver = await createEpisodeHostDriver({
		...f.options,
		operator: policy,
	});
	const disabled = await createEpisodeHostDriver(f.options);
	expect(driver.harnessDigest).not.toBe(disabled.harnessDigest);
	policy.maxInterventions = 50;
	if (!driver.operatorPolicy) throw new Error("Missing policy");
	expect(Reflect.set(driver.operatorPolicy, "maxInterventions", 50)).toBe(
		false,
	);
	expect(driver.operatorPolicy).toEqual({
		kind: "file-mailbox-v1",
		maxInterventions: 1,
	});
	await driver.stop();
});

test("registered cache byte changes refuse before host startup", async () => {
	const f = await setup();
	await writeFile(join(f.project, "dependency.js"), "original");
	const driver = await createEpisodeHostDriver(f.options);
	await writeFile(join(f.project, "dependency.js"), "modified");
	const changed = await createEpisodeHostDriver(f.options);
	expect(changed.harnessDigest).not.toBe(driver.harnessDigest);
	await expect(driver.prepare(new AbortController().signal)).rejects.toThrow(
		"bytes changed",
	);
	expect(f.starts).toBe(0);
	await driver.stop();
});
test("driver snapshots launch configuration and refuses missing observed identity", async () => {
	const f = await setup();
	const driver = await createEpisodeHostDriver(f.options);
	f.options.host.opencodeExecutable = "/changed/opencode";
	f.options.host.toolchain = {
		...f.options.host.toolchain,
		executable: "/changed/bun",
	};
	f.options.host.opencodeVersion = "0.0.0";
	const manifest = driver.expectedHostArtifacts;
	if (!manifest) throw new Error("Missing artifact identity");
	manifest.opencode.bytes.sha256 = "0".repeat(64);
	await driver.prepare(new AbortController().signal);
	expect(f.startOptions?.frozenArtifacts?.opencodeExecutable).toBe(
		process.execPath,
	);
	expect(f.startOptions?.opencodeVersion).toBe(Bun.version);
	expect(driver.expectedHostArtifacts?.opencode.bytes.sha256).not.toBe(
		"0".repeat(64),
	);
	await driver.stop();
	const other = await setup();
	const original = other.options.hostFactory;
	if (!original) throw new Error("Missing factory");
	other.options.hostFactory = async (options) => ({
		...(await original(options)),
		artifactIdentity: undefined,
	});
	const unverified = await createEpisodeHostDriver(other.options);
	await expect(
		unverified.prepare(new AbortController().signal),
	).rejects.toThrow("did not attest");
	await unverified.stop();
});

test("native driver reconciles only a prepared gate after fulfilled stop and preserves composed scope", async () => {
	const f = await setup();
	const root = await mkdtemp(join(tmpdir(), "episode-host-budget-"));
	dirs.push(root);
	const directory = join(root, "ledger");
	const authorization = await createRequestBudget(directory, {
		schemaVersion: 1,
		origin: "simulation",
		purpose: "host test",
		maxRequests: 2,
		maxMicroUsd: 10000,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
		models: [
			{
				model: "xai/grok-4.6",
				reservationMicroUsd: 5000,
				basis: { kind: "simulation" },
			},
		],
	});
	f.options.manager.model = "xai/grok-4.6";
	f.options.host.requestBudget = {
		directory,
		authorizationDigest: datasetDigest(authorization),
		managerModel: "xai/grok-4.6",
	};
	const original = f.options.hostFactory;
	let release = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.options.hostFactory = async (input) => {
		if (!original) throw new Error("Missing host factory");
		const host = await original(input);
		return {
			...host,
			stop: async () => {
				await pending;
				await host.stop();
			},
		};
	};
	const driver = await createEpisodeHostDriver(f.options);
	const scope: EpisodeReservationScope = {
		executionId: randomUUID(),
		registrationDigest: datasetDigest("registration"),
		episodeId: "one",
		arm: "manager-only",
		harnessDigest: datasetDigest("composed wrapper"),
	};
	const frozen = structuredClone(scope);
	await driver.prepare(new AbortController().signal, scope);
	Object.assign(scope, { episodeId: "mutated" });
	expect(f.startOptions?.requestBudget?.scope).toEqual(frozen);
	if (!driver.reconcileReservations) throw new Error("Missing reconciliation.");
	await expect(driver.reconcileReservations()).rejects.toThrow("not complete");
	const stopping = driver.stop();
	await expect(driver.reconcileReservations()).rejects.toThrow("not complete");
	release();
	await stopping;
	expect(await driver.reconcileReservations()).toMatchObject({
		scope: frozen,
		claims: [],
		totalMicroUsd: 0,
	});
});

test("ungated and failed-stop native drivers cannot claim complete zero", async () => {
	const f = await setup();
	const driver = await createEpisodeHostDriver(f.options);
	await driver.prepare(new AbortController().signal);
	await driver.stop();
	if (!driver.reconcileReservations) throw new Error("Missing reconciliation.");
	await expect(driver.reconcileReservations()).rejects.toThrow("not complete");
	const failing = await setup();
	const original = failing.options.hostFactory;
	failing.options.hostFactory = async (input) => {
		if (!original) throw new Error("Missing host factory");
		return {
			...(await original(input)),
			stop: async () => {
				throw new Error("Stop failed.");
			},
		};
	};
	const failed = await createEpisodeHostDriver(failing.options);
	await failed.prepare(new AbortController().signal);
	await expect(failed.stop()).rejects.toThrow("Stop failed");
	if (!failed.reconcileReservations) throw new Error("Missing reconciliation.");
	await expect(failed.reconcileReservations()).rejects.toThrow("not complete");
});

test("live source driver binds credential policy and preserves runtime scope while invalid registration refuses startup", async () => {
	const f = await setup();
	f.options.host.recoveryTreatment = { origin: "live", arm: "manager-only" };
	f.options.host.providerCredentials = "disabled";
	f.options.host.requestBudget = {
		directory: f.project,
		authorizationDigest: "a".repeat(64),
		managerModel: "openai/gpt-5.6-terra",
	};
	f.options.manager.model = "openai/gpt-5.6-terra";
	const omitted = { ...f.options.host };
	delete omitted.providerCredentials;
	await expect(
		createEpisodeHostDriver({ ...f.options, host: omitted }),
	).rejects.toThrow("explicit provider credential policy");
	const driver = await createEpisodeHostDriver(f.options);
	const inherited = await createEpisodeHostDriver({
		...f.options,
		host: { ...f.options.host, providerCredentials: "inherit" },
	});
	expect(driver.origin).toBe("live");
	expect(driver.harnessDigest).not.toBe(inherited.harnessDigest);
	await expect(
		runEpisode({
			registration: {},
			episodeId: "episode",
			arm: "manager-only",
			outputDirectory: join(f.project, "journal"),
			recordedBy: "test",
			origin: "live",
			driver,
		}),
	).rejects.toThrow();
	expect(f.starts).toBe(0);
	const scope: EpisodeReservationScope = {
		executionId: randomUUID(),
		registrationDigest: "b".repeat(64),
		episodeId: "episode",
		arm: "manager-only",
		harnessDigest: "c".repeat(64),
	};
	await driver.prepare(new AbortController().signal, scope);
	expect(f.startOptions?.requestBudget?.scope).toEqual(scope);
	expect(f.startOptions?.recoveryTreatment).toEqual({
		origin: "live",
		arm: "manager-only",
	});
	expect(f.startOptions?.frozenArtifacts?.identity.packageCache).toBeNull();
	await driver.stop();
	expect(f.prompts).toEqual([]);
});

async function liveFixture(
	model: "openai/gpt-5.6-terra" | "xai/grok-4.6",
	arm: "manager-only" | "manager-plus-jev",
) {
	const f = await setup();
	const directory = join(f.project, "budget");
	const authorization = await createRequestBudget(directory, {
		schemaVersion: 1,
		origin: "live",
		purpose: "Synthetic local admission test; no external dispatch",
		maxRequests: 10,
		maxMicroUsd: 100000,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
		models: (arm === "manager-plus-jev"
			? [model, "typesafe/jev-1.13.0"]
			: [model]
		).map((model) => ({
			model,
			reservationMicroUsd: 5000,
			basis: {
				kind: "reviewed-upper-bound",
				reviewedBy: "test fixture",
				evidenceDigest: "a".repeat(64),
			},
		})),
	});
	f.options.arm = arm;
	f.options.manager.model = model;
	f.options.host.recoveryTreatment = { origin: "live", arm };
	f.options.host.providerCredentials = "disabled";
	f.options.host.toolchain.environment.TYPESAFE_API_KEY = "synthetic-test-only";
	f.options.host.requestBudget = {
		directory,
		authorizationDigest: datasetDigest(authorization),
		managerModel: model,
	};
	const project = join(f.project, "workload");
	await mkdir(project);
	const original = f.options.hostFactory;
	f.options.hostFactory = async (input) => {
		if (!original) throw new Error("Missing factory");
		const host = await original(input);
		for (const [path, content] of Object.entries(input.files)) {
			await mkdir(dirname(join(project, path)), { recursive: true });
			await writeFile(join(project, path), content);
		}
		return {
			...host,
			project,
			async runCommand(...args) {
				await host.runCommand(...args);
				for (const selected of arm === "manager-only"
					? [model]
					: [model, "typesafe/jev-1.13.0"]) {
					await reserveRequest(
						directory,
						selected,
						datasetDigest(authorization),
						undefined,
						input.requestBudget?.scope,
					);
				}
				await writeFile(join(project, "src/result.txt"), "fixed\n");
				return "quiet" as const;
			},
		};
	};
	return {
		f,
		directory,
		authorization,
		async registration(
			driver: Awaited<ReturnType<typeof createEpisodeHostDriver>>,
			changes = {},
		) {
			const identity = episodeHostIdentity(fixture);
			const manager = {
				...f.options.manager,
				harnessDigest: driver.harnessDigest,
			};
			return registerEpisodes({
				schemaVersion: 1,
				split: "calibration",
				calibrationEvidenceDigest: null,
				episodes: [
					{
						id: "live-test",
						taskDigest: datasetDigest(identity.task),
						initialStateDigest: datasetDigest(identity.initialState),
						completionCriteria: identity.completionCriteria,
						sourceReference: "synthetic",
						independenceGroupId: "synthetic",
						...changes,
					},
				],
				arms: {
					managerOnly: manager,
					managerPlusJev: { ...manager, jev: JevConfiguration },
				},
				execution: { timeoutMs: 5000, resetProtocol: "fresh fixture" },
				inference: {
					method: "paired-bootstrap-percentile-v1",
					seed: 42,
					resamples: 2000,
					confidence: 0.95,
				},
			});
		},
	};
}

for (const model of ["openai/gpt-5.6-terra", "xai/grok-4.6"] as const) {
	for (const arm of ["manager-only", "manager-plus-jev"] as const) {
		test(`live runner completes and recovers scoped local evidence for ${model} ${arm}`, async () => {
			const l = await liveFixture(model, arm);
			const base = await createEpisodeHostDriver(l.f.options);
			const driver = {
				...base,
				harnessDigest: datasetDigest({
					base: base.harnessDigest,
					wrapper: "local-test",
				}),
			};
			const registration = await l.registration(driver);
			const outputDirectory = join(l.f.project, "journal");
			const result = await runEpisode({
				registration,
				driver,
				arm,
				episodeId: "live-test",
				outputDirectory,
				recordedBy: "synthetic fixture",
				origin: "live",
			});
			if (!result) throw new Error("Missing episode result");
			expect(result.observation).toMatchObject({
				result: { kind: "terminal", outcome: "completed" },
				reservedUsd: arm === "manager-only" ? 0.005 : 0.01,
				safetyReview: null,
			});
			expect(l.f.starts).toBe(1);
			expect(l.f.stops).toBe(1);
			expect(l.f.prompts).toHaveLength(1);
			expect(
				await recoverEpisodeJournal(registration, outputDirectory),
			).toEqual(result);
			expect(l.f.startOptions?.requestBudget?.scope).toMatchObject({
				arm,
				registrationDigest: datasetDigest(registration),
				harnessDigest: driver.harnessDigest,
			});
		});
	}
}

for (const failure of [
	"task",
	"state",
	"criteria",
	"policy",
	"key",
	"budget",
	"cancelled",
	"exhausted",
	"one-slot",
	"digest",
	"simulation",
	"expired",
	"manager",
	"aborted",
	"unaffordable",
	"combined-cost",
	"missing-jev",
] as const) {
	test(`live runner refuses ${failure} before host startup and journal creation`, async () => {
		const l = await liveFixture("xai/grok-4.6", "manager-plus-jev");
		const changes: Record<string, string> = {};
		if (failure === "task") changes.taskDigest = "b".repeat(64);
		if (failure === "state") changes.initialStateDigest = "b".repeat(64);
		if (failure === "criteria") changes.completionCriteria = "different";
		if (failure === "policy") delete l.f.options.host.providerCredentials;
		if (failure === "key")
			delete l.f.options.host.toolchain.environment.TYPESAFE_API_KEY;
		if (failure === "budget") delete l.f.options.host.requestBudget;
		if (failure === "cancelled") await cancelRequestBudget(l.directory);
		if (failure === "exhausted")
			for (let i = 0; i < 10; i++)
				await reserveRequest(
					l.directory,
					"xai/grok-4.6",
					datasetDigest(l.authorization),
				);
		if (failure === "one-slot")
			for (let i = 0; i < 9; i++)
				await reserveRequest(
					l.directory,
					"xai/grok-4.6",
					datasetDigest(l.authorization),
				);
		if (failure === "digest" && l.f.options.host.requestBudget)
			l.f.options.host.requestBudget.authorizationDigest = "b".repeat(64);
		if (
			failure === "simulation" ||
			failure === "expired" ||
			failure === "manager" ||
			failure === "unaffordable" ||
			failure === "combined-cost" ||
			failure === "missing-jev"
		) {
			const authorization = structuredClone(l.authorization);
			if (failure === "unaffordable") authorization.maxMicroUsd = 1;
			if (failure === "combined-cost") authorization.maxMicroUsd = 5000;
			if (failure === "missing-jev")
				authorization.models = authorization.models.filter(
					(row) => row.model !== "typesafe/jev-1.13.0",
				);
			if (failure === "simulation") authorization.origin = "simulation";
			if (failure === "expired")
				authorization.expiresAt = "2020-01-01T00:00:00.000Z";
			if (failure === "manager") {
				const row = authorization.models[0];
				if (!row) throw new Error("Missing model");
				row.model = "openai/gpt-5.6-terra";
			}
			await writeFile(
				join(l.directory, "authorization.json"),
				JSON.stringify(authorization),
			);
			if (l.f.options.host.requestBudget)
				l.f.options.host.requestBudget.authorizationDigest =
					datasetDigest(authorization);
		}
		const expectedError = {
			task: "differs from frozen host configuration",
			state: "differs from frozen host configuration",
			criteria: "differs from frozen host configuration",
			policy: "explicit provider credential policy",
			key: "toolchain credential",
			budget: "requires a request budget",
			cancelled: "Live evaluation authorization unavailable",
			exhausted: "Live episode request budget exhausted",
			"one-slot": "Live episode request budget exhausted",
			digest: "Live evaluation authorization unavailable",
			simulation: "Live evaluation authorization unavailable",
			expired: "Live evaluation authorization unavailable",
			manager: "Live evaluation authorization unavailable",
			aborted: /abort/i,
			unaffordable: "Live episode request budget exhausted",
			"combined-cost": "Live episode request budget exhausted",
			"missing-jev": "Live evaluation authorization unavailable",
		}[failure];

		const before = await requestBudgetStatus(l.directory);
		const driver = await createEpisodeHostDriver(l.f.options);
		const registration = await l.registration(driver, changes);
		const outputDirectory = join(l.f.project, "journal");
		await expect(
			runEpisode({
				registration,
				driver,
				arm: "manager-plus-jev",
				episodeId: "live-test",
				outputDirectory,
				recordedBy: "test",
				origin: "live",
				...(failure === "aborted" ? { signal: AbortSignal.abort() } : {}),
			}),
		).rejects.toThrow(expectedError);
		expect(l.f.starts).toBe(0);
		expect(l.f.prompts).toEqual([]);
		expect(await requestBudgetStatus(l.directory)).toEqual(before);
		await expect(access(outputDirectory)).rejects.toThrow();
	});
}

test("cancellation during live admission prevents journal creation and preparation", async () => {
	const l = await liveFixture("xai/grok-4.6", "manager-only");
	const driver = await createEpisodeHostDriver(l.f.options);
	const registration = await l.registration(driver);
	const controller = new AbortController();
	const admit = driver.admitLive;
	if (!admit) throw new Error("Missing admission");
	driver.admitLive = async (input, signal) => {
		await admit(input, signal);
		controller.abort();
	};
	const outputDirectory = join(l.f.project, "journal");
	await expect(
		runEpisode({
			registration,
			driver,
			arm: "manager-only",
			episodeId: "live-test",
			outputDirectory,
			recordedBy: "test",
			origin: "live",
			signal: controller.signal,
		}),
	).rejects.toThrow();
	expect(l.f.starts).toBe(0);
	expect((await requestBudgetStatus(l.directory)).consumed).toBe(0);
	await expect(access(outputDirectory)).rejects.toThrow();
});
