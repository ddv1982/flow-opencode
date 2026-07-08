import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function runMonitor(args: string[], runs?: unknown[]) {
	return spawnSync("node", ["scripts/release-monitor.mjs", ...args], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: {
			...process.env,
			...(runs ? { FLOW_RELEASE_MONITOR_RUNS_JSON: JSON.stringify(runs) } : {}),
		},
	});
}

function workflowRun(
	workflowName: string,
	status: string,
	conclusion: string | null,
) {
	return {
		workflowName,
		status,
		conclusion,
		headSha: COMMIT,
		event: "push",
		headBranch: "main",
		createdAt: "2026-07-08T10:00:00Z",
		updatedAt: "2026-07-08T10:05:00Z",
		url: `https://github.com/ddv1982/flow-opencode/actions/runs/${workflowName}`,
	};
}

describe("release monitor", () => {
	test("prints help", () => {
		const result = runMonitor(["--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("release-monitor.mjs");
		expect(result.stdout).toContain("--commit");
	});

	test("succeeds when expected CI and release workflows passed", () => {
		const result = runMonitor(
			["--commit", COMMIT, "--tag", "v1.2.3", "--once", "--json"],
			[
				workflowRun("CI", "completed", "success"),
				workflowRun("Release", "completed", "success"),
			],
		);
		expect(result.status).toBe(0);
		const summary = JSON.parse(result.stdout);
		expect(summary.success).toBe(true);
		expect(summary.expectedWorkflows).toEqual(["CI", "Release"]);
	});

	test("fails when the tag release workflow has not appeared", () => {
		const result = runMonitor(
			["--commit", COMMIT, "--tag", "v1.2.3", "--once", "--json"],
			[workflowRun("CI", "completed", "success")],
		);
		expect(result.status).toBe(1);
		const summary = JSON.parse(result.stdout);
		expect(summary.success).toBe(false);
		expect(summary.missing).toEqual(["Release"]);
	});

	test("fails fast on any failed observed workflow for the commit", () => {
		const result = runMonitor(
			["--commit", COMMIT, "--expect", "CI", "--once", "--json"],
			[
				workflowRun("CI", "completed", "success"),
				workflowRun("Release", "completed", "failure"),
			],
		);
		expect(result.status).toBe(1);
		const summary = JSON.parse(result.stdout);
		expect(
			summary.failed.map((run: { workflowName: string }) => run.workflowName),
		).toContain("Release");
	});
});
