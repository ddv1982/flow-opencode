import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BenchmarkCase, BenchmarkGrade } from "./benchmark.js";

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
		async grade(project) {
			const source = await readFile(
				join(project, "src", "headers.ts"),
				"utf8",
			).catch(() => "");
			if (!source.includes("parseHeader")) {
				return { passed: false, issues: ["parseHeader was not implemented"] };
			}
			return hiddenBunCheck(
				project,
				'import { headerValue, parseHeader } from "./src/headers.ts"; const parsed = parseHeader(" X-Trace : one:two "); if (parsed.name !== "x-trace" || parsed.value !== "one:two" || headerValue("Accept: text/plain") !== "text/plain") process.exit(1); let threw = false; try { parseHeader("invalid") } catch { threw = true } if (!threw) process.exit(1);',
			);
		},
	},
];
