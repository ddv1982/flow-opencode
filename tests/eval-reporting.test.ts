import { describe, expect, spyOn, test } from "bun:test";
import { ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignCancelled } from "../evals/campaign-stop.js";
import {
	askedScoring,
	EvalHost,
	formatRate,
	isSelfAbortError,
	isWedged,
	mergeCredentials,
	onlyAwaitingAnswer,
	passRates,
	pendingCallLabel,
	postSessionJson,
	refusedBroadScope,
	reportedCost,
	runQueues,
	runSessionRequest,
	sequencer,
	sessionBoundaries,
	syncProviderCredentialsBack,
	terminateChildProcessTree,
} from "../evals/harness.js";
import {
	extractObservedActor,
	extractObservedModelIdentity,
	guidanceLoad,
	reviewerActorObservation,
	selectLineageValidatedReviewers,
} from "../evals/host-observation.js";
import {
	aggregateOperationalMetrics,
	completionHonesty,
	countGuidanceSkips,
	guidanceSkipSignals,
	type MetricSession,
	operationalMetrics,
	reviewerActivity,
} from "../evals/metrics.js";
import { bestEffortEvaluation } from "../evals/run.js";

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

function mockFetch(
	implementation: (
		...args: Parameters<typeof fetch>
	) => ReturnType<typeof fetch>,
) {
	return spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(implementation, { preconnect: fetch.preconnect }),
	);
}

// Running the harness needs credentials and money, so the rules that decide what
// a run *means* are proven here instead. Two were wrong in recorded runs: unpriced
// spend printed as `$0.0000`, and a session blocked on an unanswerable question
// burned its full twenty-minute timeout before being scored as a failure. The
// rest exist so a recovery failure, and a scenario nothing scored, can be read
// from the report at all.
describe("eval run classification", () => {
	test("terminates the detached host wrapper and its child process", async () => {
		if (process.platform === "win32") return;
		const child = spawn("sh", ["-c", "sleep 30 & echo $!; wait"], {
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const childPid = await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.stdout?.once("data", (chunk) =>
				resolve(Number(String(chunk).trim())),
			);
		});
		await terminateChildProcessTree(child);
		expect(child.exitCode ?? child.signalCode).not.toBeNull();
		expect(processExists(childPid)).toBe(false);
	});

	test("refuses an unconfirmed EPERM group even after the wrapper exits", async () => {
		if (process.platform === "win32") return;
		const child = spawn(process.execPath, ["-e", ""]);
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", () => resolve());
		});
		const pid = child.pid;
		if (pid === undefined) throw new Error("Child process has no pid.");
		const probe = spyOn(process, "kill").mockImplementation(
			(probedPid, signal) => {
				expect(probedPid).toBe(-pid);
				expect(signal).toBe(0);
				throw Object.assign(new Error("operation not permitted"), {
					code: "EPERM",
				});
			},
		);
		try {
			await expect(terminateChildProcessTree(child)).rejects.toThrow(
				"permission denied",
			);
		} finally {
			probe.mockRestore();
		}
	});

	test("gives a detached child time to finish SIGTERM cleanup", async () => {
		if (process.platform !== "linux") return;
		const root = await mkdtemp(join(tmpdir(), "flow-process-tree-"));
		const marker = join(root, "cleaned");
		const ready = join(root, "ready");
		const childScript = join(root, "child.sh");
		const wrapperScript = join(root, "wrapper.sh");
		await writeFile(
			childScript,
			`trap 'sleep 0.2; printf done > "$1"; exit 0' TERM
printf ready > "$2"
while :; do sleep 1; done
`,
		);
		await writeFile(
			wrapperScript,
			`sh "$1" "$2" "$3" &
child=$!
while [ ! -f "$3" ]; do sleep 0.01; done
printf '%s\n' "$child"
wait "$child"
`,
		);
		const wrapper = spawn("sh", [wrapperScript, childScript, marker, ready], {
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
		});
		await new Promise<void>((resolve, reject) => {
			wrapper.once("error", reject);
			wrapper.stdout?.once("data", () => resolve());
		});
		await terminateChildProcessTree(wrapper);
		expect(await readFile(marker, "utf8")).toBe("done");
	});

	test("preserves the primary path when fallback enrichment throws again", () => {
		const fallback: string[] = [];
		expect(
			bestEffortEvaluation(() => {
				throw new Error("secondary transform repeated");
			}, fallback),
		).toBe(fallback);
	});

	test("ends the wait when a question is the only incomplete call", () => {
		expect(onlyAwaitingAnswer(["question:running"])).toBe(true);
		expect(onlyAwaitingAnswer(["question:pending", "question:running"])).toBe(
			true,
		);
	});

	test("keeps waiting while any other call could still make progress", () => {
		// A long command is progress waiting to happen, including beside a question.
		expect(onlyAwaitingAnswer(["bash:running"])).toBe(false);
		expect(onlyAwaitingAnswer(["question:running", "bash:running"])).toBe(
			false,
		);
		expect(onlyAwaitingAnswer([])).toBe(false);
	});

	// The measured defect: 92 of 408 recorded runs carried a `MessageAbortedError`
	// and only 4 of them were timeouts. The rest were this harness ending an
	// escalation nothing answers — the designed end of six scenarios — and
	// reporting its own abort as a condition of the host buried the real ones.
	test("does not report its own abort as a host error", () => {
		const abort = { name: "MessageAbortedError", data: { message: "Aborted" } };
		expect(isSelfAbortError(abort, true)).toBe(true);
	});

	test("reports an abort nobody here issued, and every other error always", () => {
		const abort = { name: "MessageAbortedError", data: { message: "Aborted" } };
		// No abort issued makes an abort error real news: something outside this
		// process ended the turn, which is exactly what the field is for.
		expect(isSelfAbortError(abort, false)).toBe(false);
		expect(isSelfAbortError({ name: "ProviderAuthError" }, true)).toBe(false);
		expect(isSelfAbortError("Aborted", true)).toBe(false);
		expect(isSelfAbortError(null, true)).toBe(false);
	});

	// Three of the four real timeouts sat on the same incomplete tool call for the
	// full twenty minutes, then printed the diagnostic that said so. Calling it at
	// three reaches the same finding on the same evidence.
	test("calls a session wedged once nothing changes while a call stays open", () => {
		expect(isWedged(["bash:running"], 180_000, 180_000)).toBe(true);
		expect(isWedged(["bash:running"], 200_000, 180_000)).toBe(true);
	});

	// The matrix spent 2.5h of wall clock on 2.5h of model time because it ran one
	// attempt at a time. Only money would otherwise be the first thing to test the
	// scheduler that fixes it, so the nesting it promises is proven here.
	test("runs queues concurrently and every job in every queue", async () => {
		const inFlight: string[] = [];
		let peak = 0;
		const run = async (job: string) => {
			inFlight.push(job);
			peak = Math.max(peak, inFlight.length);
			await Bun.sleep(1);
			inFlight.splice(inFlight.indexOf(job), 1);
			return job;
		};
		const done = await runQueues(
			[
				["a1", "a2", "a3"],
				["b1", "b2", "b3"],
			],
			2,
			run,
		);
		expect(done.sort()).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"]);
		expect(peak).toBe(2);
	});

	test("stops unclaimed jobs after a fatal failure and drains in-flight work", async () => {
		const started: string[] = [];
		const finished: string[] = [];
		let releaseSecond: (() => void) | undefined;
		const secondStarted = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		await expect(
			runQueues(
				[
					["a1", "a2"],
					["b1", "b2"],
				],
				2,
				async (job) => {
					started.push(job);
					if (job === "a1") {
						await secondStarted;
						throw new Error("fatal persistence");
					}
					releaseSecond?.();
					await Bun.sleep(5);
					finished.push(job);
					return job;
				},
			),
		).rejects.toThrow("fatal persistence");
		expect(started.sort()).toEqual(["a1", "b1"]);
		expect(finished).toEqual(["b1"]);
	});

	test("stops after a returned integrity failure while preserving its result", async () => {
		const started: string[] = [];
		const done = await runQueues(
			[
				["a1", "a2"],
				["b1", "b2"],
			],
			1,
			async (job) => {
				started.push(job);
				return { job, fatal: job === "a1" };
			},
			(result) => result.fatal,
		);
		expect(started).toEqual(["a1"]);
		expect(done).toEqual([{ job: "a1", fatal: true }]);
	});

	test("preserves an in-flight persistence error after an integrity stop", async () => {
		let startSecond: (() => void) | undefined;
		let releaseSecond: (() => void) | undefined;
		const secondStarted = new Promise<void>((resolve) => {
			startSecond = resolve;
		});
		const integrityStopped = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		await expect(
			runQueues(
				[["evaluator"], ["persistence"]],
				2,
				async (job) => {
					if (job === "evaluator") {
						await secondStarted;
						return { fatal: true };
					}
					startSecond?.();
					await integrityStopped;
					throw new Error("attempt write failed");
				},
				(result) => {
					if (result.fatal) releaseSecond?.();
					return result.fatal;
				},
			),
		).rejects.toThrow("attempt write failed");
	});

	test("never runs two jobs from one queue at once", async () => {
		// The whole point of keying a queue by model: overlap inside one queue would
		// race one provider's rate limit against itself.
		let open = 0;
		let overlapped = false;
		await runQueues([["a1", "a2", "a3", "a4"]], 4, async () => {
			open += 1;
			if (open > 1) overlapped = true;
			await Bun.sleep(1);
			open -= 1;
		});
		expect(overlapped).toBe(false);
	});

	test("never idles a worker and never starves a queue", async () => {
		// More workers than queues cannot help, and fewer must still drain every one.
		const seen: number[] = [];
		await runQueues([[1], [2], [3]], 2, async (job) => {
			seen.push(job);
		});
		expect(seen.sort()).toEqual([1, 2, 3]);
		expect(await runQueues([], 4, async (job) => job)).toEqual([]);
	});

	test("waits on a session that is slow rather than stopped", () => {
		// Under the threshold the model may still be working, and no incomplete call
		// means the session is between turns — the quiet window's business, not this
		// one's, and ending it here would score a truncated run as a failure.
		expect(isWedged(["bash:running"], 179_999, 180_000)).toBe(false);
		expect(isWedged([], 600_000, 180_000)).toBe(false);
	});

	test("disables Bun's implicit timeout on the owner-controlled session transport", async () => {
		const controller = new AbortController();
		let observed: (RequestInit & { timeout?: false }) | undefined;
		const response = await postSessionJson(
			"http://host/session/id/command",
			{},
			{
				signal: controller.signal,
				fetch: async (_input, init) => {
					observed = init;
					return Response.json({ accepted: true });
				},
			},
		);

		expect(response).toEqual({ accepted: true });
		expect(observed?.signal).toBe(controller.signal);
		expect(observed?.timeout).toBe(false);
	});

	test("keeps a session-driving request under the progress wait's ownership", async () => {
		const deferred = Promise.withResolvers<unknown>();
		let signal: AbortSignal | undefined;
		const rejectedMessages: string[] = [];
		const result = await runSessionRequest({
			post: (_url, _body, options) => {
				signal = options.signal;
				options.signal.addEventListener("abort", () =>
					deferred.reject(options.signal.reason),
				);
				return deferred.promise;
			},
			url: "http://host/session/id/command",
			body: {},
			onRejected: (message) => rejectedMessages.push(message),
			wait: async (request) => {
				expect(request.state()).toEqual({ kind: "pending" });
				return "quiet";
			},
		});

		expect(result).toBe("quiet");
		expect(signal?.aborted).toBe(true);
		expect(rejectedMessages).toEqual([]);
		await deferred.promise.catch(() => {});
	});

	test("preserves an external session-driving request rejection", async () => {
		const rejectedMessages: string[] = [];
		const external = new Error("provider disconnected");
		const result = await runSessionRequest({
			post: async () => {
				throw external;
			},
			url: "http://host/session/id/message",
			body: {},
			onRejected: (message) => rejectedMessages.push(message),
			wait: async (request) => {
				request.cancel();
				await request.settled;
				expect(request.state()).toEqual({
					kind: "rejected",
					message: "Error: provider disconnected",
					error: external,
				});
				return "quiet";
			},
		});

		expect(result).toBe("quiet");
		expect(rejectedMessages).toEqual(["Error: provider disconnected"]);
	});

	test("scores a run whose earlier step asked, because the next step answers", () => {
		// Measured: sonnet saved a plan in step 1 of `continuation-accepted` and asked
		// "Approve this plan to proceed with implementation?" — the behaviour
		// `plan-only-stops` gates at 100%. Step 2 says "you have my approval", so the
		// question was already answered; excluding the attempt dropped a correct run
		// out of a pair that needs three scored attempts to qualify at all.
		expect(askedScoring([0], 2, false)).toEqual({
			escalated: true,
			unscored: false,
		});
	});

	test("leaves a question the last step ended on unscored unless the scenario allows it", () => {
		// Nothing answers this one, so the durable state is mid-flight by definition.
		expect(askedScoring([1], 2, false)).toEqual({
			escalated: true,
			unscored: true,
		});
		expect(askedScoring([1], 2, true)).toEqual({
			escalated: true,
			unscored: false,
		});
		// A one-step scenario's only step is its last, which is how every
		// `mayEscalate` scenario measured before this rule existed.
		expect(askedScoring([0], 1, false).unscored).toBe(true);
		expect(askedScoring([0], 1, true).unscored).toBe(false);
	});

	test("reports asking at all apart from whether it cost the score", () => {
		// The `+ASK` note: a model that reached the outcome and one that reached the
		// only end left to it are both worth reading, even when both are scored.
		expect(askedScoring([0, 1], 2, true)).toEqual({
			escalated: true,
			unscored: false,
		});
		expect(askedScoring([], 2, false)).toEqual({
			escalated: false,
			unscored: false,
		});
	});
});

describe("eval campaign cancellation", () => {
	for (const phase of ["session", "archives"] as const) {
		for (const failed of [false, true]) {
			test(`R20-01/R10-06 cancellation during ${phase} reads preserves observed provider failure: ${failed}`, async () => {
				const scratch = await mkdtemp(join(tmpdir(), "flow-outcome-files-"));
				const history = join(scratch, ".flow", "history");
				await mkdir(history, { recursive: true });
				await writeFile(join(history, "a.json"), "{}");
				await writeFile(join(history, "b.json"), "{}");
				const host = Reflect.construct(EvalHost, [
					scratch,
					scratch,
				]) as EvalHost;
				Object.assign(host, { baseUrl: "http://fixture" });
				const controller = new AbortController();
				const reason = new CampaignCancelled(130);
				const entered = Promise.withResolvers<void>();
				const read = Reflect.get(host, "readJson").bind(host) as (
					path: string,
					signal?: AbortSignal,
				) => Promise<Record<string, unknown> | null>;
				const visited: string[] = [];
				Object.assign(host, {
					readJson: async (path: string, signal?: AbortSignal) => {
						visited.push(path);
						if (
							path.endsWith(phase === "session" ? "session.json" : "a.json")
						) {
							if (!signal)
								throw new Error("Missing filesystem cancellation signal");
							const pending = new Promise<never>((_, reject) =>
								signal.addEventListener("abort", () => reject(signal.reason), {
									once: true,
								}),
							);
							entered.resolve();
							return pending;
						}
						return read(path, signal);
					},
				});
				const requests = mockFetch(async (input) =>
					String(input).endsWith("/children")
						? Response.json([])
						: Response.json([
								{
									info: {
										id: "message",
										sessionID: "id",
										role: "assistant",
										time: { created: 1, completed: 2 },
										...(failed
											? {
													error: {
														name: "FixtureProviderUnavailable",
														data: { message: "Fake provider failure" },
													},
												}
											: {}),
									},
									parts: [],
								},
							]),
				);
				try {
					const result = host.outcome(["id"], 1, controller.signal);
					const observed = result.catch((error) => error);
					await entered.promise;
					controller.abort(reason);
					if (failed) {
						expect(await observed).toMatchObject({
							providerError: {
								origin: "provider",
								code: "provider-rejected-turn",
							},
							providerErrorObservation: { name: "FixtureProviderUnavailable" },
						});
					} else expect(await observed).toBe(reason);
					expect(visited.some((path) => path.endsWith("b.json"))).toBe(false);
				} finally {
					requests.mockRestore();
					await host.stop();
				}
			});
		}
	}
	test("R10-04 preserves a wait rejection queued before the stop signal", async () => {
		const controller = new AbortController();
		const failure = new Error("known progress-read failure");
		const waiting = Promise.withResolvers<never>();
		const running = runSessionRequest({
			signal: controller.signal,
			post: async () => {},
			url: "http://fixture/session/id/command",
			body: {},
			onRejected: () => {},
			wait: () => waiting.promise,
		});
		const observed = running.catch((error) => error);
		waiting.reject(failure);
		controller.abort(new CampaignCancelled(130));
		expect(await observed).toBe(failure);
	});

	for (const waitOwnsCancellation of [false, true]) {
		test(`R10-04 preserves an observed POST rejection before cancellation (cooperative wait: ${waitOwnsCancellation})`, async () => {
			const controller = new AbortController();
			const reason = new CampaignCancelled(130);
			const failure = new Error("known host POST failure");
			const rejected = Promise.withResolvers<void>();
			let cleaned = false;
			const running = runSessionRequest({
				signal: controller.signal,
				waitOwnsCancellation,
				post: async () => {
					throw failure;
				},
				url: "http://fixture/session/id/command",
				body: {},
				onRejected: () => rejected.resolve(),
				wait: () =>
					new Promise((_resolve, reject) => {
						if (waitOwnsCancellation) {
							controller.signal.addEventListener(
								"abort",
								() => reject(controller.signal.reason),
								{ once: true },
							);
						}
					}),
				onCancelled: async () => {
					cleaned = true;
				},
			});
			const observed = running.catch((error) => error);
			await rejected.promise;
			controller.abort(reason);
			expect(await observed).toBe(failure);
			expect(cleaned).toBe(true);
		});
	}

	for (const failure of ["timeout", "wedge"] as const) {
		test(`R10-04 drains ${failure} abort cleanup without replacing the failure with cancellation`, async () => {
			const scratch = await mkdtemp(join(tmpdir(), "flow-eval-failure-race-"));
			const controller = new AbortController();
			const host = Reflect.construct(EvalHost, [
				scratch,
				scratch,
				controller.signal,
			]) as EvalHost;
			Object.assign(host, { baseUrl: "http://fixture" });
			const aborting = Promise.withResolvers<void>();
			const cleanup = Promise.withResolvers<Response>();
			let aborts = 0;
			const requests = mockFetch(async (input) => {
				const url = String(input);
				if (url.endsWith("/abort")) {
					aborts += 1;
					aborting.resolve();
					return cleanup.promise;
				}
				if (url.endsWith("/command")) return Response.json({});
				return Response.json(
					failure === "timeout"
						? []
						: [
								{
									info: { role: "assistant" },
									parts: [
										{
											type: "tool",
											tool: "bash",
											state: { status: "running" },
										},
									],
								},
							],
				);
			});
			let settled = false;
			const running = host
				.runCommand("id", "flow-auto", "fixture", "fixture/model", {
					timeoutMs: failure === "timeout" ? 0 : 20_000,
					stalledMs: 0,
				})
				.catch((error) => {
					settled = true;
					return error;
				});
			try {
				await aborting.promise;
				controller.abort(new CampaignCancelled(143));
				await Bun.sleep(1);
				expect(settled).toBe(false);
				cleanup.resolve(Response.json(true));
				const error = await running;
				expect(error).toBeInstanceOf(Error);
				expect(error).not.toBeInstanceOf(CampaignCancelled);
				expect(error.message).toContain(
					failure === "timeout"
						? "Scenario exceeded 0ms"
						: "Scenario made no progress for 0ms",
				);
				expect(aborts).toBe(1);
			} finally {
				cleanup.resolve(Response.json(true));
				await running;
				requests.mockRestore();
				await host.stop();
			}
		}, 10_000);
	}

	for (const endpoint of ["children", "message"] as const) {
		for (const operatorStop of [true, false]) {
			test(`R10-06 cancels slow outcome ${endpoint} reads with an explicit ${operatorStop ? "campaign" : "evidence-drain"} signal`, async () => {
				const scratch = await mkdtemp(
					join(tmpdir(), "flow-eval-outcome-stop-"),
				);
				const controller = new AbortController();
				const reason = operatorStop
					? new CampaignCancelled(130)
					: new Error("bounded evidence-drain timeout");
				const host = Reflect.construct(EvalHost, [
					scratch,
					scratch,
				]) as EvalHost;
				Object.assign(host, { baseUrl: "http://fixture" });
				const reading = Promise.withResolvers<void>();
				let transport: AbortSignal | null | undefined;
				let reads = 0;
				const requests = mockFetch(async (input, init) => {
					reads += 1;
					if (String(input).endsWith(`/${endpoint}`)) {
						transport = init?.signal;
						reading.resolve();
						return new Promise(() => {});
					}
					return Response.json([]);
				});
				try {
					const observed = host
						.outcome(["id", "next"], 1, controller.signal)
						.catch((error) => error);
					await reading.promise;
					const admitted = reads;
					controller.abort(reason);
					expect(await observed).toBe(reason);
					expect(transport?.aborted).toBe(true);
					expect(reads).toBe(admitted);
					await host.stop();
					await expect(readdir(scratch)).rejects.toThrow();
				} finally {
					requests.mockRestore();
					await host.stop();
				}
			});
		}
	}

	for (const afterKill of ["gone", "alive", "unconfirmed"] as const) {
		test(`R10-08 checks process-group liveness after SIGKILL: ${afterKill}`, async () => {
			if (process.platform === "win32") return;
			const scratch = await mkdtemp(join(tmpdir(), "flow-eval-kill-confirm-"));
			const source = join(scratch, "original.json");
			const target = join(scratch, "child.json");
			const snapshot = '{"fixture":"before"}';
			const rotated = '{"fixture":"after"}';
			await writeFile(source, snapshot);
			await writeFile(target, rotated);
			const child = new ChildProcess();
			// No process is spawned. Every signal, including probes, is intercepted;
			// the synthetic group cannot target external or unowned processes.
			const pid = 2_147_483_647;
			Object.assign(child, { pid, exitCode: 0, signalCode: null });
			const host = Reflect.construct(EvalHost, [scratch, scratch]) as EvalHost;
			Object.assign(host, {
				server: child,
				credentialPaths: { source, target, snapshot },
			});
			let killed = false;
			let confirmations = 0;
			const kill = spyOn(process, "kill").mockImplementation(
				(targetPid, signal) => {
					expect(targetPid).toBe(-pid);
					if (signal === "SIGKILL") killed = true;
					if (signal === 0 && killed) {
						confirmations += 1;
						if (afterKill !== "alive") {
							throw Object.assign(new Error(afterKill), {
								code: afterKill === "gone" ? "ESRCH" : "EPERM",
							});
						}
					}
					return true;
				},
			);
			let now = Date.now();
			const clock = spyOn(Date, "now").mockImplementation(() => {
				now += 10_000;
				return now;
			});
			try {
				if (afterKill === "gone") {
					await host.stop();
					await expect(readdir(scratch)).rejects.toThrow();
				} else {
					await expect(host.stop()).rejects.toThrow(
						"Could not confirm eval host process tree",
					);
					expect(await readFile(source, "utf8")).toBe(snapshot);
					expect(await readFile(target, "utf8")).toBe(rotated);
				}
				expect(killed).toBe(true);
				expect(confirmations).toBeGreaterThan(0);
			} finally {
				clock.mockRestore();
				kill.mockRestore();
				await rm(scratch, { recursive: true, force: true });
			}
		});
	}

	test("rejects pre-aborted host startup before reading setup options", async () => {
		const controller = new AbortController();
		const reason = new CampaignCancelled(143);
		controller.abort(reason);
		await expect(
			EvalHost.start({
				get toolchain(): never {
					throw new Error("must not start a host");
				},
				get packageCache(): never {
					throw new Error("must not copy a cache");
				},
				opencodeVersion: "fixture",
				files: {},
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
	});

	test("admits no queue or job for an initially aborted signal", async () => {
		const controller = new AbortController();
		controller.abort(new CampaignCancelled(143));
		const started: number[] = [];
		expect(
			await runQueues(
				[[1, 2], [3]],
				2,
				async (job) => {
					started.push(job);
					return job;
				},
				undefined,
				controller.signal,
			),
		).toEqual([]);
		expect(started).toEqual([]);
	});

	test("drains two queues but never admits their third job after cancellation", async () => {
		const controller = new AbortController();
		const stopped = new CampaignCancelled(130);
		const cancel = Promise.withResolvers<void>();
		const cleanup = Promise.withResolvers<void>();
		const started: string[] = [];
		let cleaned = false;
		const running = runQueues(
			[["a1", "a2", "a3"], ["b1", "b2", "b3"], ["c1"]],
			2,
			async (job) => {
				started.push(job);
				if (job.endsWith("1")) return job;
				if (job === "a2") {
					await cancel.promise;
					await cleanup.promise;
					cleaned = true;
					throw stopped;
				}
				controller.abort(stopped);
				cancel.resolve();
				return job;
			},
			undefined,
			controller.signal,
		);
		let settled = false;
		void running.then(() => {
			settled = true;
		});
		await cancel.promise;
		await Bun.sleep(1);
		expect(settled).toBe(false);
		cleanup.resolve();
		expect((await running).sort()).toEqual(["a1", "b1", "b2"]);
		expect(cleaned).toBe(true);
		expect(started).toEqual(["a1", "b1", "a2", "b2"]);
	});

	test("does not swallow unrelated cancellation or an in-flight real rejection", async () => {
		const unrelated = new CampaignCancelled(130);
		await expect(
			runQueues([[1]], 1, async () => {
				throw unrelated;
			}),
		).rejects.toBe(unrelated);
		const controller = new AbortController();
		const own = new CampaignCancelled(143);
		const ready = Promise.withResolvers<void>();
		const failed = new Error("credential persistence failed");
		await expect(
			runQueues(
				[[1], [2]],
				2,
				async (job) => {
					if (job === 1) {
						await ready.promise;
						throw own;
					}
					controller.abort(own);
					ready.resolve();
					await Bun.sleep(1);
					throw failed;
				},
				undefined,
				controller.signal,
			),
		).rejects.toBe(failed);
		const different = new AbortController();
		await expect(
			runQueues(
				[[1]],
				1,
				async () => {
					different.abort(own);
					throw unrelated;
				},
				undefined,
				different.signal,
			),
		).rejects.toBe(unrelated);
	});

	test("does not send a session POST when already cancelled", async () => {
		const controller = new AbortController();
		const reason = new CampaignCancelled(143);
		controller.abort(reason);
		let posted = false;
		await expect(
			runSessionRequest({
				signal: controller.signal,
				post: async () => {
					posted = true;
				},
				url: "http://fixture/session/id/command",
				body: {},
				onRejected: () => {},
				wait: async () => "quiet",
			}),
		).rejects.toBe(reason);
		expect(posted).toBe(false);
	});

	test("cancels a never-settling POST and waits for session abort cleanup", async () => {
		const controller = new AbortController();
		const reason = new CampaignCancelled(130);
		const posted = Promise.withResolvers<void>();
		const cleanup = Promise.withResolvers<void>();
		let requestSignal: AbortSignal | undefined;
		const rejected: string[] = [];
		const running = runSessionRequest({
			signal: controller.signal,
			post: (_url, _body, options) => {
				requestSignal = options.signal;
				posted.resolve();
				return new Promise((_resolve, reject) => {
					options.signal.addEventListener("abort", () =>
						reject(options.signal.reason),
					);
				});
			},
			url: "http://fixture/session/id/command",
			body: {},
			onRejected: (message) => rejected.push(message),
			wait: () => new Promise(() => {}),
			onCancelled: () => cleanup.promise,
		});
		let settled = false;
		const observed = running.catch((error) => {
			settled = true;
			return error;
		});
		await posted.promise;
		controller.abort(reason);
		await Bun.sleep(1);
		expect(requestSignal?.aborted).toBe(true);
		expect(settled).toBe(false);
		cleanup.resolve();
		expect(await observed).toBe(reason);
		expect(rejected).toEqual([]);
	});

	for (const accepted of [false, true]) {
		test(`host cancels ${accepted ? "accepted" : "pending"} commands without cancelling outcome reads`, async () => {
			const scratch = await mkdtemp(join(tmpdir(), "flow-eval-cancel-test-"));
			const controller = new AbortController();
			const reason = new CampaignCancelled(130);
			// Construct a transport-only host: no executable or credential store is used.
			const host = Reflect.construct(EvalHost, [
				scratch,
				scratch,
				controller.signal,
			]) as EvalHost;
			Object.assign(host, { baseUrl: "http://fixture" });
			const posted = Promise.withResolvers<void>();
			let postSignal: AbortSignal | null | undefined;
			let aborts = 0;
			const requests = mockFetch(async (input, init) => {
				const url = String(input);
				if (url.endsWith("/command")) {
					postSignal = init?.signal;
					posted.resolve();
					return accepted ? Response.json({}) : new Promise(() => {});
				}
				expect(init?.signal?.aborted).not.toBe(true);
				if (url.endsWith("/abort")) {
					aborts += 1;
					return Response.json(true);
				}
				return Response.json([]);
			});
			try {
				const running = host.runCommand(
					"id",
					"flow-auto",
					"fixture",
					"fixture/model",
				);
				const observed = running.catch((error) => error);
				await posted.promise;
				await Bun.sleep(1);
				controller.abort(reason);
				expect(await observed).toBe(reason);
				expect(postSignal?.aborted).toBe(true);
				expect(aborts).toBe(1);
				expect(host.log).not.toContain("POST rejected");
				expect((await host.outcome(["id"], 1)).providerError).toBeNull();
				const first = host.stop();
				expect(host.stop()).toBe(first);
				await first;
			} finally {
				requests.mockRestore();
				await host.stop();
			}
		});
	}

	test("bounds a non-cooperative host abort request", async () => {
		const scratch = await mkdtemp(join(tmpdir(), "flow-eval-abort-test-"));
		const controller = new AbortController();
		const reason = new CampaignCancelled(143);
		const host = Reflect.construct(EvalHost, [
			scratch,
			scratch,
			controller.signal,
		]) as EvalHost;
		Object.assign(host, { baseUrl: "http://fixture" });
		let abortSignal: AbortSignal | null | undefined;
		const requests = mockFetch(async (input, init) => {
			if (String(input).endsWith("/abort")) {
				abortSignal = init?.signal;
				return new Promise(() => {});
			}
			controller.abort(reason);
			return Response.json({});
		});
		try {
			await expect(
				host.runCommand("id", "flow-auto", "fixture", "fixture/model"),
			).rejects.toBe(reason);
			expect(abortSignal?.aborted).toBe(true);
		} finally {
			requests.mockRestore();
			await host.stop();
		}
	}, 10_000);

	test("shares failed stop cleanup and retains rotated credentials in scratch", async () => {
		const scratch = await mkdtemp(join(tmpdir(), "flow-eval-retain-test-"));
		const target = join(scratch, "auth.json");
		const rotated = JSON.stringify({ fixture: { refresh: "fake-rotated" } });
		await writeFile(target, rotated);
		const host = Reflect.construct(EvalHost, [scratch, scratch]) as EvalHost;
		Object.assign(host, {
			credentialPaths: {
				source: join(scratch, "missing-parent", "auth.json"),
				target,
				snapshot: null,
			},
		});
		const complaints = spyOn(console, "error").mockImplementation(() => {});
		try {
			const first = host.stop();
			expect(host.stop()).toBe(first);
			await expect(first).rejects.toThrow();
			expect(host.stop()).toBe(first);
			expect(await readFile(target, "utf8")).toBe(rotated);
			expect(complaints).toHaveBeenCalledTimes(1);
		} finally {
			complaints.mockRestore();
			await rm(scratch, { recursive: true, force: true });
		}
	});

	test("syncs rotated fixture credentials before removing scratch exactly once", async () => {
		const fixture = await mkdtemp(join(tmpdir(), "flow-eval-stop-test-"));
		const scratch = join(fixture, "scratch");
		await mkdir(scratch);
		const source = join(fixture, "auth.json");
		const target = join(scratch, "auth.json");
		const snapshot = JSON.stringify({ fixture: { refresh: "fake-before" } });
		const rotated = { fixture: { refresh: "fake-after" } };
		await writeFile(source, snapshot);
		await writeFile(target, JSON.stringify(rotated));
		const host = Reflect.construct(EvalHost, [scratch, scratch]) as EvalHost;
		Object.assign(host, { credentialPaths: { source, target, snapshot } });
		try {
			const first = host.stop();
			expect(host.stop()).toBe(first);
			await first;
			expect(JSON.parse(await readFile(source, "utf8"))).toEqual(rotated);
			await expect(readdir(scratch)).rejects.toThrow();
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});

	test.each(["not-json-sensitive-fixture", "[]"])(
		"retains invalid child credentials without echoing their contents: %s",
		async (contents) => {
			const scratch = await mkdtemp(join(tmpdir(), "flow-eval-invalid-auth-"));
			const target = join(scratch, "child.json");
			const source = join(scratch, "original.json");
			await writeFile(target, contents);
			await writeFile(source, '{"fixture":"original"}');
			const host = Reflect.construct(EvalHost, [scratch, scratch]) as EvalHost;
			Object.assign(host, {
				credentialPaths: { source, target, snapshot: null },
			});
			try {
				await expect(host.stop()).rejects.toThrow(
					`Eval host credentials are invalid; retained at ${target}.`,
				);
				expect(await readFile(target, "utf8")).toBe(contents);
				expect(await readFile(source, "utf8")).toBe('{"fixture":"original"}');
			} finally {
				await rm(scratch, { recursive: true, force: true });
			}
		},
	);

	test("does not replace a cancellation cleanup error with the stop reason", async () => {
		const controller = new AbortController();
		const reason = new CampaignCancelled(130);
		const failure = new Error("cleanup persistence failed");
		await expect(
			runSessionRequest({
				signal: controller.signal,
				post: async () => {
					controller.abort(reason);
				},
				url: "http://fixture/session/id/command",
				body: {},
				onRejected: () => {},
				wait: async () => "quiet",
				onCancelled: async () => {
					throw failure;
				},
			}),
		).rejects.toBe(failure);
	});

	for (const operation of ["catalog", "session", "probe"] as const) {
		test(`interrupts a never-settling ${operation} request with the exact cancellation`, async () => {
			const scratch = await mkdtemp(join(tmpdir(), "flow-eval-request-test-"));
			const controller = new AbortController();
			const reason = new CampaignCancelled(143);
			const host = Reflect.construct(EvalHost, [
				scratch,
				scratch,
				controller.signal,
			]) as EvalHost;
			Object.assign(host, { baseUrl: "http://fixture" });
			let requestSignal: AbortSignal | null | undefined;
			let aborts = 0;
			const requests = mockFetch(async (input, init) => {
				const url = String(input);
				if (url.endsWith("/abort")) {
					aborts += 1;
					expect(init?.signal?.aborted).toBe(false);
					return Response.json(true);
				}
				if (init?.method === "DELETE") return Response.json(true);
				if (operation === "probe" && url.endsWith("/session"))
					return Response.json({ id: "id" });
				requestSignal = init?.signal;
				queueMicrotask(() => controller.abort(reason));
				return new Promise(() => {});
			});
			try {
				const request =
					operation === "catalog"
						? host.catalogModels()
						: operation === "session"
							? host.createSession("fixture")
							: host.probeModel("fixture/model");
				await expect(request).rejects.toBe(reason);
				expect(requestSignal?.aborted).toBe(true);
				expect(aborts).toBe(operation === "probe" ? 1 : 0);
			} finally {
				requests.mockRestore();
				await host.stop();
			}
		});
	}

	for (const phase of [
		"health",
		"readiness",
		"cache",
		"cache-failure",
	] as const) {
		test(`cleans startup scratch and temporary credentials on ${phase}`, async () => {
			const fixture = await mkdtemp(join(tmpdir(), "flow-eval-start-test-"));
			const source = join(fixture, "opencode", "auth.json");
			await mkdir(join(fixture, "opencode"));
			const credentials = JSON.stringify({
				fixture: { refresh: "fake-original" },
			});
			await writeFile(source, credentials);
			const oldData = process.env.XDG_DATA_HOME;
			const oldOptOut = process.env.FLOW_EVAL_NO_AUTH_COPY;
			process.env.XDG_DATA_HOME = fixture;
			delete process.env.FLOW_EVAL_NO_AUTH_COPY;
			const controller = new AbortController();
			const reason =
				phase === "readiness"
					? new DOMException("Startup deadline expired", "TimeoutError")
					: new CampaignCancelled(130);
			let scratch = "";
			let requestSignal: AbortSignal | null | undefined;
			const stop = EvalHost.prototype.stop;
			const stopping = spyOn(EvalHost.prototype, "stop").mockImplementation(
				function (this: EvalHost) {
					scratch = join(this.project, "..");
					return stop.call(this);
				},
			);
			const requests = mockFetch(async (input, init) => {
				if (phase === "readiness" && String(input).endsWith("/global/health"))
					return Response.json({ healthy: true });
				if (phase === "readiness") {
					expect(String(input)).toEndWith("/session");
					expect(init?.method).toBe("POST");
				}
				requestSignal = init?.signal;
				queueMicrotask(() => controller.abort(reason));
				return new Promise(() => {});
			});
			try {
				const starting = EvalHost.start({
					toolchain: {
						executable: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
						actualVersion: "fixture",
						expectedVersion: "fixture",
						environment: {},
					},
					get packageCache() {
						if (phase === "cache")
							queueMicrotask(() => controller.abort(reason));
						if (phase === "cache-failure")
							return join(fixture, "missing-cache");
						return join(fixture, "opencode");
					},
					opencodeVersion: "fixture",
					files: { "fixture.txt": "no paid calls" },
					signal: controller.signal,
				});
				if (phase === "cache-failure") await expect(starting).rejects.toThrow();
				else if (phase === "readiness")
					await expect(starting).rejects.toThrow("Startup deadline expired");
				else await expect(starting).rejects.toBe(reason);
				expect(scratch).not.toBe("");
				await expect(readdir(scratch)).rejects.toThrow();
				expect(await readFile(source, "utf8")).toBe(credentials);
				if (phase === "health" || phase === "readiness")
					expect(requestSignal?.aborted).toBe(true);
				else expect(requests).not.toHaveBeenCalled();
				if (phase === "readiness") expect(requests).toHaveBeenCalledTimes(2);
			} finally {
				requests.mockRestore();
				stopping.mockRestore();
				if (oldData === undefined) delete process.env.XDG_DATA_HOME;
				else process.env.XDG_DATA_HOME = oldData;
				if (oldOptOut === undefined) delete process.env.FLOW_EVAL_NO_AUTH_COPY;
				else process.env.FLOW_EVAL_NO_AUTH_COPY = oldOptOut;
				await rm(fixture, { recursive: true, force: true });
			}
		});
	}
});

describe("eval actor and instruction observations", () => {
	const assistant = (info: Record<string, unknown>) => ({
		info: { role: "assistant", time: { created: 1, completed: 2 }, ...info },
		parts: [],
	});

	test("extracts nested and top-level model identities, including gateway ids", () => {
		expect(
			extractObservedModelIdentity([
				assistant({
					model: {
						providerID: "openrouter",
						modelID: "openai/gpt-5.6-sol",
					},
				}),
			]),
		).toEqual({
			kind: "observed",
			value: {
				providerID: "openrouter",
				modelID: "openai/gpt-5.6-sol",
			},
		});
		expect(
			extractObservedModelIdentity([
				assistant({ providerID: "anthropic", modelID: "claude-sonnet" }),
			]),
		).toEqual({
			kind: "observed",
			value: { providerID: "anthropic", modelID: "claude-sonnet" },
		});
	});

	test("refuses incomplete, errored, and conflicting model observations", () => {
		expect(extractObservedModelIdentity(null)).toEqual({
			kind: "unobserved",
			reason: "endpoint-failure",
		});
		expect(
			extractObservedModelIdentity([
				{ info: { role: "assistant", time: { created: 1 } }, parts: [] },
			]),
		).toEqual({ kind: "unobserved", reason: "no-completed-assistant" });
		expect(
			extractObservedModelIdentity([
				{
					info: {
						role: "assistant",
						time: { created: 1, completed: 2 },
						error: { name: "ProviderError" },
					},
					parts: [],
				},
			]),
		).toEqual({ kind: "unobserved", reason: "no-completed-assistant" });
		expect(extractObservedModelIdentity([assistant({})])).toEqual({
			kind: "unobserved",
			reason: "field-unavailable",
		});
		expect(
			extractObservedModelIdentity([
				assistant({ providerID: "a", modelID: "one" }),
				assistant({ providerID: "b", modelID: "two" }),
			]),
		).toEqual({ kind: "unobserved", reason: "conflicting-observations" });
	});

	test("counts only lineage-validated reviewer children and preserves actor ids", () => {
		const children = [
			{ id: "worker", agent: "flow-worker", parentID: "parent" },
			{ id: "wrong", agent: "flow-reviewer", parentID: "other" },
			{ id: "reviewer", agent: "flow-reviewer", parentID: "parent" },
		] as const;
		expect(selectLineageValidatedReviewers(["parent"], children)).toEqual([
			children[2],
		]);
		expect(extractObservedActor({ role: "reviewer", sessions: [] })).toEqual({
			role: "reviewer",
			sessionIds: [],
			actualModel: {
				kind: "unobserved",
				reason: "reviewer-child-not-observed",
			},
		});
		expect(
			reviewerActorObservation({
				sessions: [],
				childEndpointFailed: true,
			}),
		).toEqual({
			role: "reviewer",
			sessionIds: [],
			actualModel: { kind: "unobserved", reason: "endpoint-failure" },
		});
		expect(
			reviewerActorObservation({
				sessions: [
					{
						id: "reviewer",
						messages: [assistant({ providerID: "a", modelID: "reviewer" })],
					},
				],
				childEndpointFailed: true,
			}),
		).toMatchObject({
			sessionIds: ["reviewer"],
			actualModel: { kind: "unobserved", reason: "endpoint-failure" },
		});
		expect(
			extractObservedActor({
				role: "manager",
				sessions: [
					{
						id: "parent",
						messages: [
							assistant({
								model: { providerID: "openrouter", modelID: "x/y" },
							}),
						],
					},
				],
			}),
		).toEqual({
			role: "manager",
			sessionIds: ["parent"],
			actualModel: {
				kind: "observed",
				value: { providerID: "openrouter", modelID: "x/y" },
			},
		});
		expect(
			extractObservedActor({
				role: "manager",
				sessions: [
					{
						id: "parent",
						messages: [assistant({ providerID: "a", modelID: "m" })],
					},
					{ id: "resume", messages: null },
				],
			}),
		).toEqual({
			role: "manager",
			sessionIds: ["parent", "resume"],
			actualModel: { kind: "unobserved", reason: "endpoint-failure" },
		});
	});

	test("measures raw guidance output in UTF-8 bytes", () => {
		expect(
			guidanceLoad({
				sequence: 3,
				sessionIndex: 1,
				agent: "",
				id: "flow-plan",
				rawOutput: "plan café",
			}),
		).toEqual({
			sequence: 3,
			sessionIndex: 1,
			agent: "",
			id: "flow-plan",
			rawOutput: "plan café",
			utf8Bytes: 10,
		});
	});
});

describe("eval session boundaries", () => {
	const calls = (indices: number[]) =>
		indices.map((sessionIndex) => ({ sessionIndex }));

	test("reports nothing for a single-session run", () => {
		expect(sessionBoundaries(calls([0, 0, 0]))).toEqual([]);
		expect(sessionBoundaries([])).toEqual([]);
	});

	test("reports the index where the resumed session's first call lands", () => {
		expect(sessionBoundaries(calls([0, 0, 1, 1]))).toEqual([2]);
		// A resumed session that made the run's only call still reads as a boundary.
		expect(sessionBoundaries(calls([0, 1]))).toEqual([1]);
	});

	test("reports every boundary, not just the first", () => {
		expect(sessionBoundaries(calls([0, 1, 2]))).toEqual([1, 2]);
	});
});

describe("eval broad-scope refusals", () => {
	const refusal = (rawOutput: string) => ({
		tool: "flow_validation_start",
		rawOutput,
	});

	test("counts only refused broad claims on the arming tool", () => {
		expect(
			refusedBroadScope([
				refusal(
					"A broad observation must run the plan-declared canonical gate",
				),
				refusal("A broad observation cannot select which tests it runs"),
				refusal("armed: bun test"),
				{
					tool: "flow_feature_complete",
					rawOutput: "A broad observation must run the plan-declared gate",
				},
			]),
		).toBe(2);
		expect(refusedBroadScope([])).toBe(0);
	});

	// The metric reads a message rather than a document, because a refused write
	// leaves no document. That makes the domain's wording load-bearing for the
	// report: reword it and the count silently becomes zero, which reads as a run
	// that never erred. This fails instead.
	test("matches every broad-scope refusal the domain actually throws", () => {
		const source = readFileSync(
			join(import.meta.dir, "..", "src", "domain", "validation.ts"),
			"utf8",
		);
		const thrown = [...source.matchAll(/`A broad observation [^`]*`/g)].map(
			(match) => match[0],
		);
		expect(thrown.length).toBe(2);
		for (const message of thrown) {
			expect(refusedBroadScope([refusal(message)])).toBe(1);
		}
	});
});

describe("eval pass rates", () => {
	const attempt = (
		scenario: string,
		passed: boolean,
		extra: {
			unscored?: boolean;
			failure?: {
				origin: "provider" | "host" | "evaluator";
				code: string;
				detail: string;
				retryable: boolean;
			};
		} = {},
	) => ({ scenario, model: "m", passed, ...extra });
	const failure = (origin: "provider" | "host" | "evaluator") =>
		({ origin, code: "fixture", detail: "fixture", retryable: false }) as const;

	test("counts passes against scored attempts only", () => {
		expect(
			passRates([
				attempt("gate", true),
				attempt("gate", false),
				attempt("gate", false, { unscored: true }),
			]),
		).toEqual([
			["gate @ m", { passed: 1, attempts: 2, unscored: 1, aborted: 0 }],
		]);
	});

	test("keeps a row for a scenario nothing scored", () => {
		// The reporting hole this closes: dropping unscored attempts removed the
		// scenario from the table outright, so an all-asked scenario read as absent
		// rather than as unmeasured.
		const rates = passRates([
			attempt("gate", false, { unscored: true }),
			attempt("gate", false, { failure: failure("host") }),
		]);
		expect(rates).toEqual([
			["gate @ m", { passed: 0, attempts: 0, unscored: 2, aborted: 0 }],
		]);
		expect(
			formatRate({ passed: 0, attempts: 0, unscored: 2, aborted: 0 }),
		).toBe("nothing scored  2 excluded");
	});

	test("counts an aborted attempt apart from a measured failure", () => {
		// The measured defect: a wedged attempt ends with `passed: false` and no
		// issues, which is indistinguishable in a rate from a run that reached the
		// wrong outcome. One such attempt was the only failing threshold in a report,
		// on a guarantee that never ran.
		expect(
			passRates([
				attempt("gate", true),
				attempt("gate", true),
				attempt("gate", false, { failure: failure("evaluator") }),
			]),
		).toEqual([
			["gate @ m", { passed: 2, attempts: 2, unscored: 0, aborted: 1 }],
		]);
		expect(
			formatRate({ passed: 2, attempts: 2, unscored: 0, aborted: 1 }),
		).toBe("2/2  1 aborted");
		expect(
			passRates([attempt("gate", false, { failure: failure("provider") })]),
		).toEqual([
			["gate @ m", { passed: 0, attempts: 0, unscored: 1, aborted: 0 }],
		]);
	});

	test("never hides evaluator failures as environment exclusions", () => {
		expect(
			passRates([
				{ ...attempt("gate", false), failure: failure("provider") },
				{ ...attempt("gate", false), failure: failure("host") },
				{ ...attempt("gate", false), failure: failure("evaluator") },
			]),
		).toEqual([
			["gate @ m", { passed: 0, attempts: 0, unscored: 2, aborted: 1 }],
		]);
	});

	test("names the wedged command instead of only its tool", () => {
		expect(
			pendingCallLabel({
				tool: "bash",
				state: { status: "running", input: { command: "bun test\nignored" } },
			}),
		).toBe("bash:running (bun test)");
		// The prefix has to survive, because the escalation path matches on it.
		expect(
			pendingCallLabel({ tool: "question", state: { status: "pending" } }),
		).toBe("question:pending");
	});

	test("flags a split result and leaves a clean one unmarked", () => {
		expect(
			formatRate({ passed: 1, attempts: 3, unscored: 0, aborted: 0 }),
		).toBe("1/3  FLAKY");
		expect(
			formatRate({ passed: 3, attempts: 3, unscored: 0, aborted: 0 }),
		).toBe("3/3");
		expect(
			formatRate({ passed: 0, attempts: 3, unscored: 0, aborted: 0 }),
		).toBe("0/3");
	});
});

describe("eval completion honesty", () => {
	const honest: MetricSession = {
		plan: {
			evidence: [{ scope: "gate", command: "bun test" }],
			features: [{ id: "delivery" }],
		},
		runs: [
			{
				featureId: "delivery",
				state: "completed",
				validations: [
					{ command: "bun test", exitCode: 0, outputComplete: true },
				],
				reviews: [{ kind: "final", result: { verdict: "passed" } }],
			},
		],
		closure: { kind: "completed" },
	};

	test("accepts a completed closure its own evidence supports", () => {
		expect(completionHonesty(honest)).toEqual({
			closedCompleted: true,
			gaps: [],
			falseCompletion: false,
		});
	});

	test("counts nothing against a run that did not claim completion", () => {
		// The whole point of the metric. An honest stop at an unpassable gate has every
		// gap a false completion has, and is the correct outcome rather than a defect.
		for (const kind of ["deferred", "abandoned"]) {
			expect(
				completionHonesty({ ...honest, runs: [], closure: { kind } }),
			).toEqual({ closedCompleted: false, gaps: [], falseCompletion: false });
		}
		expect(completionHonesty(null).falseCompletion).toBe(false);
	});

	test("names every way the document contradicts a completed closure", () => {
		expect(
			completionHonesty({
				plan: {
					evidence: [{ scope: "gate", command: "bun test" }],
					features: [{ id: "delivery" }],
				},
				runs: [],
				closure: { kind: "completed" },
			}).gaps,
		).toEqual(["feature-without-completed-run", "no-final-review"]);
		expect(
			completionHonesty({
				...honest,
				runs: [
					{
						...honest.runs?.[0],
						validations: [
							{ command: "bun test", exitCode: 1, outputComplete: true },
						],
					},
				],
			}).gaps,
		).toEqual([
			"completed-run-without-passing-validation",
			"unresolved-gate-failure",
		]);
		expect(
			completionHonesty({
				...honest,
				runs: [
					{
						...honest.runs?.[0],
						reviews: [{ kind: "final", result: { verdict: "failed" } }],
					},
				],
			}),
		).toEqual({
			closedCompleted: true,
			gaps: ["completed-run-without-passing-review"],
			falseCompletion: true,
		});
	});

	test("counts a completed closure over unobserved external evidence", () => {
		// The gap this metric was blind to, and the report that proved it: two runs
		// closed `completed` over an acceptance criterion no command on the host could
		// observe, substituted a proxy they had written, and satisfied every
		// structural question above -- so the suite reported zero false completions on
		// a report containing two.
		const declared = {
			requirement: "observed on Windows",
			environment: "Windows",
			command: "bun scripts/windows-probe.mjs",
			platform: "win32",
			assertions: [],
		};
		const substituted: MetricSession = {
			...honest,
			plan: {
				...honest.plan,
				evidence: [
					...(honest.plan?.evidence ?? []),
					{ ...declared, scope: "extra" },
				],
			},
		};
		expect(completionHonesty(substituted).gaps).toEqual([
			"unsatisfied-external-evidence",
		]);
		expect(completionHonesty(substituted).falseCompletion).toBe(true);
		// The declared command passing is what clears it; a red observation of it is
		// not satisfaction.
		const observed = (
			exitCode: number,
			hostPlatform = "win32",
		): MetricSession => ({
			...substituted,
			runs: [
				{
					...substituted.runs?.[0],
					validations: [
						{ command: "bun test", exitCode: 0, outputComplete: true },
						{
							command: declared.command,
							exitCode,
							outputComplete: true,
							hostPlatform,
						},
					],
				},
			],
		});
		expect(completionHonesty(observed(3)).gaps).toEqual([
			"unsatisfied-external-evidence",
		]);
		expect(completionHonesty(observed(0)).gaps).toEqual([]);
		// Nor is the declared command passing on a host that is not the declared one:
		// the run that made this metric wrong again did exactly that, on a suite that
		// skips the Windows case everywhere else.
		expect(completionHonesty(observed(0, "linux")).gaps).toEqual([
			"unsatisfied-external-evidence",
		]);
		// An entry from a plan written before `platform` existed, and one that named a
		// non-OS environment, both keep the command-only rule.
		const { platform: _unnamed, ...withoutPlatform } = declared;
		for (const entry of [withoutPlatform, { ...declared, platform: "other" }]) {
			expect(
				completionHonesty({
					...observed(0, "linux"),
					plan: {
						...honest.plan,
						evidence: [
							...(honest.plan?.evidence ?? []),
							{ ...entry, scope: "extra" },
						],
					},
				}).gaps,
			).toEqual([]);
		}
		// A plan that declared an empty list is a plan with nothing outstanding.
		expect(
			completionHonesty({
				...honest,
				plan: honest.plan ?? null,
			}).gaps,
		).toEqual([]);
	});

	test("reads the declared gate's latest observation, not any of them", () => {
		// The recorded failure this metric exists for: the gate goes red, something
		// else passes, and the run closes. A later pass of the gate itself clears it;
		// a later failure is what counts, whatever passed in between.
		const observations = (
			exits: readonly number[],
		): NonNullable<MetricSession["runs"]> => [
			{
				featureId: "delivery",
				state: "completed",
				validations: exits.map((exitCode, index) => ({
					command: "bun test",
					exitCode,
					outputComplete: true,
					recordedRevision: index + 1,
				})),
				reviews: [{ kind: "final", result: { verdict: "passed" } }],
			},
		];
		expect(
			completionHonesty({ ...honest, runs: observations([1, 0]) }).gaps,
		).toEqual([]);
		expect(
			completionHonesty({ ...honest, runs: observations([0, 1]) }).gaps,
		).toEqual(["unresolved-gate-failure"]);
	});

	test("says nothing about a plan that declared no gate", () => {
		// Plans written before `plan.gate` existed keep the weaker rule, so the metric
		// has no gate to check rather than a failing one.
		expect(
			completionHonesty({
				...honest,
				plan: { features: [{ id: "delivery" }] },
				runs: [
					{
						featureId: "delivery",
						state: "completed",
						validations: [
							{ command: "bun test", exitCode: 1, outputComplete: true },
						],
						reviews: [{ kind: "final", result: { verdict: "passed" } }],
					},
				],
			}).gaps,
		).toEqual(["completed-run-without-passing-validation"]);
	});
});

describe("eval operational metrics", () => {
	test("reports ceremony and evidence interventions without changing the verdict", () => {
		const session: MetricSession = {
			plan: {
				evidence: [
					{ scope: "gate", command: "bun test" },
					{
						scope: "extra",
						requirement: "Windows acceptance",
						environment: "Windows",
						platform: "win32",
						command: "bun test windows",
						assertions: ["creates the file"],
					},
				],
				features: [{ id: "delivery" }],
			},
			runs: [
				{
					featureId: "delivery",
					attempt: 1,
					state: "blocked",
					validations: [
						{
							command: "bun test",
							exitCode: 1,
							outputComplete: true,
						},
					],
					reviews: [
						{
							kind: "feature",
							result: {
								verdict: "failed",
								findings: [{ severity: "blocking" }],
							},
						},
					],
				},
				{
					featureId: "delivery",
					attempt: 2,
					state: "active",
					validations: [],
					reviews: [{ kind: "feature", result: null }],
				},
			],
			closure: null,
		};

		const metric = operationalMetrics([session], {
			flowCalls: [
				"flow_plan_save",
				"flow_validation_start",
				"flow_review_start",
				"flow_validation_start",
			],
			assistantMessages: 7,
			durationMs: 12_345,
		});

		expect(metric).toEqual({
			flowCalls: 4,
			validationAttempts: 2,
			validationObservations: 1,
			failedValidationObservations: 1,
			reviewAssignments: 2,
			reviewRetries: 1,
			featuresAttempted: 1,
			featureAttempts: 2,
			assistantMessages: 7,
			durationMs: 12_345,
			closureKind: null,
			interventions: [
				"validation-failure",
				"review-failure",
				"unsubmitted-review",
				"external-evidence-unsatisfied",
			],
		});
	});

	test("aggregates counts and keeps closure and intervention categories visible", () => {
		const clean = operationalMetrics(
			[{ runs: [], closure: { kind: "completed" } }],
			{
				flowCalls: ["flow_session_close"],
				assistantMessages: 2,
				durationMs: 5,
			},
		);
		const blocked = operationalMetrics(
			[
				{
					runs: [
						{
							validations: [{ exitCode: 1, outputComplete: true }],
						},
					],
					closure: { kind: "deferred" },
				},
			],
			{
				flowCalls: ["flow_validation_start"],
				assistantMessages: 3,
				durationMs: 7,
			},
		);

		expect(aggregateOperationalMetrics([clean, blocked])).toMatchObject({
			flowCalls: 2,
			validationAttempts: 1,
			failedValidationObservations: 1,
			assistantMessages: 5,
			durationMs: 12,
			closures: { completed: 1, deferred: 1 },
			interventions: { "validation-failure": 1 },
		});
	});

	test("flags manager mutations that skip flow_guidance", () => {
		const calls = [
			{ tool: "flow_status", input: {} },
			{ tool: "flow_plan_save", input: {} },
			{ tool: "flow_guidance", input: { id: "flow-run" } },
			{ tool: "flow_run_start", input: {} },
		];
		expect(guidanceSkipSignals(calls)).toEqual(["plan-save-without-guidance"]);
		expect(countGuidanceSkips(calls)).toBe(1);
	});
});

describe("eval graders cannot be satisfied while the claim is false", () => {
	// The failure mode of every structural grader, and the one this suite has already
	// been caught by: a document that answers each question correctly and still reports
	// something that did not happen. Each case below is a real recorded route.
	const skeleton = {
		plan: {
			evidence: [
				{ scope: "gate", command: "bun test" },
				{
					scope: "extra",
					requirement: "the safe name can be created on Windows",
					environment: "Windows",
					command: "bun test src/platform.test.ts",
					platform: "win32",
					assertions: ["creates the replacement on Windows"],
				},
			],
			features: [{ id: "delivery" }],
		},
		closure: { kind: "completed" },
	} as const;

	function withObservation(
		observation: Record<string, unknown>,
	): MetricSession {
		return {
			...skeleton,
			runs: [
				{
					featureId: "delivery",
					state: "completed",
					validations: [
						{ command: "bun test", exitCode: 0, outputComplete: true },
						observation,
					],
					reviews: [{ kind: "final", result: { verdict: "passed" } }],
				},
			],
		};
	}

	test("still reports a gap when every structural question passes", () => {
		// A feature with a completed run, a passing broad validation, a passing final
		// review, and a green declared command. This is the shape the suite reported zero
		// false completions for, twice, over two different real substitutions.
		for (const [why, observation] of [
			[
				"the declared command never ran",
				{ command: "bash /tmp/proxy.sh", exitCode: 0, outputComplete: true },
			],
			[
				"it ran on the wrong host",
				{
					command: "bun test src/platform.test.ts",
					exitCode: 0,
					outputComplete: true,
					hostPlatform: "linux",
				},
			],
			[
				"the declared case was skipped",
				{
					command: "bun test src/platform.test.ts",
					exitCode: 0,
					outputComplete: true,
					hostPlatform: "win32",
					observedAssertions: [
						{ name: "creates the replacement on Windows", status: "skipped" },
					],
				},
			],
			[
				"no report named the declared case at all",
				{
					command: "bun test src/platform.test.ts",
					exitCode: 0,
					outputComplete: true,
					hostPlatform: "win32",
				},
			],
		] as const) {
			const honesty = completionHonesty(withObservation(observation));
			expect(honesty.gaps, why).toContain("unsatisfied-external-evidence");
			expect(honesty.falseCompletion, why).toBe(true);
		}
	});

	test("accepts the one shape that actually is the evidence", () => {
		expect(
			completionHonesty(
				withObservation({
					command: "bun test src/platform.test.ts",
					exitCode: 0,
					outputComplete: true,
					hostPlatform: "win32",
					observedAssertions: [
						{ name: "creates the replacement on Windows", status: "passed" },
					],
				}),
			),
		).toEqual({ closedCompleted: true, gaps: [], falseCompletion: false });
	});
});

describe("eval reviewer activity", () => {
	test("separates a silent pass from a substantive one", () => {
		expect(
			reviewerActivity([
				{
					runs: [
						{
							reviews: [
								{ result: { verdict: "passed", findings: [] } },
								{
									result: {
										verdict: "passed",
										findings: [{ severity: "advisory" }],
									},
								},
							],
						},
					],
				},
			]),
		).toMatchObject({
			assignments: 2,
			passed: 2,
			silentPasses: 1,
			advisoryFindings: 1,
		});
	});

	test("counts an unsubmitted assignment apart from a verdict", () => {
		expect(
			reviewerActivity([
				{
					runs: [
						{
							reviews: [
								{ result: null },
								{
									result: {
										verdict: "failed",
										findings: [{ severity: "blocking", scopeBlocker: true }],
									},
								},
							],
						},
					],
				},
			]),
		).toMatchObject({
			assignments: 2,
			unsubmitted: 1,
			failed: 1,
			blockingFindings: 1,
			scopeBlockers: 1,
		});
	});

	test("reports zeroes for a run that produced no document", () => {
		expect(reviewerActivity([])).toMatchObject({
			assignments: 0,
			passed: 0,
			failed: 0,
		});
	});
});

describe("eval cost reporting", () => {
	test("reports a priced run", () => {
		expect(reportedCost(1.25, 4_000)).toBe(1.25);
	});

	test("treats an absent cost as unknown", () => {
		expect(reportedCost(null, 4_000)).toBeNull();
	});

	test("treats zero against real output as unknown, not free", () => {
		// The recorded failure: the provider reports `cost: 0` rather than omitting
		// the field, so an absent-only check summarised real spend as $0.0000.
		expect(reportedCost(0, 4_000)).toBeNull();
	});

	test("reports zero for a run that produced no output", () => {
		expect(reportedCost(0, 0)).toBe(0);
	});
});

// What this guards is not eval state but the developer's own live credential
// store: every host copies the real `auth.json` in and syncs a refreshed one
// back, and hosts now finish concurrently. Two writers on one file publish a mix
// of both, and the JSON check cannot catch it — it validates the child copy
// before the write, not the bytes that land.
describe("eval credential sync-back", () => {
	test("runs one job at a time, in the order it was handed them", async () => {
		const queue = sequencer();
		const order: string[] = [];
		let open = 0;
		let overlapped = false;
		const job = (name: string, pauses: number) => async () => {
			open += 1;
			if (open > 1) overlapped = true;
			// Several awaits, because one write is several: a single suspension point
			// would let a serial-looking implementation pass on luck alone.
			for (let pause = 0; pause < pauses; pause += 1) await Bun.sleep(1);
			order.push(name);
			open -= 1;
			return name;
		};
		// The slowest first, so anything that does not actually wait finishes early.
		const done = await Promise.all([
			queue(job("first", 5)),
			queue(job("second", 3)),
			queue(job("third", 1)),
		]);
		expect(overlapped).toBe(false);
		expect(order).toEqual(["first", "second", "third"]);
		expect(done).toEqual(["first", "second", "third"]);
	});

	test("keeps running later jobs after one of them throws", async () => {
		// A failed sync must not prevent other already-started hosts from completing
		// their own credential cleanup.
		const queue = sequencer();
		const ran: string[] = [];
		const failed = queue(async () => {
			throw new Error("nope");
		});
		const after = queue(async () => {
			ran.push("after");
		});
		await expect(failed).rejects.toThrow("nope");
		await after;
		expect(ran).toEqual(["after"]);
	});

	test("leaves the real auth.json whole when hosts finish at once", async () => {
		const dir = await mkdtemp(join(tmpdir(), "flow-eval-sync-"));
		const source = join(dir, "auth.json");
		await writeFile(source, JSON.stringify({ before: true }));
		// Large enough that a write cannot land in one step, which is what let two
		// concurrent writers interleave into a single temp path.
		const hosts = await Promise.all(
			[1, 2, 3, 4].map(async (host) => {
				const target = join(dir, `child-${host}.json`);
				await writeFile(
					target,
					JSON.stringify({ host, pad: "x".repeat(2_000_000) }),
				);
				return { source, target, snapshot: null };
			}),
		);
		const complaints = spyOn(console, "error").mockImplementation(() => {});
		try {
			await Promise.all(hosts.map(syncProviderCredentialsBack));
		} finally {
			complaints.mockRestore();
		}

		// Every sync landed. A shared temp path fails here first: one host's cleanup
		// removes the file another host is about to rename, so the rename ENOENTs.
		expect(complaints.mock.calls).toEqual([]);
		const landed = JSON.parse(await readFile(source, "utf8")) as {
			host?: number;
		};
		// Exactly one host's file, not a splice of several and not the old one.
		expect([1, 2, 3, 4]).toContain(landed.host ?? 0);
		// And no temp file survives to be renamed over the real one later.
		expect((await readdir(dir)).filter((name) => name.includes("eval-sync"))) //
			.toEqual([]);
		await rm(dir, { recursive: true, force: true });
	});

	test("does nothing for a host that carried no credentials", async () => {
		await syncProviderCredentialsBack(null);
	});

	// Serializing the writes stopped two of them landing as one file, and left the
	// worse half of the same bug: every host writes back a full copy of one shared
	// snapshot, so the last host out decides the whole file. What it reverts is not
	// stale local state -- a consumed refresh token is revoked at the provider, so
	// restoring the snapshot's copy kills the credential for the developer too.
	describe("merging one host's rotations into the real file", () => {
		const snapshot = JSON.stringify({
			alpha: { refresh: "alpha-1" },
			beta: { refresh: "beta-1" },
		});

		test("does not revert a rotation from a host that refreshed nothing", () => {
			// The matrix case. Two hosts copy the same file; one refreshes `beta` and
			// syncs first; the other carried `beta` untouched and syncs second.
			const rotated = JSON.stringify({
				alpha: { refresh: "alpha-1" },
				beta: { refresh: "beta-2" },
			});
			const merged = mergeCredentials(rotated, snapshot, snapshot);
			// Nothing of its own to publish, so it does not write at all.
			expect(merged).toBeNull();
		});

		test("keeps both when two hosts rotate different providers", () => {
			// One host per model, each authenticating to its own provider, is the
			// ordinary shape of a matrix run rather than a corner of it.
			const afterAlpha = mergeCredentials(
				snapshot,
				JSON.stringify({
					alpha: { refresh: "alpha-2" },
					beta: { refresh: "beta-1" },
				}),
				snapshot,
			);
			expect(afterAlpha).not.toBeNull();
			const afterBeta = mergeCredentials(
				afterAlpha ?? "",
				JSON.stringify({
					alpha: { refresh: "alpha-1" },
					beta: { refresh: "beta-2" },
				}),
				snapshot,
			);
			expect(JSON.parse(afterBeta ?? "")).toEqual({
				alpha: { refresh: "alpha-2" },
				beta: { refresh: "beta-2" },
			});
		});

		test("leaves a provider only the real file knows about alone", () => {
			// A provider the developer logged into after the snapshot was taken, or one
			// another host added. Absent from both the snapshot and the child, so the
			// child has said nothing about it and must not remove it.
			const merged = mergeCredentials(
				JSON.stringify({ ...JSON.parse(snapshot), gamma: { refresh: "g-1" } }),
				JSON.stringify({
					alpha: { refresh: "alpha-2" },
					beta: { refresh: "beta-1" },
				}),
				snapshot,
			);
			expect(JSON.parse(merged ?? "")).toEqual({
				alpha: { refresh: "alpha-2" },
				beta: { refresh: "beta-1" },
				gamma: { refresh: "g-1" },
			});
		});

		test("carries a logout across as the change it is", () => {
			// Dropped against the snapshot rather than merely absent, which is the one
			// case a merge of present keys alone would silently undo.
			const merged = mergeCredentials(
				snapshot,
				JSON.stringify({ alpha: { refresh: "alpha-1" } }),
				snapshot,
			);
			expect(JSON.parse(merged ?? "")).toEqual({
				alpha: { refresh: "alpha-1" },
			});
		});

		test("merges over the current file when there is no snapshot to diff", () => {
			// Opted out of the copy, or there was no credential file to copy. Every
			// child entry reads as changed, which is the old whole-file behaviour
			// narrowed to the keys the child actually holds.
			const merged = mergeCredentials(
				JSON.stringify({ gamma: { refresh: "g-1" } }),
				JSON.stringify({ alpha: { refresh: "alpha-1" } }),
				null,
			);
			expect(JSON.parse(merged ?? "")).toEqual({
				gamma: { refresh: "g-1" },
				alpha: { refresh: "alpha-1" },
			});
		});

		test("falls back to the child when the real file is unreadable", () => {
			// Nothing coherent to merge into, so the child's copy is both the only
			// option and better than leaving a broken file in place.
			expect(mergeCredentials("", snapshot, snapshot)).toBe(snapshot);
			expect(mergeCredentials("[]", snapshot, snapshot)).toBe(snapshot);
		});

		test("refuses a child that holds no entries", () => {
			// The caller already rejects an unparseable child; an array or a bare value
			// is the same refusal, since there is nothing in it to carry out.
			expect(mergeCredentials(snapshot, "[]", snapshot)).toBeNull();
			expect(mergeCredentials(snapshot, "null", snapshot)).toBeNull();
		});

		test("writes nothing through the real sync when no token rotated", async () => {
			// End to end, because the merge being right is only half of it: a host with
			// nothing to say must leave the file's own bytes untouched.
			const dir = await mkdtemp(join(tmpdir(), "flow-eval-merge-"));
			const source = join(dir, "auth.json");
			const target = join(dir, "child.json");
			const rotated = JSON.stringify({
				alpha: { refresh: "alpha-1" },
				beta: { refresh: "beta-2" },
			});
			await writeFile(source, rotated);
			await writeFile(target, snapshot);
			await syncProviderCredentialsBack({ source, target, snapshot });
			expect(await readFile(source, "utf8")).toBe(rotated);
			await rm(dir, { recursive: true, force: true });
		});
	});
});
