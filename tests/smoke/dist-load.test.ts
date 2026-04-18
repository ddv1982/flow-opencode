import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PluginFactory = typeof import("../../src/index").default;
type BuiltPlugin = Awaited<ReturnType<PluginFactory>>;
type TestTool = {
	execute: (args: unknown, context: unknown) => Promise<string>;
};
type RequiredSmokeTools = {
	flow_plan_start: TestTool;
	flow_status: TestTool;
	flow_history: TestTool;
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function importBuiltPlugin(): Promise<PluginFactory> {
	const projectRoot = join(import.meta.dir, "..", "..");
	const packageDir = makeTempDir("flow-dist-package-");
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({ type: "module" }, null, 2),
	);

	const peerDir = join(packageDir, "node_modules", "@opencode-ai", "plugin");
	mkdirSync(peerDir, { recursive: true });
	writeFileSync(
		join(peerDir, "package.json"),
		JSON.stringify(
			{
				name: "@opencode-ai/plugin",
				version: "0.0.0-test",
				type: "module",
				exports: "./index.js",
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(peerDir, "index.js"),
		[
			"export function tool(definition) {",
			"  return definition;",
			"}",
			"tool.schema = {",
			"  string: (options = {}) => ({ type: 'string', ...options }),",
			"  number: (options = {}) => ({ type: 'number', ...options }),",
			"  boolean: (options = {}) => ({ type: 'boolean', ...options }),",
			"  enum: (values, options = {}) => ({ type: 'enum', values, ...options }),",
			"  array: (item, options = {}) => ({ type: 'array', item, ...options }),",
			"  object: (shape, options = {}) => ({ type: 'object', shape, ...options }),",
			"};",
		].join("\n"),
	);

	const entryPath = join(projectRoot, "dist", "index.js");
	const module = (await import(`file://${entryPath}`)) as {
		default: PluginFactory;
	};
	return module.default;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("built dist smoke load", () => {
	test("dist bundle loads with external peer dep and exercises config plus three tools", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeTempDir("flow-dist-worktree-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		expect(plugin.config).toBeFunction();
		expect(plugin.tool).toBeDefined();
		const tools = plugin.tool as unknown as RequiredSmokeTools;

		const config = {
			agent: {},
			command: {},
		} as Record<string, Record<string, unknown>>;
		await plugin.config?.(
			config as Parameters<NonNullable<typeof plugin.config>>[0],
		);

		expect(Object.keys(config.agent ?? {})).toHaveLength(5);
		expect(Object.keys(config.command ?? {})).toHaveLength(7);
		expect(Object.keys(plugin.tool ?? {})).toHaveLength(15);

		const planStartResponse = JSON.parse(
			await tools.flow_plan_start.execute(
				{ goal: "Optimize the Flow bundle" },
				{ worktree },
			),
		);
		expect(planStartResponse.status).toBe("ok");
		expect(planStartResponse.session.goal).toBe("Optimize the Flow bundle");

		const statusResponse = JSON.parse(
			await tools.flow_status.execute({}, { worktree }),
		);
		expect(statusResponse.status).toBe("planning");
		expect(statusResponse.session.goal).toBe("Optimize the Flow bundle");

		const historyResponse = JSON.parse(
			await tools.flow_history.execute({}, { worktree }),
		);
		expect(historyResponse.status).toBe("ok");
		expect(historyResponse.history.sessions).toHaveLength(1);
		expect(historyResponse.history.sessions[0].id).toBe(
			planStartResponse.session.id,
		);
	});
});
