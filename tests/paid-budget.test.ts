import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalHost } from "../evals/harness.js";
import {
	authorizePaidRun,
	consumePaidDispatch,
	paidRunStatus,
} from "../scripts/paid-budget.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function budget(maxDispatches = 2) {
	const directory = await mkdtemp(join(tmpdir(), "flow-budget-test-"));
	directories.push(directory);
	await authorizePaidRun(directory, {
		schemaVersion: 1,
		purpose: "Fake dispatch tests",
		models: ["fake/model"],
		maxDispatches,
		expiresAt: new Date(Date.now() + 3600000).toISOString(),
	});
	return directory;
}
test("authorization cannot be silently replaced and consumed starts survive restart", async () => {
	const directory = await budget(1);
	const auth = (await paidRunStatus(directory)).authorization;
	await expect(authorizePaidRun(directory, auth)).rejects.toThrow();
	await consumePaidDispatch({ model: "fake/model", kind: "probe" }, directory);
	await expect(
		consumePaidDispatch({ model: "fake/model", kind: "canary" }, directory),
	).rejects.toThrow("exhausted");
	expect((await paidRunStatus(directory)).remaining).toBe(0);
});
test("concurrent processes cannot exceed the durable budget", async () => {
	const directory = await budget(3);
	const invoke = () =>
		new Promise<number>((resolve) => {
			const child = spawn(
				"bun",
				[
					"-e",
					'import {consumePaidDispatch} from "./scripts/paid-budget.ts"; await consumePaidDispatch({model:"fake/model",kind:"command"});',
				],
				{
					cwd: process.cwd(),
					env: { ...process.env, FLOW_EVAL_AUTHORIZATION: directory },
					stdio: "ignore",
				},
			);
			child.on("close", (code) => resolve(code ?? 1));
		});
	const results = await Promise.all(Array.from({ length: 8 }, invoke));
	expect(results.filter((code) => code === 0)).toHaveLength(3);
	expect((await paidRunStatus(directory)).consumed).toBe(3);
});
test("unknown models, expiry, and corrupt consumption fail closed", async () => {
	const directory = await budget();
	await expect(
		consumePaidDispatch({ model: "other/model", kind: "prompt" }, directory),
	).rejects.toThrow("not authorized");
	const auth = JSON.parse(
		await readFile(join(directory, "authorization.json"), "utf8"),
	);
	await writeFile(
		join(directory, "authorization.json"),
		JSON.stringify({ ...auth, expiresAt: "2000-01-01T00:00:00.000Z" }),
	);
	await expect(
		consumePaidDispatch({ model: "fake/model", kind: "prompt" }, directory),
	).rejects.toThrow("expired");
	await writeFile(join(directory, "authorization.json"), JSON.stringify(auth));
	await writeFile(join(directory, "dispatch-0.json"), "{");
	await expect(
		consumePaidDispatch({ model: "fake/model", kind: "prompt" }, directory),
	).rejects.toThrow();
});
test("the real host refuses model dispatch without authorization before posting", async () => {
	const previous = process.env.FLOW_EVAL_AUTHORIZATION;
	delete process.env.FLOW_EVAL_AUTHORIZATION;
	try {
		const host = Reflect.construct(EvalHost, ["unused", "unused"]) as EvalHost;
		await expect(
			host.runCommand("session", "flow-auto", "task", "fake/model"),
		).rejects.toThrow("FLOW_EVAL_AUTHORIZATION");
		await expect(
			host.runPrompt("session", "task", "fake/model"),
		).rejects.toThrow("FLOW_EVAL_AUTHORIZATION");
		Reflect.set(host, "createSession", async () => "fake");
		Reflect.set(host, "deleteSession", async () => {});
		Reflect.set(host, "post", async () => {
			throw new Error("MODEL DISPATCHED");
		});
		expect(await host.probeModel("fake/model")).toContain(
			"FLOW_EVAL_AUTHORIZATION",
		);
	} finally {
		if (previous !== undefined) process.env.FLOW_EVAL_AUTHORIZATION = previous;
	}
});

test("the eval CLI refuses an unfunded campaign before host preparation", async () => {
	const environment = { ...process.env };
	delete environment.FLOW_EVAL_AUTHORIZATION;
	const result = await new Promise<{ code: number; stderr: string }>(
		(resolve) => {
			const child = spawn(
				"bun",
				["run", "evals/run.ts", "--model", "fake/model"],
				{
					cwd: process.cwd(),
					env: environment,
					stdio: ["ignore", "ignore", "pipe"],
				},
			);
			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += String(chunk);
			});
			child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
		},
	);
	expect(result.code).toBe(2);
	expect(result.stderr).toContain("FLOW_EVAL_AUTHORIZATION");
});
