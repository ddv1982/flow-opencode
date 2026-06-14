import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const scriptPath = join(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"architecture-metrics.mjs",
);

function runMetrics(...args: string[]) {
	return Bun.spawn({
		cmd: ["node", scriptPath, ...args],
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("architecture metrics script", () => {
	test("reports source owners and the canonical Flow surface", async () => {
		const process = runMetrics();

		expect(await process.exited).toBe(0);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("# Flow architecture metrics");
		expect(stdout).toContain("| runtime |");
		expect(stdout).toContain(
			"Commands: 5 (flow-auto, flow-plan, flow-review, flow-run, flow-status)",
		);
		expect(stdout).toContain("Agents: 1 (flow-reviewer)");
		expect(stdout).toContain("Tools: 8 (");
		expect(stdout).toContain("Architecture seam violations: 0");
	});

	test("can emit machine-readable JSON", async () => {
		const process = runMetrics("--json");

		expect(await process.exited).toBe(0);
		const metrics = JSON.parse(await new Response(process.stdout).text());
		expect(metrics.surface.commands).toBe(5);
		expect(metrics.surface.agents).toBe(1);
		expect(metrics.surface.tools).toBe(8);
		expect(metrics.seams.count).toBe(0);
		expect(metrics.source.byOwner.runtime.files).toBeGreaterThan(0);
	});
});
