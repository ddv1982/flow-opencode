import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	BenchmarkCase,
	BenchmarkGrade,
	BenchmarkOracleMetadata,
} from "./benchmark.js";

const BASE_FIXTURE: Record<string, string> = {
	"package.json": `${JSON.stringify(
		{
			name: "flow-benchmark-fixture",
			private: true,
			type: "module",
			scripts: { test: "bun test" },
		},
		null,
		2,
	)}\n`,
};

function oracle(
	publicNotes: readonly string[],
	withheldNotes: readonly string[],
	knownBadMutations: BenchmarkOracleMetadata["knownBadMutations"],
): BenchmarkOracleMetadata {
	return {
		schemaVersion: 1,
		contamination: {
			schemaVersion: 1,
			public: publicNotes,
			withheld: withheldNotes,
		},
		knownBadMutations,
	};
}

function hiddenBunCheck(project: string, source: string): BenchmarkGrade {
	const result = spawnSync("bun", ["-e", source], {
		cwd: project,
		encoding: "utf8",
		timeout: 30_000,
	});
	if (result.status === 0) return { passed: true, issues: [] };
	const detail = `${result.stdout}\n${result.stderr}`.trim();
	return {
		passed: false,
		issues: [
			result.error
				? result.error.message
				: detail.split("\n").slice(-3).join(" ") ||
					"hidden check exited non-zero",
		],
	};
}

/** Same implementable tasks are presented to both benchmark arms. */
export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
	{
		id: "farewell-export",
		description:
			"adds and publicly exports a small function with exact behavior",
		files: {
			...BASE_FIXTURE,
			"src/greet.ts":
				'export function greet(name: string): string {\n\treturn "Hello, " + name + "!";\n}\n',
			"src/index.ts": 'export { greet } from "./greet.js";\n',
			"src/greet.test.ts":
				'import { expect, test } from "bun:test";\nimport { greet } from "./greet.js";\n\ntest("greets", () => expect(greet("Ada")).toBe("Hello, Ada!"));\n',
		},
		prompt:
			"Add an exported `farewell(name)` function that returns exactly `Goodbye, <name>!`, export it from src/index.ts, and add an appropriate focused test. Implement and validate the change end to end; you have my approval.",
		oracle: oracle(
			[
				"The starter files, export name, and exact farewell examples are public.",
			],
			["The executable boundary checks and mutation cases are withheld."],
			[
				{
					id: "wrong-return-value",
					fileOverrides: {
						"src/greet.ts":
							'export function greet(name: string) { return "Hello, " + name + "!"; }\nexport function farewell(name: string) { return "Hello, " + name + "!"; }\n',
						"src/index.ts": 'export { greet, farewell } from "./greet.js";\n',
					},
				},
				{
					id: "missing-public-export",
					fileOverrides: {
						"src/index.ts": 'export { greet } from "./greet.js";\n',
					},
				},
			],
		),
		async grade(project) {
			return hiddenBunCheck(
				project,
				'import { farewell } from "./src/index.ts"; if (farewell("Ada") !== "Goodbye, Ada!" || farewell("") !== "Goodbye, !") process.exit(1);',
			);
		},
	},
	{
		id: "punctuated-slug-path",
		description:
			"repairs a green adjacent defect and handles punctuation in a hidden case",
		files: {
			...BASE_FIXTURE,
			"src/slug.ts":
				'export function slug(title: string): string {\n\treturn title.toLowerCase().split(" ").join("-");\n}\n',
			"src/slug.test.ts":
				'import { expect, test } from "bun:test";\nimport { slug } from "./slug.js";\n\ntest("joins words", () => expect(slug("Hello World")).toBe("hello-world"));\n',
		},
		prompt:
			"Add an exported `slugPath(dir, title)` to src/slug.ts that returns `<dir>/<slug of title>.md`. A title carrying punctuation, such as `Q1: Report/Draft`, must produce exactly one path separator and no Windows-illegal filename character. You may repair the existing slug implementation. Add focused tests, implement, and validate end to end; you have my approval.",
		oracle: oracle(
			[
				"The starter slug helper, public function name, and punctuation example are public.",
			],
			["The executable path-shape assertions and mutation cases are withheld."],
			[
				{
					id: "preserves-punctuation",
					fileOverrides: {
						"src/slug.ts":
							'export function slug(title: string) { return title.toLowerCase().split(" ").join("-"); }\nexport function slugPath(dir: string, title: string) { return dir + "/" + slug(title) + ".md"; }\n',
					},
				},
				{
					id: "duplicates-separator",
					fileOverrides: {
						"src/slug.ts":
							'export function slug(title: string) { return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }\nexport function slugPath(dir: string, title: string) { return dir + "//" + slug(title) + ".md"; }\n',
					},
				},
			],
		),
		async grade(project) {
			return hiddenBunCheck(
				project,
				'import { slugPath } from "./src/slug.ts"; const value = slugPath("docs", "Q1: Report/Draft"); if (value !== "docs/q1-report-draft.md" || (value.match(/\\//g) ?? []).length !== 1 || /[<>:"\\\\|?*]/.test(value.slice(5))) process.exit(1);',
			);
		},
	},
	{
		id: "preserve-existing-api",
		description:
			"extends a parser while preserving its existing public behavior",
		files: {
			...BASE_FIXTURE,
			"src/headers.ts":
				'export function headerValue(line: string): string {\n\treturn line.split(":")[1]?.trim() ?? "";\n}\n',
			"src/headers.test.ts":
				'import { expect, test } from "bun:test";\nimport { headerValue } from "./headers.js";\n\ntest("reads a value", () => expect(headerValue("Accept: text/plain")).toBe("text/plain"));\n',
		},
		prompt:
			"Add an exported `parseHeader(line)` to src/headers.ts returning `{ name, value }`. Header names must be lowercase, surrounding whitespace trimmed, values may contain additional colons, malformed lines with no colon must throw, and the existing `headerValue` behavior must remain compatible. Add focused tests, implement, and validate end to end; you have my approval.",
		oracle: oracle(
			[
				"The existing headerValue behavior and requested parseHeader contract are public.",
			],
			[
				"The executable colon, casing, and malformed-input checks are withheld.",
			],
			[
				{
					id: "keeps-header-case",
					fileOverrides: {
						"src/headers.ts":
							'export function headerValue(line: string) { return line.split(":")[1]?.trim() ?? ""; }\nexport function parseHeader(line: string) { const at = line.indexOf(":"); if (at < 0) throw new Error("malformed"); return { name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }; }\n',
					},
				},
				{
					id: "drops-extra-colons",
					fileOverrides: {
						"src/headers.ts":
							'export function headerValue(line: string) { return line.split(":")[1]?.trim() ?? ""; }\nexport function parseHeader(line: string) { const parts = line.split(":"); if (parts.length < 2) throw new Error("malformed"); return { name: parts[0].trim().toLowerCase(), value: parts[1].trim() }; }\n',
					},
				},
			],
		),
		async grade(project) {
			const source = await readFile(
				join(project, "src", "headers.ts"),
				"utf8",
			).catch(() => "");
			if (!source.includes("parseHeader"))
				return { passed: false, issues: ["parseHeader was not implemented"] };
			return hiddenBunCheck(
				project,
				'import { headerValue, parseHeader } from "./src/headers.ts"; const parsed = parseHeader(" X-Trace : one:two "); if (parsed.name !== "x-trace" || parsed.value !== "one:two" || headerValue("Accept: text/plain") !== "text/plain") process.exit(1); let threw = false; try { parseHeader("invalid") } catch { threw = true } if (!threw) process.exit(1);',
			);
		},
	},
	{
		id: "order-summary-report",
		description:
			"adds a multi-file order summary while preserving an existing money formatter",
		files: {
			...BASE_FIXTURE,
			"src/orders.ts":
				"export type OrderLine = { id: string; unitCents: number; quantity: number };\nexport function orderTotal(line: OrderLine): number { return line.unitCents * line.quantity; }\n",
			"src/report.ts":
				'export function formatCents(cents: number): string { return String(cents) + " cents"; }\n',
			"src/index.ts":
				'export { orderTotal, type OrderLine } from "./orders.js";\nexport { formatCents } from "./report.js";\n',
		},
		prompt:
			"Add `summarizeOrders(lines)` to src/orders.ts and `renderOrderSummary(lines)` to src/report.ts, exporting both from src/index.ts. Summaries must count input lines, count distinct order ids, total unitCents multiplied by quantity, and floor the average total per order; an empty list returns zeros. Render the summary as `<orderCount> orders / <totalCents> cents`. Preserve orderTotal and formatCents, add focused tests, and validate end to end; you have my approval.",
		oracle: oracle(
			[
				"The starter modules, public function names, arithmetic rules, and output format are public.",
			],
			[
				"The executable duplicate-id, empty-input, and rounding checks are withheld.",
			],
			[
				{
					id: "counts-lines-as-orders",
					fileOverrides: {
						"src/orders.ts":
							"export type OrderLine = { id: string; unitCents: number; quantity: number };\nexport function orderTotal(line: OrderLine) { return line.unitCents * line.quantity; }\nexport function summarizeOrders(lines: readonly OrderLine[]) { const totalCents = lines.reduce((sum, line) => sum + orderTotal(line), 0); return { lineCount: lines.length, orderCount: lines.length, totalCents, averageOrderCents: lines.length ? Math.floor(totalCents / lines.length) : 0 }; }\n",
						"src/report.ts":
							'import { summarizeOrders, type OrderLine } from "./orders.js"; export function formatCents(cents: number) { return String(cents) + " cents"; } export function renderOrderSummary(lines: readonly OrderLine[]) { const value = summarizeOrders(lines); return String(value.orderCount) + " orders / " + String(value.totalCents) + " cents"; }\n',
						"src/index.ts":
							'export { orderTotal, summarizeOrders, type OrderLine } from "./orders.js";\nexport { formatCents, renderOrderSummary } from "./report.js";\n',
					},
				},
				{
					id: "rounds-average-up",
					fileOverrides: {
						"src/orders.ts":
							"export type OrderLine = { id: string; unitCents: number; quantity: number };\nexport function orderTotal(line: OrderLine) { return line.unitCents * line.quantity; }\nexport function summarizeOrders(lines: readonly OrderLine[]) { const totalCents = lines.reduce((sum, line) => sum + orderTotal(line), 0); const ids = new Set(lines.map((line) => line.id)); return { lineCount: lines.length, orderCount: ids.size, totalCents, averageOrderCents: Math.ceil(totalCents / ids.size) }; }\n",
						"src/report.ts":
							'import { summarizeOrders, type OrderLine } from "./orders.js"; export function formatCents(cents: number) { return String(cents) + " cents"; } export function renderOrderSummary(lines: readonly OrderLine[]) { const value = summarizeOrders(lines); return String(value.orderCount) + " orders / " + String(value.totalCents) + " cents"; }\n',
						"src/index.ts":
							'export { orderTotal, summarizeOrders, type OrderLine } from "./orders.js";\nexport { formatCents, renderOrderSummary } from "./report.js";\n',
					},
				},
				{
					id: "breaks-format-cents",
					fileOverrides: {
						"src/orders.ts":
							"export type OrderLine = { id: string; unitCents: number; quantity: number };\nexport function orderTotal(line: OrderLine) { return line.unitCents * line.quantity; }\nexport function summarizeOrders(lines: readonly OrderLine[]) { const ids = new Set(lines.map((line) => line.id)); const totalCents = lines.reduce((sum, line) => sum + orderTotal(line), 0); return { lineCount: lines.length, orderCount: ids.size, totalCents, averageOrderCents: ids.size ? Math.floor(totalCents / ids.size) : 0 }; }\n",
						"src/report.ts":
							'import { summarizeOrders, type OrderLine } from "./orders.js"; export function formatCents(_cents: number) { return "BROKEN"; } export function renderOrderSummary(lines: readonly OrderLine[]) { const value = summarizeOrders(lines); return String(value.orderCount) + " orders / " + String(value.totalCents) + " cents"; }\n',
						"src/index.ts":
							'export { orderTotal, summarizeOrders, type OrderLine } from "./orders.js";\nexport { formatCents, renderOrderSummary } from "./report.js";\n',
					},
				},
			],
		),
		async grade(project) {
			return hiddenBunCheck(
				project,
				'import { formatCents, orderTotal, renderOrderSummary, summarizeOrders } from "./src/index.ts"; const lines = [{ id: "A", unitCents: 125, quantity: 2 }, { id: "A", unitCents: 50, quantity: 1 }, { id: "B", unitCents: 201, quantity: 1 }]; const value = summarizeOrders(lines); if (orderTotal(lines[0]) !== 250 || formatCents(501) !== "501 cents" || JSON.stringify(value) !== JSON.stringify({ lineCount: 3, orderCount: 2, totalCents: 501, averageOrderCents: 250 }) || renderOrderSummary(lines) !== "2 orders / 501 cents") process.exit(1); if (JSON.stringify(summarizeOrders([])) !== JSON.stringify({ lineCount: 0, orderCount: 0, totalCents: 0, averageOrderCents: 0 })) process.exit(1);',
			);
		},
	},
	{
		id: "markdown-link-report",
		description:
			"adds a multi-file Markdown link index with stable line-level reporting",
		files: {
			...BASE_FIXTURE,
			"src/markdown.ts":
				"export function markdownLines(markdown: string): readonly string[] { return markdown.split(/\\r?\\n/); }\n",
			"src/link-report.ts":
				'export function formatLinkCount(count: number): string { return String(count) + " links"; }\n',
			"src/index.ts":
				'export { markdownLines } from "./markdown.js";\nexport { formatLinkCount } from "./link-report.js";\n',
		},
		prompt:
			"Add `summarizeLinks(markdown)` to src/markdown.ts and `renderLinkReport(markdown)` to src/link-report.ts, exporting both from src/index.ts. Count Markdown inline links of the form `[label](url)`, report total links, distinct URL strings, and a `byLine` object keyed by 1-based line number. Render `<links> links across <lineCount> lines`. Preserve markdownLines and formatLinkCount, add focused tests, and validate end to end; you have my approval.",
		oracle: oracle(
			[
				"The starter modules, inline-link syntax, public function names, and line numbering are public.",
			],
			[
				"The executable duplicate-URL, line-map, and empty-document checks are withheld.",
			],
			[
				{
					id: "counts-duplicate-as-unique",
					fileOverrides: {
						"src/markdown.ts":
							'export function markdownLines(markdown: string) { return markdown.split(/\\r?\\n/); }\nexport function summarizeLinks(markdown: string) { const matches = [...markdown.matchAll(/\\[[^\\]]+\\]\\(([^)]+)\\)/g)]; const byLine: Record<string, number> = {}; for (const _match of matches) byLine["1"] = (byLine["1"] ?? 0) + 1; return { links: matches.length, uniqueUrls: matches.length, byLine }; }\n',
						"src/link-report.ts":
							'import { summarizeLinks } from "./markdown.js"; export function formatLinkCount(count: number) { return String(count) + " links"; } export function renderLinkReport(markdown: string) { const value = summarizeLinks(markdown); return String(value.links) + " links across " + String(markdown.split(/\\r?\\n/).length) + " lines"; }\n',
						"src/index.ts":
							'export { markdownLines, summarizeLinks } from "./markdown.js";\nexport { formatLinkCount, renderLinkReport } from "./link-report.js";\n',
					},
				},
				{
					id: "uses-zero-based-lines",
					fileOverrides: {
						"src/markdown.ts":
							"export function markdownLines(markdown: string) { return markdown.split(/\\r?\\n/); }\nexport function summarizeLinks(markdown: string) { const byLine: Record<string, number> = {}; for (const [index, line] of markdownLines(markdown).entries()) { const count = [...line.matchAll(/\\[[^\\]]+\\]\\(([^)]+)\\)/g)].length; if (count) byLine[String(index)] = count; } return { links: Object.values(byLine).reduce((sum, count) => sum + count, 0), uniqueUrls: 2, byLine }; }\n",
						"src/link-report.ts":
							'import { summarizeLinks } from "./markdown.js"; export function formatLinkCount(count: number) { return String(count) + " links"; } export function renderLinkReport(markdown: string) { const value = summarizeLinks(markdown); return String(value.links) + " links across " + String(markdown.split(/\\r?\\n/).length) + " lines"; }\n',
						"src/index.ts":
							'export { markdownLines, summarizeLinks } from "./markdown.js";\nexport { formatLinkCount, renderLinkReport } from "./link-report.js";\n',
					},
				},
				{
					id: "breaks-format-link-count",
					fileOverrides: {
						"src/markdown.ts":
							'export function markdownLines(markdown: string) { return markdown.split(/\\r?\\n/); }\nexport function summarizeLinks(markdown: string) { const byLine: Record<string, number> = {}; const urls = new Set<string>(); let links = 0; for (const [index, line] of markdownLines(markdown).entries()) { for (const match of line.matchAll(/\\[[^\\]]+\\]\\(([^)]+)\\)/g)) { links += 1; urls.add(match[1] ?? ""); byLine[String(index + 1)] = (byLine[String(index + 1)] ?? 0) + 1; } } return { links, uniqueUrls: urls.size, byLine }; }\n',
						"src/link-report.ts":
							'import { summarizeLinks } from "./markdown.js"; export function formatLinkCount(_count: number) { return "BROKEN"; } export function renderLinkReport(markdown: string) { const value = summarizeLinks(markdown); return String(value.links) + " links across " + String(markdown.split(/\\r?\\n/).length) + " lines"; }\n',
						"src/index.ts":
							'export { markdownLines, summarizeLinks } from "./markdown.js";\nexport { formatLinkCount, renderLinkReport } from "./link-report.js";\n',
					},
				},
			],
		),
		async grade(project) {
			return hiddenBunCheck(
				project,
				'import { formatLinkCount, markdownLines, renderLinkReport, summarizeLinks } from "./src/index.ts"; const markdown = "# Guide\\n[Home](/home) and [Docs](/docs)\\n[Home](/home)\\nplain"; const value = summarizeLinks(markdown); if (JSON.stringify(markdownLines(markdown)) !== JSON.stringify(["# Guide", "[Home](/home) and [Docs](/docs)", "[Home](/home)", "plain"]) || formatLinkCount(3) !== "3 links" || JSON.stringify(value) !== JSON.stringify({ links: 3, uniqueUrls: 2, byLine: { "2": 2, "3": 1 } }) || renderLinkReport(markdown) !== "3 links across 4 lines") process.exit(1); if (JSON.stringify(summarizeLinks("")) !== JSON.stringify({ links: 0, uniqueUrls: 0, byLine: {} })) process.exit(1);',
			);
		},
	},
];
