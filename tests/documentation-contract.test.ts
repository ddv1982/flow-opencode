import { describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { FLOW_CORE_AGENTS, FLOW_CORE_COMMANDS } from "../src/config-shared.js";
import FlowPlugin from "../src/index.js";

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

async function registeredToolNames(): Promise<string[]> {
	const hooks = await FlowPlugin({
		client: { app: { log() {} } },
		project: {},
		directory: process.cwd(),
		worktree: process.cwd(),
		experimental_workspace: { register() {} },
		serverUrl: new URL("http://localhost"),
		$: {},
	} as unknown as Parameters<typeof FlowPlugin>[0]);
	try {
		return Object.keys(hooks.tool ?? {}).sort();
	} finally {
		await hooks.dispose?.();
	}
}

describe("Flow v6 documentation contract", () => {
	test("documents OpenCode's exact-pin npm plugin command", async () => {
		const readme = await readFile("README.md", "utf8");
		const install = section(readme, "Install");
		const block = install.match(/```json\n([\s\S]*?)\n```/)?.[1];

		expect(block).toBeDefined();
		expect(JSON.parse(block ?? "null")).toEqual({
			$schema: "https://opencode.ai/config.json",
			plugin: ["opencode-plugin-flow@6.0.0"],
		});
		expect(install).toContain("https://opencode.ai/docs/plugins/");
		expect(install).toContain(
			"opencode plugin opencode-plugin-flow@6.0.0 --global --force",
		);
		expect(install).toContain("Flow has no installer or activation CLI");
		expect(install).not.toContain("npx");
		expect(install).not.toContain("activation-check");
	});

	test("keeps command, tool, and hidden-agent inventories source-derived", async () => {
		const readme = await readFile("README.md", "utf8");
		const commands = firstColumnCodeValues(section(readme, "Commands"))
			.map((value) => value.split(/\s+/, 1)[0]?.replace(/^\//, "") ?? "")
			.sort();
		const tools = firstColumnCodeValues(section(readme, "Tools")).sort();

		expect(commands).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());
		expect(tools).toEqual(await registeredToolNames());
		expect(tools).toHaveLength(10);
		expect(Object.keys(FLOW_CORE_AGENTS)).toEqual(["flow-reviewer"]);
		expect(FLOW_CORE_AGENTS["flow-reviewer"].hidden).toBe(true);
		expect(readme).toContain("exactly one hidden worker");
		expect(readme).toContain("one independent review");
	});

	test("keeps only the current concise documentation set", async () => {
		const files = (await markdownFiles("docs")).map((path) =>
			relative(".", path),
		);
		const [index, context, adr, changelog] = await Promise.all([
			readFile("docs/index.md", "utf8"),
			readFile("CONTEXT.md", "utf8"),
			readFile("docs/adr/0005-flow-v6-session-v5-simplicity-first.md", "utf8"),
			readFile("CHANGELOG.md", "utf8"),
		]);

		expect(files.filter((path) => path.startsWith("docs/plan/"))).toEqual([]);
		expect(files).not.toContain("docs/causal-state.md");
		expect(files).not.toContain("docs/causal-transport-metrics.md");
		expect(files).not.toContain("docs/prompt-quality.md");
		expect(files).not.toContain("docs/review-lifecycle.md");
		expect(files).not.toContain(
			"docs/adr/0003-session-v4-review-assignments.md",
		);
		expect(files).not.toContain(
			"docs/adr/0004-single-version-runtime-attested-harness.md",
		);
		await expect(access("droid-wiki/README.md")).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(index).toContain("Flow v6 and Session\nv5");
		expect(context).toContain("Revision");
		expect(context).toContain("not wall-clock time");
		expect(adr).toContain("## Intentional tradeoffs");
		expect(adr).toContain("ten tools, five commands, and one hidden");
		expect(changelog).toContain("## [6.0.0] - 2026-07-21");
	});

	test("keeps CI focused on normal checks, platforms, live smoke, and release", async () => {
		const workflowNames = (await readdir(".github/workflows"))
			.filter((name) => name.endsWith(".yml"))
			.sort();
		const workflows = await Promise.all(
			workflowNames.map((name) =>
				readFile(join(".github/workflows", name), "utf8"),
			),
		);
		const combined = workflows.join("\n");

		expect(workflowNames).toEqual([
			"ci.yml",
			"opencode-compatibility.yml",
			"release.yml",
		]);
		expect(combined).toContain("bun run check");
		expect(combined).toContain("bun run smoke:live");
		expect(combined).toContain("tests/workspace-persistence.test.ts");
		expect(combined).toContain("npm publish");
		expect(combined).not.toMatch(
			/harness|lifecycle-soak|cross-version|replay-report|prompt:model-eval/i,
		);
	});

	test("keeps maintained relative Markdown links resolvable", async () => {
		const documents = [
			"README.md",
			"CHANGELOG.md",
			"CONTEXT.md",
			...(await markdownFiles("docs")),
		];
		const broken: string[] = [];
		for (const document of documents) {
			const markdown = await readFile(document, "utf8");
			for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
				const rawTarget = match[1]?.trim();
				if (!rawTarget || /^(?:[a-z]+:|#|\/)/i.test(rawTarget)) continue;
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
