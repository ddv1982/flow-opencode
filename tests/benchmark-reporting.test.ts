import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BenchmarkResult,
	seededShuffle,
	summarizeBenchmark,
} from "../evals/benchmark.js";
import { BENCHMARK_CASES } from "../evals/benchmarks.js";

function result(
	mode: BenchmarkResult["mode"],
	overrides: Partial<BenchmarkResult> = {},
): BenchmarkResult {
	return {
		case: "case",
		model: "provider/model",
		attempt: 1,
		mode,
		passed: true,
		claimedComplete: true,
		falseCompletion: false,
		issues: [],
		tokens: { input: 10, output: 4, reasoning: 2, cacheRead: 1, cacheWrite: 0 },
		costUsd: 0.25,
		assistantMessages: 2,
		durationMs: 1_000,
		finalText: "",
		hostError: null,
		...overrides,
	};
}

describe("paired benchmark ordering", () => {
	test("reproduces the same ordering from the same seed", () => {
		const values = ["a", "b", "c", "d", "e", "f"];
		expect(seededShuffle(values, "release-7.2")).toEqual(
			seededShuffle(values, "release-7.2"),
		);
		expect(values).toEqual(["a", "b", "c", "d", "e", "f"]);
	});

	test("uses the seed and preserves every job", () => {
		const values = Array.from({ length: 20 }, (_, index) => index);
		const first = seededShuffle(values, "first");
		const second = seededShuffle(values, "second");
		expect(first).not.toEqual(second);
		expect([...first].sort((left, right) => left - right)).toEqual(values);
		expect([...second].sort((left, right) => left - right)).toEqual(values);
	});
});

describe("paired benchmark summary", () => {
	test("reports correctness, false completion, and Flow-minus-control costs", () => {
		const summary = summarizeBenchmark([
			result("flow", { assistantMessages: 4, durationMs: 3_000 }),
			result("flow", {
				passed: false,
				claimedComplete: true,
				falseCompletion: true,
				assistantMessages: 6,
				durationMs: 5_000,
			}),
			result("ordinary", { assistantMessages: 2, durationMs: 1_000 }),
			result("ordinary", { assistantMessages: 2, durationMs: 1_000 }),
		]);

		expect(summary.byMode.flow).toMatchObject({
			attempts: 2,
			scored: 2,
			passed: 1,
			correctnessRate: 0.5,
			completionClaims: 2,
			falseCompletions: 1,
			falseCompletionRate: 0.5,
			assistantMessages: 10,
			durationMs: 8_000,
		});
		expect(summary.byMode.ordinary).toMatchObject({
			correctnessRate: 1,
			falseCompletionRate: 0,
		});
		expect(summary.delta).toEqual({
			correctnessRate: -0.5,
			falseCompletionRate: 0.5,
			assistantMessagesPerAttempt: 3,
			durationMsPerAttempt: 3_000,
			outputTokensPerAttempt: 0,
			costUsdPerAttempt: 0,
		});
	});

	test("excludes environment failures and aborts from rates", () => {
		const summary = summarizeBenchmark([
			result("flow", { environment: true, error: "host failed" }),
			result("flow", { error: "timed out" }),
			result("ordinary", {
				passed: false,
				claimedComplete: false,
				falseCompletion: false,
			}),
		]);

		expect(summary.byMode.flow).toMatchObject({
			attempts: 2,
			scored: 0,
			aborted: 1,
			environment: 1,
			correctnessRate: null,
		});
		expect(summary.byMode.ordinary).toMatchObject({
			scored: 1,
			correctnessRate: 0,
			completionClaims: 0,
			falseCompletionRate: null,
		});
		expect(summary.delta.correctnessRate).toBeNull();
	});
});

describe("hidden benchmark graders", () => {
	test("reject the visible fixtures before any implementation", async () => {
		for (const benchmark of BENCHMARK_CASES) {
			const project = await mkdtemp(join(tmpdir(), "flow-benchmark-grade-"));
			try {
				for (const [relative, contents] of Object.entries(benchmark.files)) {
					const target = join(project, relative);
					await mkdir(join(target, ".."), { recursive: true });
					await writeFile(target, contents, "utf8");
				}
				expect((await benchmark.grade(project)).passed).toBe(false);
			} finally {
				await rm(project, { recursive: true, force: true });
			}
		}
	});

	test("accept known implementations for every case", async () => {
		const implementations: Record<string, Record<string, string>> = {
			"farewell-export": {
				"src/greet.ts":
					'export function greet(name: string) { return "Hello, " + name + "!"; }\nexport function farewell(name: string) { return "Goodbye, " + name + "!"; }\n',
				"src/index.ts": 'export { greet, farewell } from "./greet.js";\n',
			},
			"punctuated-slug-path": {
				"src/slug.ts":
					'export function slug(title: string) { return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }\nexport function slugPath(dir: string, title: string) { return dir + "/" + slug(title) + ".md"; }\n',
			},
			"preserve-existing-api": {
				"src/headers.ts":
					'export function headerValue(line: string) { return line.split(":")[1]?.trim() ?? ""; }\nexport function parseHeader(line: string) { const at = line.indexOf(":"); if (at < 0) throw new Error("malformed"); return { name: line.slice(0, at).trim().toLowerCase(), value: line.slice(at + 1).trim() }; }\n',
			},
		};

		for (const benchmark of BENCHMARK_CASES) {
			const project = await mkdtemp(join(tmpdir(), "flow-benchmark-grade-"));
			try {
				const files = { ...benchmark.files, ...implementations[benchmark.id] };
				for (const [relative, contents] of Object.entries(files)) {
					const target = join(project, relative);
					await mkdir(join(target, ".."), { recursive: true });
					await writeFile(target, contents, "utf8");
				}
				expect(await benchmark.grade(project)).toEqual({
					passed: true,
					issues: [],
				});
			} finally {
				await rm(project, { recursive: true, force: true });
			}
		}
	});
});
