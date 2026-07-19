import { describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { FLOW_CORE_COMMANDS } from "../src/config-shared.js";
import { createTools } from "../src/platform/opencode/tools.js";

function section(markdown: string, heading: string): string {
	const start = markdown.indexOf(`## ${heading}`);
	if (start === -1) throw new Error(`Missing README section '${heading}'.`);
	const remainder = markdown.slice(start + heading.length + 3);
	const next = remainder.search(/^## /m);
	return next === -1 ? remainder : remainder.slice(0, next);
}

function firstColumnCodeValues(markdown: string): string[] {
	return [...markdown.matchAll(/^\| `([^`]+)` \|/gm)].map(
		(match) => match[1] ?? "",
	);
}

async function markdownFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map((entry) => {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) return markdownFiles(path);
				return Promise.resolve(entry.name.endsWith(".md") ? [path] : []);
			}),
		)
	).flat();
}

describe("maintained documentation contract", () => {
	test("keeps the README command, tool, and install inventories source-derived", async () => {
		const readme = await readFile("README.md", "utf8");
		const documentedCommands = firstColumnCodeValues(
			section(readme, "Commands"),
		)
			.map((value) => value.split(/\s+/, 1)[0]?.replace(/^\//, "") ?? "")
			.sort();
		expect(documentedCommands).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());

		const documentedTools = firstColumnCodeValues(
			section(readme, "Tools"),
		).sort();
		expect(documentedTools).toEqual(Object.keys(createTools({})).sort());

		const installedVersions = [
			...readme.matchAll(/opencode-plugin-flow@(\d+\.\d+\.\d+)/g),
		].map((match) => match[1]);
		expect(installedVersions.length).toBeGreaterThanOrEqual(2);
		expect(new Set(installedVersions)).toEqual(new Set([packageJson.version]));
	});

	test("points readers at maintained docs and labels generated history", async () => {
		const [readme, index, archivedWiki, historicalPlan] = await Promise.all([
			readFile("README.md", "utf8"),
			readFile("docs/index.md", "utf8"),
			readFile("droid-wiki/README.md", "utf8"),
			readFile("docs/plan/opencode-plugin-improvement-roadmap.md", "utf8"),
		]);
		expect(readme).toContain("[docs/index.md](docs/index.md)");
		expect(readme).not.toContain("flow-opencode/wiki");
		expect(index).toContain("maintained documentation source");
		expect(index).toMatch(/archived generated\s+snapshot/);
		expect(archivedWiki).toContain("not a publishing source");
		expect(historicalPlan).toContain(
			"Status: implemented / historical snapshot",
		);
	});

	test("keeps tracked relative Markdown links resolvable", async () => {
		const documents = [
			"README.md",
			"CHANGELOG.md",
			"CONTEXT.md",
			...(await markdownFiles("docs")),
			...(await markdownFiles("skills")),
			...(await markdownFiles("droid-wiki")),
		];
		const broken: string[] = [];
		for (const document of documents) {
			const markdown = await readFile(document, "utf8");
			for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
				const rawTarget = match[1]?.trim();
				if (!rawTarget || /^(?:[a-z]+:|#|\/)/i.test(rawTarget)) {
					continue;
				}
				const path = decodeURIComponent(
					rawTarget.replace(/^<|>$/g, "").split("#", 1)[0] ?? "",
				);
				if (!path) continue;
				try {
					await access(resolve(dirname(document), path));
				} catch {
					broken.push(`${document} -> ${rawTarget}`);
				}
			}
		}
		expect(broken).toEqual([]);
	});
});
