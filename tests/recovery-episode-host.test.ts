import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	createEpisodeHostDriver,
	type EpisodeHostOptions,
	episodeHostIdentity,
} from "../evals/recovery-decisions/episode-host.js";
import { runEpisode } from "../evals/recovery-decisions/episode-runner.js";

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
				executable: "/test/bun",
				actualVersion: "1.4.0",
				expectedVersion: "1.4.0",
				environment: {},
			},
			packageCache: "/test/cache",
			packageVersion: "1.0.0",
			opencodeVersion: "1.2.0",
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
				async createSession() {
					return "test-session";
				},
				async runPrompt(...args) {
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
	expect(await driver.prepare(signal)).toEqual({
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
		async record() {
			throw new Error("Unexpected wait");
		},
	});
	expect(f.prompts).toEqual([
		[
			"test-session",
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
			async record(event) {
				events.push(event.kind);
				controller.abort();
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
	await driver.run({ signal, async record() {} });
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
	).rejects.toThrow("not implemented");
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
	await first.run({ signal, async record() {} });
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
	await driver.run({ signal, async record() {} });
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
