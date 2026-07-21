import { describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { FLOW_CORE_AGENTS, FLOW_CORE_COMMANDS } from "../src/config-shared.js";
import { FLOW_GUIDANCE_IDS } from "../src/guidance/ids.js";
import FlowPlugin from "../src/index.js";

function section(markdown: string, heading: string, level = 2): string {
	const marker = `${"#".repeat(level)} ${heading}`;
	const start = markdown.indexOf(marker);
	if (start === -1) throw new Error(`Missing Markdown section '${marker}'.`);
	const remainder = markdown.slice(start + marker.length);
	const next = remainder.search(new RegExp(`^#{1,${level}}\\s`, "m"));
	return next === -1 ? remainder : remainder.slice(0, next);
}

function firstColumnCodeValues(markdown: string): string[] {
	return [...markdown.matchAll(/^\| `([^`]+)` \|/gm)].map(
		(match) => match[1] ?? "",
	);
}

function headings(markdown: string): string[] {
	return [...markdown.matchAll(/^#{2,3} (.+)$/gm)].map(
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
	test("documents exact-pin installation and the pre-v6 upgrade boundary", async () => {
		const readme = await readFile("README.md", "utf8");
		const install = section(readme, "Install");
		const block = install.match(/```json\n([\s\S]*?)\n```/)?.[1];

		expect(JSON.parse(block ?? "null")).toEqual({
			$schema: "https://opencode.ai/config.json",
			plugin: ["opencode-plugin-flow@6.2.0"],
		});
		expect(install).toContain(
			"opencode plugin opencode-plugin-flow@6.2.0 --global --force",
		);
		expect(install).toMatch(
			/Exact version pins do not update\s+automatically\./,
		);
		expect(install).toMatch(/Flow v5 or earlier[\s\S]+Session v5/);
		expect(install).toContain("https://opencode.ai/docs/plugins/");
		expect(install).not.toMatch(/\bnpx\b|activation-check/);
	});

	test("keeps the README operator-focused and commands source-derived", async () => {
		const readme = await readFile("README.md", "utf8");
		const quickStart = section(readme, "Quick start");
		const commandsSection = section(readme, "Commands");
		const commands = firstColumnCodeValues(commandsSection)
			.map((value) => value.split(/\s+/, 1)[0]?.replace(/^\//, "") ?? "")
			.sort();

		expect(commands).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());
		for (const command of [
			"/flow-auto",
			"/flow-plan",
			"/flow-run",
			"/flow-status",
		]) {
			expect(quickStart).toContain(command);
		}
		expect(quickStart).toMatch(/approve (?:it|the plan) conversationally/i);
		expect(commandsSection).toMatch(
			/\| `\/flow-review` \| [^\n|]*(?:internal|recovery)/i,
		);
		expect(section(readme, "Bounded parallelism")).toMatch(
			/two or three[\s\S]+no wave state/i,
		);
		expect(headings(readme)).not.toContain("Tools");
		expect(headings(readme)).not.toContain("Guides");
		expect(headings(readme)).not.toContain("What the runtime enforces");
	});

	test("keeps maintainer inventories aligned with runtime surfaces", async () => {
		const maintainer = await readFile("docs/maintainer-contract.md", "utf8");
		const surface = section(maintainer, "OpenCode surface");
		const commands = firstColumnCodeValues(
			section(surface, "Commands", 3),
		).sort();
		const tools = firstColumnCodeValues(section(surface, "Tools", 3)).sort();
		const guides = firstColumnCodeValues(section(surface, "Guides", 3)).sort();
		const agents = firstColumnCodeValues(
			section(surface, "Hidden agents", 3),
		).sort();

		expect(commands).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());
		expect(tools).toEqual(await registeredToolNames());
		expect(guides).toEqual([...FLOW_GUIDANCE_IDS].sort());
		expect(agents).toEqual(Object.keys(FLOW_CORE_AGENTS).sort());
		for (const agent of Object.values(FLOW_CORE_AGENTS)) {
			expect(agent.hidden).toBe(true);
		}
	});

	test("keeps one concise maintained documentation set with clear ownership", async () => {
		const files = (await markdownFiles("docs"))
			.map((path) => relative(".", path))
			.sort();
		const [context, waveAdr, maintainer, troubleshooting, changelog] =
			await Promise.all([
				readFile("CONTEXT.md", "utf8"),
				readFile("docs/adr/0006-bounded-intra-feature-waves.md", "utf8"),
				readFile("docs/maintainer-contract.md", "utf8"),
				readFile("docs/troubleshooting.md", "utf8"),
				readFile("CHANGELOG.md", "utf8"),
			]);

		expect(files).toEqual(
			expect.arrayContaining([
				"docs/adr/0005-flow-v6-session-v5-simplicity-first.md",
				"docs/adr/0006-bounded-intra-feature-waves.md",
				"docs/index.md",
				"docs/maintainer-contract.md",
				"docs/troubleshooting.md",
			]),
		);
		for (const removed of [
			"docs/causal-state.md",
			"docs/prompt-quality.md",
			"docs/review-lifecycle.md",
		]) {
			expect(files).not.toContain(removed);
		}
		await expect(access("droid-wiki/README.md")).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(headings(context)).toEqual(
			expect.arrayContaining(["Versions", "Core terms", "Ownership"]),
		);
		expect(headings(waveAdr)).toEqual(
			expect.arrayContaining([
				"Status",
				"Context",
				"Decision",
				"Consequences",
				"Guardrail fit",
				"Rejected alternatives",
			]),
		);
		expect(headings(maintainer)).toEqual(
			expect.arrayContaining([
				"Causality and idempotency",
				"Validation and review",
				"Bounded worker waves",
				"Commands",
				"Tools",
				"Guides",
				"Hidden agents",
			]),
		);
		expect(
			section(troubleshooting, "Validation capture was cancelled"),
		).toMatch(/15\s+minutes[\s\S]+begins[\s\S]+after-hook/);
		expect(changelog).toContain("## [6.2.0] - 2026-07-21");
		expect(section(changelog, "[Unreleased]")).toContain("No changes yet.");
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
