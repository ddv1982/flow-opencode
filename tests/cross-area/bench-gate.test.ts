import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scriptPath = path.resolve(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"bench-gate.mjs",
);

function makeTempDir(): string {
	return mkdtempSync(path.join(tmpdir(), "flow-bench-gate-"));
}

describe("cross-area bench gate", () => {
	test("passes with explained regressions and warm save within threshold", async () => {
		const directory = makeTempDir();

		try {
			const baselinePath = path.join(directory, "BASELINE.md");
			const resultsPath = path.join(directory, "RESULTS.md");

			writeFileSync(
				baselinePath,
				[
					"# Benchmark Baseline",
					"",
					"| Benchmark | Measurement |",
					"| --- | --- |",
					"| full saveSession cycle / 20-feature plan | 3.38 ms avg |",
					"| warm saveSession cycle | 820.00 µs avg |",
					"| markdown render / feature | 766.81 ns avg |",
					"",
				].join("\n"),
			);
			writeFileSync(
				resultsPath,
				[
					"# Benchmark Results",
					"",
					"| benchmark | baseline | after | delta% | notes |",
					"| --- | --- | --- | --- | --- |",
					"| full saveSession cycle / 20-feature plan | 3.38 ms avg | 3.87 ms avg (3.10 ms … 4.50 ms) | +14.50% | explained: M5 trades cold-save cost for warm-save savings. |",
					"| warm saveSession cycle | 820.00 µs avg | 820.00 µs avg (700.00 µs … 950.00 µs) | 0.00% | baseline captured from first warm-path incremental build. |",
					"| markdown render / feature | 766.81 ns avg | 790.00 ns avg (700.00 ns … 900.00 ns) | +3.02% | within threshold |",
					"",
				].join("\n"),
			);

			const process = Bun.spawn(
				["node", scriptPath, baselinePath, resultsPath],
				{
					stderr: "pipe",
					stdout: "pipe",
				},
			);

			expect(await process.exited).toBe(0);
			expect(await new Response(process.stdout).text()).toContain(
				"Bench gate passed",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("fails when an unexplained regression exceeds five percent", async () => {
		const directory = makeTempDir();

		try {
			const baselinePath = path.join(directory, "BASELINE.md");
			const resultsPath = path.join(directory, "RESULTS.md");

			writeFileSync(
				baselinePath,
				[
					"# Benchmark Baseline",
					"",
					"| Benchmark | Measurement |",
					"| --- | --- |",
					"| session save round-trip | 1.00 ms avg |",
					"| warm saveSession cycle | 900.00 µs avg |",
					"",
				].join("\n"),
			);
			writeFileSync(
				resultsPath,
				[
					"# Benchmark Results",
					"",
					"| benchmark | baseline | after | delta% | notes |",
					"| --- | --- | --- | --- | --- |",
					"| session save round-trip | 1.00 ms avg | 1.20 ms avg (1.10 ms … 1.30 ms) | +20.00% | regression without explanation |",
					"| warm saveSession cycle | 900.00 µs avg | 900.00 µs avg (850.00 µs … 980.00 µs) | 0.00% | baseline captured from first warm-path incremental build. |",
					"",
				].join("\n"),
			);

			const process = Bun.spawn(
				["node", scriptPath, baselinePath, resultsPath],
				{
					stderr: "pipe",
					stdout: "pipe",
				},
			);

			expect(await process.exited).toBe(1);
			expect(await new Response(process.stderr).text()).toContain(
				"session save round-trip regressed by 20.00%",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
