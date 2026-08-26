import { describe, expect, test } from "bun:test";
import { delimiter, dirname } from "node:path";
import {
	bunToolchainFor,
	pinnedBunVersion,
	runPinnedBunSync,
} from "../evals/bun-toolchain.js";

describe("pinned Bun toolchain", () => {
	test("parses one exact Bun version", () => {
		expect(pinnedBunVersion("bun@1.3.14")).toBe("1.3.14");
		for (const value of [
			undefined,
			"npm@11.0.0",
			"bun@latest",
			"bun@^1.3.14",
			"bun@1.3",
		]) {
			expect(() => pinnedBunVersion(value)).toThrow(/exact bun version/i);
		}
	});

	test("rejects a different runtime before returning a capability", () => {
		expect(() =>
			bunToolchainFor({
				packageManager: "bun@1.3.14",
				actualVersion: "1.3.5",
				executable: "/tools/bun",
				environment: { PATH: "/usr/bin" },
			}),
		).toThrow(/require bun@1\.3\.14.*bun@1\.3\.5/i);
		expect(() =>
			bunToolchainFor({
				packageManager: "bun@1.3.14",
				actualVersion: "1.3.14",
				executable: "/tools/bun-1.3.14",
				environment: { PATH: "/usr/bin" },
			}),
		).toThrow(/executable named bun/i);
	});

	test("pins nested package scripts to the verified executable", () => {
		const toolchain = bunToolchainFor({
			packageManager: `bun@${Bun.version}`,
			actualVersion: Bun.version,
			executable: process.execPath,
			environment: { PATH: "/usr/bin" },
		});
		expect(toolchain.executable).toBe(process.execPath);
		expect(toolchain.environment.PATH?.split(delimiter)[0]).toBe(
			dirname(process.execPath),
		);
		const result = runPinnedBunSync(
			toolchain,
			["-e", "process.stdout.write(Bun.version)"],
			{ cwd: new URL("..", import.meta.url).pathname },
		);
		expect(result.status).toBe(0);
		expect(result.stdout).toBe(Bun.version);
	});

	test("normalizes duplicate path keys before launching children", () => {
		const toolchain = bunToolchainFor({
			packageManager: `bun@${Bun.version}`,
			actualVersion: Bun.version,
			executable: process.execPath,
			environment: { PATH: "/canonical", Path: "/ambiguous" },
		});
		expect(toolchain.environment.Path).toBeUndefined();
		expect(toolchain.environment.PATH?.split(delimiter)).toEqual([
			dirname(process.execPath),
			"/canonical",
		]);
	});

	test("release eval refuses the wrong Bun before host preflight", async () => {
		if (Bun.version === "1.3.14") return;
		const child = Bun.spawn(
			[
				process.execPath,
				"run",
				"evals/run.ts",
				"--release",
				"--model",
				"xai/not-a-real-model",
				"--model",
				"openai/not-a-real-model",
			],
			{
				cwd: new URL("..", import.meta.url).pathname,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("require bun@1.3.14");
		expect(stdout).not.toContain("preflight");
	});
});
