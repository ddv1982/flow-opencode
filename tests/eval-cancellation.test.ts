import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveReleaseDecision } from "../evals/analysis.js";
import {
	CampaignCancelled,
	withCampaignSignals,
} from "../evals/campaign-stop.js";
import { parseCaseCatalog } from "../evals/catalog.js";
import {
	deriveRetainedFailure,
	RetainedScenarioEvidenceSchema,
} from "../evals/grader-input.js";
import { releaseCatalog } from "../evals/release-policy.js";
import { parseReport } from "../evals/report.js";

describe("campaign signal ownership", () => {
	for (const result of ["return", "throw", "cancel"] as const) {
		test(`removes its exact listeners after ${result}`, async () => {
			const before = [
				process.listeners("SIGINT"),
				process.listeners("SIGTERM"),
			];
			let cleanup = 0;
			let aborts = 0;
			const run = withCampaignSignals(async (signal) => {
				try {
					if (result === "throw") throw new Error("fixture failure");
					if (result === "cancel") {
						signal.addEventListener("abort", () => aborts++);
						process.emit("SIGINT");
						process.emit("SIGTERM");
						expect(signal.reason).toBeInstanceOf(CampaignCancelled);
						expect(signal.reason.exitCode).toBe(130);
						signal.throwIfAborted();
					}
					return 7;
				} finally {
					cleanup++;
				}
			});
			if (result === "throw")
				await expect(run).rejects.toThrow("fixture failure");
			else expect(await run).toBe(result === "cancel" ? 130 : 7);
			expect(cleanup).toBe(1);
			expect(aborts).toBe(result === "cancel" ? 1 : 0);
			expect([
				process.listeners("SIGINT"),
				process.listeners("SIGTERM"),
			]).toEqual(before);
		});
	}
});

type FixtureMode =
	| "complete"
	| "finalize-read"
	| "finalize-write"
	| "legacy-write"
	| "cassette-write"
	| "preflight-host-cleanup-failure"
	| "host-cleanup-failure"
	| "provider-outcome-stop"
	| "provider-transcript-stop"
	| "provider-poll-stop"
	| "provider-poll-outcome-stop"
	| "budget-stop"
	| "step"
	| "host"
	| "preflight"
	| "last-cleanup"
	| "cleanup-failure"
	| "persistence-failure";

async function runSignalledFixture(
	root: string,
	mode: FixtureMode,
	signal: "SIGINT" | "SIGTERM",
) {
	const child = spawn(
		process.execPath,
		[
			join(import.meta.dir, "fixtures", "eval-cancellation-child.ts"),
			root,
			mode,
		],
		{
			cwd: root,
			// Deliberately do not forward API keys, reviewer overrides or global auth.
			env: {
				PATH: process.env.PATH,
				HOME: root,
				XDG_CONFIG_HOME: join(root, "config"),
				XDG_DATA_HOME: join(root, "data"),
				XDG_CACHE_HOME: join(root, "cache"),
				FLOW_EVAL_NO_AUTH_COPY: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	const events: string[] = [];
	let stdout = "";
	let stderr = "";
	let pending = "";
	let expired = false;
	const secondSignal = signal === "SIGINT" ? "SIGTERM" : "SIGINT";
	// Timing bounds detect a hang; they never decide when a signal is delivered.
	const timeout = setTimeout(() => {
		expired = true;
		child.kill("SIGKILL");
	}, 15_000);
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (data: string) => {
		stderr += data;
	});
	child.stdout.on("data", (data: string) => {
		stdout += data;
		pending += data;
		let newline = pending.indexOf("\n");
		while (newline !== -1) {
			const line = pending.slice(0, newline);
			pending = pending.slice(newline + 1);
			if (line.startsWith("@@eval-cancellation:")) {
				const name = line.slice("@@eval-cancellation:".length);
				events.push(name);
				if (name === "ready") child.kill(signal);
				if (name === "cleanup-wait") child.kill(secondSignal);
				// Acknowledgment proves the repeated OS signal reached the child
				// before cleanup is released; no sleep/coalesced signal race.
				if (name === `signal:${secondSignal}`) child.stdin.end("release\n");
			}
			newline = pending.indexOf("\n");
		}
	});
	try {
		const status = await new Promise<{
			code: number | null;
			signal: NodeJS.Signals | null;
		}>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, exitSignal) =>
				resolve({ code, signal: exitSignal }),
			);
		});
		if (expired)
			throw new Error(`Cancellation fixture hung.\n${stdout}\n${stderr}`);
		return { ...status, events, stdout, stderr };
	} finally {
		clearTimeout(timeout);
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	}
}

async function reportDirectory(root: string): Promise<string> {
	const directory = join(root, "evals", "results");
	const reports = (await readdir(directory)).filter((name) =>
		name.endsWith(".v2"),
	);
	expect(reports).toHaveLength(1);
	return join(directory, reports[0] ?? "missing");
}

// POSIX process signals are not supported consistently by Windows/Bun.
const signalTest = process.platform === "win32" ? test.skip : test;
describe("real runner cancellation reports without provider spend", () => {
	signalTest(
		"R27-01 over-budget operator stop preserves observations and publishes a budget-stopped report",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "flow-eval-budget-stop-"));
			try {
				const result = await runSignalledFixture(
					root,
					"budget-stop",
					"SIGTERM",
				);
				expect(result.code).toBe(143);
				expect(result.stderr).toBe("");
				const directory = await reportDirectory(root);
				const catalog = parseCaseCatalog(
					JSON.parse(await readFile(join(directory, "catalog.json"), "utf8")),
				);
				if (!catalog.ok) throw new Error("Invalid fixture catalog");
				const parsed = parseReport(
					JSON.parse(await readFile(join(directory, "report.json"), "utf8")),
					catalog.value,
				);
				if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
				const report = parsed.value;
				expect(report.completion).toMatchObject({
					status: "stopped",
					cause: "budget",
					observed: { attempts: 1 },
				});
				expect(report.completion.observed.wallClockMs).toBeGreaterThan(
					report.plan.budget.maxWallClockMs,
				);
				expect(report.attempts).toHaveLength(1);
				expect(report.attempts[0]?.outcome).toMatchObject({
					kind: "product",
					passed: true,
				});
				expect(
					result.events.filter((name) => name.startsWith("cleaned:")),
				).toEqual(["cleaned:0", "cleaned:1", "cleaned:2"]);
				expect(
					result.events.filter((name) => name.startsWith("start:")),
				).toEqual(["start:0", "start:1", "start:2"]);
				const results = join(root, "evals", "results");
				const legacy = (await readdir(results)).find((name) =>
					name.endsWith(".json"),
				);
				expect(
					JSON.parse(await readFile(join(results, legacy ?? "missing"), "utf8"))
						.completion,
				).toEqual(report.completion);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
		20_000,
	);

	for (const mode of [
		"provider-outcome-stop",
		"provider-transcript-stop",
		"provider-poll-stop",
		"provider-poll-outcome-stop",
	] as const) {
		signalTest(
			`R20-01 runner retains observed provider failure after ${mode}`,
			async () => {
				const root = await mkdtemp(join(tmpdir(), "flow-eval-provider-stop-"));
				try {
					const result = await runSignalledFixture(root, mode, "SIGINT");
					expect(result.code).toBe(130);
					expect(result.stderr).toBe("");
					const directory = await reportDirectory(root);
					const report = JSON.parse(
						await readFile(join(directory, "report.json"), "utf8"),
					);
					expect(report.completion).toMatchObject({
						status: "stopped",
						cause: "operator",
					});
					expect(report.attempts).toHaveLength(2);
					expect(report.attempts[0].outcome).toMatchObject({
						kind: "product",
						passed: true,
					});
					expect(report.attempts[1].outcome).toMatchObject({
						kind: "failure",
						origin: "provider",
						code: "provider-rejected-turn",
					});
					if (mode.startsWith("provider-poll-")) {
						expect(
							result.events.filter((name) => name === "actual-progress-poll"),
						).toHaveLength(1);
						expect(
							result.events.filter((name) => name === "actual-provider-abort"),
						).toHaveLength(1);
						expect(result.events).not.toContain("unexpected-enrichment");
						const retained = RetainedScenarioEvidenceSchema.parse(
							JSON.parse(
								await readFile(
									join(directory, report.attempts[1].transcript.artifact),
									"utf8",
								),
							),
						);
						expect(retained.failureObservation).toMatchObject({
							kind: "provider-error",
							name: "FixtureProviderUnavailable",
							message: "Fake polled provider failure",
						});
						expect(deriveRetainedFailure(retained)).toEqual({
							origin: "provider",
							code: "provider-rejected-turn",
							retryable: true,
						});
						expect(
							result.events.filter((name) => name.startsWith("cleaned:")),
						).toEqual(["cleaned:0", "cleaned:1", "cleaned:2"]);
					}
					expect(
						result.events.filter((event) => event.startsWith("start:")),
					).toEqual(["start:0", "start:1", "start:2"]);
				} finally {
					await rm(root, { recursive: true, force: true });
				}
			},
			20_000,
		);
	}
	for (const mode of [
		"finalize-read",
		"finalize-write",
		"legacy-write",
		"cassette-write",
	] as const) {
		signalTest(
			`signals during ${mode} drain immutable publication without accepting a contradictory cancellation`,
			async () => {
				const root = await mkdtemp(join(tmpdir(), "flow-eval-publication-"));
				try {
					const result = await runSignalledFixture(root, mode, "SIGTERM");
					expect(result.code).toBe(0);
					expect(result.stderr).toBe("");
					expect(
						result.events.filter((name) => name.startsWith("signal:")),
					).toEqual(["signal:SIGTERM", "signal:SIGINT"]);
					expect(result.stdout).not.toContain("OPERATOR STOP");
					const directory = await reportDirectory(root);
					const report = JSON.parse(
						await readFile(join(directory, "report.json"), "utf8"),
					);
					const completion = JSON.parse(
						await readFile(join(directory, "completion.json"), "utf8"),
					);
					expect(report.completion).toEqual(completion);
					expect(completion).toMatchObject({
						status: "complete",
						cause: "fixed-target",
					});
					const results = join(root, "evals", "results");
					const legacyPath = (await readdir(results)).find((name) =>
						name.endsWith(".json"),
					);
					const legacy = JSON.parse(
						await readFile(join(results, legacyPath ?? "missing"), "utf8"),
					);
					expect(legacy.completion).toEqual(completion);
				} finally {
					await rm(root, { recursive: true, force: true });
				}
			},
			20_000,
		);
	}
	test("normal completion still writes a complete report and exits zero", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-eval-complete-"));
		try {
			const result = await runSignalledFixture(root, "complete", "SIGINT");
			expect(result.code).toBe(0);
			expect(result.stderr).toBe("");
			const directory = await reportDirectory(root);
			const report = JSON.parse(
				await readFile(join(directory, "report.json"), "utf8"),
			);
			expect(report.completion).toMatchObject({
				status: "complete",
				cause: "fixed-target",
			});
			expect(report.attempts).toHaveLength(1);
			expect(report.attempts[0].outcome.passed).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		for (const mode of ["step", "host", "preflight", "last-cleanup"] as const) {
			signalTest(
				`${signal} during ${mode} stops without inventing an attempt`,
				async () => {
					const root = await mkdtemp(join(tmpdir(), "flow-eval-cancel-"));
					try {
						const result = await runSignalledFixture(root, mode, signal);
						expect(result.stderr).toBe("");
						expect(result.code).toBe(signal === "SIGINT" ? 130 : 143);
						expect(result.signal).toBeNull();
						expect(result.events).not.toContain("unexpected-network");
						expect(result.events).toContain("returned");
						expect(
							result.events.filter((name) => name.startsWith("signal:")),
						).toEqual([
							`signal:${signal}`,
							`signal:${signal === "SIGINT" ? "SIGTERM" : "SIGINT"}`,
						]);
						const started =
							mode === "preflight"
								? [0]
								: mode === "last-cleanup"
									? [0, 1]
									: [0, 1, 2];
						for (const phase of ["start", "stop", "cleaned"] as const) {
							expect(
								result.events.filter((name) => name.startsWith(`${phase}:`)),
							).toEqual(started.map((attempt) => `${phase}:${attempt}`));
						}
						expect(
							result.events.filter((name) => name.startsWith("probe:")),
						).toEqual(["probe:fixture/model-a"]);
						expect(
							result.events.filter((name) => name.startsWith("outcome:")),
						).toEqual(mode === "preflight" ? [] : ["outcome:1"]);
						const directory = await reportDirectory(root);
						const catalog = parseCaseCatalog(
							JSON.parse(
								await readFile(join(directory, "catalog.json"), "utf8"),
							),
						);
						if (!catalog.ok)
							throw new Error("Runner persisted an invalid catalog.");
						const parsed = parseReport(
							JSON.parse(
								await readFile(join(directory, "report.json"), "utf8"),
							),
							catalog.value,
						);
						if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
						const report = parsed.value;
						const completed = mode === "preflight" ? 0 : 1;
						expect(report.completion.status).toBe("stopped");
						expect(report.completion.cause).toBe("operator");
						expect(report.completion.observed.attempts).toBe(completed);
						expect(report.completion.observed.costUsd).toBe(0);
						expect(report.attempts).toHaveLength(completed);
						expect(await readdir(join(directory, "attempts"))).toHaveLength(
							completed,
						);
						for (const attempt of report.attempts) {
							expect(attempt.repetition).toBe(0);
							expect(attempt.outcome).toMatchObject({
								kind: "product",
								passed: true,
								issues: [],
							});
							expect(attempt.transcript).not.toBeNull();
							const transcript = JSON.parse(
								await readFile(
									join(directory, attempt.transcript?.artifact ?? "missing"),
									"utf8",
								),
							);
							expect(transcript.failure).toBeNull();
							expect(transcript.gradeInput.session.runs).toEqual([]);
						}
						const results = join(root, "evals", "results");
						const legacyFiles = (await readdir(results)).filter((name) =>
							name.endsWith(".json"),
						);
						expect(legacyFiles).toHaveLength(1);
						const legacy = JSON.parse(
							await readFile(
								join(results, legacyFiles[0] ?? "missing"),
								"utf8",
							),
						);
						expect(legacy.summary).toMatchObject({
							passed: completed,
							scored: completed,
							total: completed,
							aborted: 0,
							environmentBlocked: 0,
						});
						expect(legacy.results).toHaveLength(completed);
						expect(legacy.completion).toEqual(report.completion);
						if (completed > 0) {
							const cassettes = (await readdir(results)).find((name) =>
								name.endsWith(".cassettes"),
							);
							expect(cassettes).toBeDefined();
							expect(
								await readdir(join(results, cassettes ?? "missing")),
							).toHaveLength(1);
						}
						// Exercise the real release decision helper, not a copied stop rule.
						// This ordinary one-case fixture necessarily lacks release evidence.
						const first = report.attempts[0];
						if (first && !("kind" in first.artifact)) {
							const decision = deriveReleaseDecision({
								report,
								catalog: releaseCatalog(),
								expected: {
									kind: "release",
									artifact: first.artifact,
									evaluator: first.evaluator,
									attempts: [],
								},
								promotionArtifact: first.artifact,
							});
							expect(decision.verdict).not.toBe("VERIFIED");
							expect(
								decision.reasons.some(
									(reason) => reason.code === "campaign-stopped",
								),
							).toBe(true);
						}
					} finally {
						await rm(root, { recursive: true, force: true });
					}
				},
				20_000,
			);
		}
	}

	for (const mode of [
		"cleanup-failure",
		"host-cleanup-failure",
		"persistence-failure",
		"preflight-host-cleanup-failure",
	] as const) {
		signalTest(
			`${mode} is not swallowed by operator cancellation`,
			async () => {
				const root = await mkdtemp(join(tmpdir(), "flow-eval-cancel-error-"));
				try {
					const result = await runSignalledFixture(root, mode, "SIGINT");
					expect(result.signal).toBeNull();
					expect(result.code).toBe(1);
					expect(result.events).toContain(
						`injected-${mode === "preflight-host-cleanup-failure" || mode === "host-cleanup-failure" ? "cleanup-failure" : mode}`,
					);
					expect(result.events).toContain("error");
					expect(result.events).not.toContain("returned");
					expect(result.stderr).not.toBe("");
					const directory = await reportDirectory(root);
					expect(await readdir(directory)).not.toContain("report.json");
					expect(await readdir(join(directory, "attempts"))).toHaveLength(
						mode === "preflight-host-cleanup-failure" ? 0 : 1,
					);
					expect(
						result.events.filter((name) => name.startsWith("stop:")),
					).toEqual(
						mode === "preflight-host-cleanup-failure"
							? ["stop:0"]
							: ["stop:0", "stop:1", "stop:2"],
					);
				} finally {
					await rm(root, { recursive: true, force: true });
				}
			},
			20_000,
		);
	}
});
