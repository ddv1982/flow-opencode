import { describe, expect, test } from "bun:test";
import {
	JEV_SCRIPT,
	REPLAY_SCRIPT,
	runEvalCheap,
} from "../evals/eval-cheap.js";
import packageJson from "../package.json" with { type: "json" };

describe("eval:cheap orchestration", () => {
	test("package.json exposes eval:cheap", () => {
		expect(packageJson.scripts["eval:cheap"]).toBe(
			"bun run evals/eval-cheap.ts",
		);
	});

	test("skips Jev without a key after replay passes", async () => {
		const scripts: string[] = [];
		const written: string[] = [];
		const report = await runEvalCheap({
			env: { PATH: "/usr/bin" },
			run: async (script) => {
				scripts.push(script);
				return { exitCode: 0, stdout: "replay-ok\n", stderr: "" };
			},
			write: (text) => {
				written.push(text);
			},
		});
		expect(scripts).toEqual([REPLAY_SCRIPT]);
		expect(report.jev).toEqual({ kind: "skipped", reason: "missing-key" });
		expect(report.exitCode).toBe(0);
		expect(written.join("")).toContain('"missing-key"');
	});

	test("skips Jev when the key is empty", async () => {
		const scripts: string[] = [];
		const report = await runEvalCheap({
			env: { TYPESAFE_API_KEY: "" },
			run: async (script) => {
				scripts.push(script);
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			write: () => {},
		});
		expect(scripts).toEqual([REPLAY_SCRIPT]);
		expect(report.jev).toEqual({ kind: "skipped", reason: "missing-key" });
		expect(report.exitCode).toBe(0);
	});

	test("runs Jev after replay when a key is set", async () => {
		const scripts: string[] = [];
		const report = await runEvalCheap({
			env: { TYPESAFE_API_KEY: "test-key" },
			run: async (script) => {
				scripts.push(script);
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			write: () => {},
		});
		expect(scripts).toEqual([REPLAY_SCRIPT, JEV_SCRIPT]);
		expect(report.jev).toEqual({ kind: "ran", exitCode: 0 });
		expect(report.exitCode).toBe(0);
	});

	test("does not run Jev when replay fails", async () => {
		const scripts: string[] = [];
		const report = await runEvalCheap({
			env: { TYPESAFE_API_KEY: "test-key" },
			run: async (script) => {
				scripts.push(script);
				return { exitCode: 7, stdout: "", stderr: "replay-broke\n" };
			},
			write: () => {},
		});
		expect(scripts).toEqual([REPLAY_SCRIPT]);
		expect(report.jev).toEqual({ kind: "skipped", reason: "replay-failed" });
		expect(report.exitCode).toBe(7);
	});

	test("propagates a keyed Jev failure", async () => {
		const report = await runEvalCheap({
			env: { TYPESAFE_API_KEY: "test-key" },
			run: async (script) => {
				if (script === JEV_SCRIPT)
					return { exitCode: 2, stdout: "", stderr: "" };
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			write: () => {},
		});
		expect(report.jev).toEqual({ kind: "ran", exitCode: 2 });
		expect(report.exitCode).toBe(2);
	});
});
