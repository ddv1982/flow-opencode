import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRecoveryEvaluation } from "../evals/recovery-decisions/collect.js";
import { CorpusSchema } from "../evals/recovery-decisions/evaluate.js";
import { runRecoveryEvaluation } from "../evals/recovery-decisions/run.js";
import { authorizePaidRun, paidRunStatus } from "../scripts/paid-budget.js";
import { JEV_ATTEMPT_RESERVATION_USD } from "../src/infrastructure/jev-transport.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function setup() {
	const root = await mkdtemp(join(tmpdir(), "recovery-collection-"));
	directories.push(root);
	const authorizationDirectory = join(root, "authorization");
	await authorizePaidRun(authorizationDirectory, {
		schemaVersion: 1,
		purpose: "offline-test",
		models: ["typesafe/jev-1.13.0"],
		maxDispatches: 1,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
	});
	const corpus = CorpusSchema.parse(
		JSON.parse(
			await readFile("evals/recovery-decisions/development.json", "utf8"),
		),
	);
	return {
		corpus,
		outputDirectory: join(root, "output"),
		authorizationDirectory,
		apiKey: "test-credential-never-retain",
		maxCalls: 3,
		maxUsd: 0.1,
	};
}

describe("runtime recovery collection", () => {
	test("reserves retry attempts before dispatch and shares the cap across cases", async () => {
		const options = await setup();
		let successful = 0;
		const visibleReservations: number[] = [];
		const report = await collectRecoveryEvaluation({
			...options,
			simulation: {
				kind: "simulation",
				provider: {
					async assess(_packet, request) {
						for (let i = 0; i < 2; i++) {
							if (!request.reserveAttempt())
								return { kind: "unavailable", reason: "budget" };
							successful++;
							const receipt = JSON.parse(
								await readFile(
									join(
										options.outputDirectory,
										`attempt-${String(successful).padStart(6, "0")}.json`,
									),
									"utf8",
								),
							);
							visibleReservations.push(receipt.calls);
						}
						return { kind: "unavailable", reason: "http" };
					},
				},
			},
		});
		expect(successful).toBe(3);
		expect(visibleReservations).toEqual([1, 2, 3]);
		expect(report.calls).toBe(3);
		expect(report.reservedUsd).toBeCloseTo(3 * JEV_ATTEMPT_RESERVATION_USD);
		expect(report.status).toBe("incomplete");
		expect(report.origin).toBe("simulation");
		expect(report.rows.every((row) => row.labelMatches === null)).toBe(true);
		expect(
			(await paidRunStatus(options.authorizationDirectory)).remaining,
		).toBe(0);
		expect((await stat(options.outputDirectory)).mode & 0o777).toBe(0o700);
		expect(
			(await stat(join(options.outputDirectory, "manifest.json"))).mode & 0o777,
		).toBe(0o600);
		const files = await readdir(options.outputDirectory);
		for (const file of files)
			expect(
				await readFile(join(options.outputDirectory, file), "utf8"),
			).not.toContain(options.apiKey);
	});
	test("dollar cap blocks dispatch even with attempts remaining", async () => {
		const options = await setup();
		let attempts = 0;
		const report = await collectRecoveryEvaluation({
			...options,
			maxUsd: JEV_ATTEMPT_RESERVATION_USD,
			simulation: {
				kind: "simulation",
				provider: {
					async assess(_packet, request) {
						if (request.reserveAttempt()) attempts++;
						return { kind: "unavailable", reason: "test" };
					},
				},
			},
		});
		expect(attempts).toBe(1);
		expect(report.calls).toBe(1);
	});
	test("cancellation stops later cases and retains consumed reservations", async () => {
		const options = await setup();
		const controller = new AbortController();
		const observations: boolean[] = [];
		let calls = 0;
		const report = await collectRecoveryEvaluation({
			...options,
			signal: controller.signal,
			simulation: {
				kind: "simulation",
				provider: {
					async assess(_packet, request) {
						calls++;
						observations.push(request.reserveAttempt());
						controller.abort();
						observations.push(request.signal.aborted);
						observations.push(request.reserveAttempt());
						return { kind: "unavailable", reason: "cancelled" };
					},
				},
			},
		});
		expect(calls).toBe(1);
		expect(report.status).toBe("cancelled");
		expect(observations).toEqual([true, true, false]);
		expect(report.completedCases).toBe(1);
		expect(report.calls).toBe(1);
	});
	test("a used output and exhausted dispatch cannot invoke the provider", async () => {
		const options = await setup();
		let calls = 0;
		const simulation = {
			kind: "simulation" as const,
			provider: {
				async assess() {
					calls++;
					return { kind: "unavailable" as const, reason: "test" };
				},
			},
		};
		await collectRecoveryEvaluation({ ...options, simulation });
		const originalCalls = calls;
		const original = await readFile(
			join(options.outputDirectory, "summary.json"),
			"utf8",
		);
		await expect(
			collectRecoveryEvaluation({ ...options, simulation }),
		).rejects.toThrow();
		await expect(
			collectRecoveryEvaluation({
				...options,
				outputDirectory: `${options.outputDirectory}-new`,
				simulation,
			}),
		).rejects.toThrow("authorization refused");
		expect(calls).toBe(originalCalls);
		expect(
			await readFile(join(options.outputDirectory, "summary.json"), "utf8"),
		).toBe(original);
	});
	test("rejects sensitive or cancelled input without consuming authorization", async () => {
		const options = await setup();
		const first = options.corpus.cases[0];
		if (!first) throw new Error("Missing fixture");
		first.rationale = options.apiKey;
		await expect(collectRecoveryEvaluation(options)).rejects.toThrow(
			"Sensitive corpus",
		);
		expect(
			(await paidRunStatus(options.authorizationDirectory)).remaining,
		).toBe(1);
		const other = await setup();
		await expect(
			collectRecoveryEvaluation({ ...other, signal: AbortSignal.abort() }),
		).rejects.toThrow("cancelled");
		expect((await paidRunStatus(other.authorizationDirectory)).remaining).toBe(
			1,
		);
	});
	test("refuses quoted secret properties before writing evidence", async () => {
		const options = await setup();
		await expect(
			collectRecoveryEvaluation({
				...options,
				corpus: { ...options.corpus, password: "hidden-value" },
			}),
		).rejects.toThrow("Sensitive corpus");
		expect(
			(await paidRunStatus(options.authorizationDirectory)).remaining,
		).toBe(1);
	});
	test("provider errors stop later cases without retaining exception secrets", async () => {
		const options = await setup();
		let calls = 0;
		const report = await collectRecoveryEvaluation({
			...options,
			simulation: {
				kind: "simulation",
				provider: {
					async assess() {
						calls++;
						throw new Error(options.apiKey);
					},
				},
			},
		});
		expect(calls).toBe(1);
		expect(report.status).toBe("incomplete");
		expect(JSON.stringify(report)).not.toContain(options.apiKey);
		expect(report.rows[0]?.advice).toEqual({
			kind: "unavailable",
			reason: "provider-error",
		});
	});
	test("receipt failure stops subsequent provider calls", async () => {
		const observations: boolean[] = [];
		const options = await setup();
		let calls = 0;
		const report = await collectRecoveryEvaluation({
			...options,
			simulation: {
				kind: "simulation",
				provider: {
					async assess(_packet, request) {
						calls++;
						await Bun.write(
							join(options.outputDirectory, "attempt-000001.json"),
							"occupied",
						);
						observations.push(request.reserveAttempt());
						return { kind: "unavailable", reason: "budget" };
					},
				},
			},
		});
		expect(calls).toBe(1);
		expect(report.status).toBe("incomplete");
		expect(report.calls).toBe(1);
		expect(observations).toEqual([false]);
		expect(report.rows[0]?.advice).toEqual({
			kind: "unavailable",
			reason: "budget",
		});
	});
	test("production adapter retries and completes through isolated CLI transport", async () => {
		const options = await setup();
		const preload = join(options.authorizationDirectory, "transport.ts");
		await Bun.write(
			preload,
			`let calls=0;
 globalThis.fetch = async (_url, init) => {
 calls++;
 if(calls === 1) return new Response("",{status:503,headers:{"retry-after":"0"}});
 const body=JSON.parse(init.body);
 const ids=Object.keys(body.questions.choice.criteria);
 const answers={choice:{type:"choice",choice:"abstain",confidence:1,probabilities:Object.fromEntries(ids.map(id=>[id,id==="abstain"?1:0]))}};
 for(const key of Object.keys(body.questions)) if(key!=="choice") answers[key]={type:"noul",noul:0};
 return Response.json({model:"jev-1.13.0",answers,usage:{input_tokens:100,output_tokens:10}});
 };`,
		);
		const child = Bun.spawn(
			[
				process.execPath,
				"--preload",
				preload,
				"evals/recovery-decisions/run.ts",
				"collect",
				"evals/recovery-decisions/development.json",
				options.outputDirectory,
				"--max-calls",
				"7",
				"--max-usd",
				"0.1",
			],
			{
				env: {
					...process.env,
					TYPESAFE_API_KEY: options.apiKey,
					FLOW_EVAL_AUTHORIZATION: options.authorizationDirectory,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const stderr = await new Response(child.stderr).text();
		expect(await child.exited).toBe(0);
		expect(stderr).toBe("");
		const report = JSON.parse(
			await readFile(join(options.outputDirectory, "summary.json"), "utf8"),
		);
		expect(report.status).toBe("complete");
		expect(report.calls).toBe(7);
		expect(report.completedCases).toBe(8);
		expect(report.inputTokens).toBe(600);
		expect(report.outputTokens).toBe(60);
		expect(report.rows[0].attempts).toBe(2);
		expect(report.rows[0].advice.kind).toBe("answered");
		expect(report.qualification).toBe("inconclusive");
	});
	test("CLI requires both explicit caps", async () => {
		await expect(
			runRecoveryEvaluation(["collect", "input.json", "output"]),
		).rejects.toThrow("Usage");
		await expect(
			runRecoveryEvaluation([
				"collect",
				"input.json",
				"output",
				"--max-calls",
				"1",
				"--max-calls",
				"2",
			]),
		).rejects.toThrow("Invalid");
	});
});
