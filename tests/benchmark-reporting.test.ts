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
			"order-summary-report": {
				"src/orders.ts":
					"export type OrderLine = { id: string; unitCents: number; quantity: number };\nexport function orderTotal(line: OrderLine) { return line.unitCents * line.quantity; }\nexport function summarizeOrders(lines: readonly OrderLine[]) { const ids = new Set(lines.map((line) => line.id)); const totalCents = lines.reduce((sum, line) => sum + orderTotal(line), 0); return { averageOrderCents: ids.size ? Math.floor(totalCents / ids.size) : 0, totalCents, orderCount: ids.size, lineCount: lines.length }; }\n",
				"src/report.ts":
					'import { summarizeOrders, type OrderLine } from "./orders.js";\nexport function formatCents(cents: number) { return String(cents) + " cents"; }\nexport function renderOrderSummary(lines: readonly OrderLine[]) { const value = summarizeOrders(lines); return String(value.orderCount) + " orders / " + String(value.totalCents) + " cents"; }\n',
				"src/index.ts":
					'export { orderTotal, summarizeOrders, type OrderLine } from "./orders.js";\nexport { formatCents, renderOrderSummary } from "./report.js";\n',
			},
			"markdown-link-report": {
				"src/markdown.ts":
					'export function markdownLines(markdown: string) { return markdown.split(/\\r?\\n/); }\nexport function summarizeLinks(markdown: string) { const byLine: Record<string, number> = {}; const urls = new Set<string>(); let links = 0; for (const [index, line] of markdownLines(markdown).entries()) { for (const match of line.matchAll(/\\[[^\\]]+\\]\\(([^)]+)\\)/g)) { links += 1; urls.add(match[1] ?? ""); byLine[String(index + 1)] = (byLine[String(index + 1)] ?? 0) + 1; } } return { byLine, uniqueUrls: urls.size, links }; }\n',
				"src/link-report.ts":
					'import { summarizeLinks } from "./markdown.js";\nexport function formatLinkCount(count: number) { return String(count) + " links"; }\nexport function renderLinkReport(markdown: string) { const value = summarizeLinks(markdown); return String(value.links) + " links across " + String(markdown.split(/\\r?\\n/).length) + " lines"; }\n',
				"src/index.ts":
					'export { markdownLines, summarizeLinks } from "./markdown.js";\nexport { formatLinkCount, renderLinkReport } from "./link-report.js";\n',
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

	test("accepts every declared known-good mutation boundary", () => {
		for (const benchmark of BENCHMARK_CASES) {
			expect(benchmark.oracle.schemaVersion).toBe(1);
			expect(benchmark.oracle.contamination.schemaVersion).toBe(1);
			expect(benchmark.oracle.contamination.public.length).toBeGreaterThan(0);
			expect(benchmark.oracle.contamination.withheld.length).toBeGreaterThan(0);
			const ids = benchmark.oracle.knownBadMutations.map(
				(mutation) => mutation.id,
			);
			expect(ids.length).toBeGreaterThanOrEqual(2);
			expect(new Set(ids).size).toBe(ids.length);
			for (const mutation of benchmark.oracle.knownBadMutations) {
				expect(mutation.id.length).toBeGreaterThan(0);
				expect(Object.keys(mutation.fileOverrides).length).toBeGreaterThan(0);
			}
		}
	});

	test("keeps evaluation labels and hidden oracle details out of prompts", () => {
		const forbidden =
			/\b(candidate|baseline|hidden|oracle|grader|evaluation)\b/i;
		for (const benchmark of BENCHMARK_CASES) {
			expect(benchmark.prompt).not.toMatch(forbidden);
		}
	});

	test("publishes every result field required by the executable graders", () => {
		const prompts = Object.fromEntries(
			BENCHMARK_CASES.map((benchmark) => [benchmark.id, benchmark.prompt]),
		);
		expect(prompts["order-summary-report"]).toContain(
			"{ lineCount, orderCount, totalCents, averageOrderCents }",
		);
		expect(prompts["markdown-link-report"]).toContain(
			"{ links, uniqueUrls, byLine }",
		);
		expect(prompts["markdown-link-report"]).toContain(
			"`uniqueUrls` is the numeric count of distinct URLs",
		);
		expect(prompts["markdown-link-report"]).toContain(
			"maps each 1-based line number to its link count",
		);
		expect(prompts["markdown-link-report"]).toContain(
			"`byLine` is a plain object with numeric link-count values",
		);
		expect(prompts["markdown-link-report"]).toContain(
			"omits lines with zero links",
		);
		expect(prompts["markdown-link-report"]).toContain(
			"`lineCount` is the total number of lines from `markdownLines(markdown)`, including lines with zero links",
		);
	});

	test("rejects counting only non-empty Markdown lines in the renderer", async () => {
		const benchmark = BENCHMARK_CASES.find(
			(candidate) => candidate.id === "markdown-link-report",
		);
		if (!benchmark) throw new Error("Missing markdown-link-report benchmark.");
		const project = await mkdtemp(join(tmpdir(), "flow-benchmark-lines-"));
		try {
			const files = {
				...benchmark.files,
				"src/markdown.ts":
					'export function markdownLines(markdown: string) { return markdown.split(/\\r?\\n/); }\nexport function summarizeLinks(markdown: string) { const byLine: Record<string, number> = {}; const urls = new Set<string>(); let links = 0; for (const [index, line] of markdownLines(markdown).entries()) { for (const match of line.matchAll(/\\[[^\\]]+\\]\\(([^)]+)\\)/g)) { links += 1; urls.add(match[1] ?? ""); byLine[String(index + 1)] = (byLine[String(index + 1)] ?? 0) + 1; } } return { links, uniqueUrls: urls.size, byLine }; }\n',
				"src/link-report.ts":
					'import { markdownLines, summarizeLinks } from "./markdown.js"; export function formatLinkCount(count: number) { return String(count) + " links"; } export function renderLinkReport(markdown: string) { return String(summarizeLinks(markdown).links) + " links across " + String(markdownLines(markdown).filter((line) => line.length > 0).length) + " lines"; }\n',
				"src/index.ts":
					'export { markdownLines, summarizeLinks } from "./markdown.js";\nexport { formatLinkCount, renderLinkReport } from "./link-report.js";\n',
			};
			for (const [relative, contents] of Object.entries(files)) {
				const target = join(project, relative);
				await mkdir(join(target, ".."), { recursive: true });
				await writeFile(target, contents, "utf8");
			}
			expect(await benchmark.grade(project)).toMatchObject({ passed: false });
		} finally {
			await rm(project, { recursive: true, force: true });
		}
	});

	test("rejects every declared known-bad mutation", async () => {
		for (const benchmark of BENCHMARK_CASES) {
			for (const mutation of benchmark.oracle.knownBadMutations) {
				const project = await mkdtemp(
					join(tmpdir(), "flow-benchmark-mutation-"),
				);
				try {
					for (const [relative, contents] of Object.entries({
						...benchmark.files,
						...mutation.fileOverrides,
					})) {
						const target = join(project, relative);
						await mkdir(join(target, ".."), { recursive: true });
						await writeFile(target, contents, "utf8");
					}
					expect(await benchmark.grade(project)).toMatchObject({
						passed: false,
					});
				} finally {
					await rm(project, { recursive: true, force: true });
				}
			}
		}
	});
});
