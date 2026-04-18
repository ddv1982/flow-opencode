import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../../src/tools/schemas";

type PluginFactory = typeof import("../../src/index").default;
type ToolExecutor = {
	execute: (args: unknown, context: ToolContext) => Promise<string>;
};

export type BuiltPlugin = Awaited<ReturnType<PluginFactory>>;
export type BuiltTool = {
	execute: (args: unknown, context: ToolContext) => Promise<string>;
};
export type BuiltToolMap = Record<string, ToolExecutor>;

const tempDirs: string[] = [];

export function makeManagedTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

export function cleanupManagedTempDirs(): void {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

export async function importBuiltPlugin(): Promise<PluginFactory> {
	const projectRoot = join(import.meta.dir, "..", "..");
	const packageDir = makeManagedTempDir("flow-dist-package-");
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
	const module = (await import(
		`file://${entryPath}?t=${Date.now()}-${Math.random()}`
	)) as {
		default: PluginFactory;
	};
	return module.default;
}

export function createToolContext(worktree: string): ToolContext {
	return { worktree } as ToolContext;
}

export function requireTool<T extends ToolExecutor>(
	tools: BuiltToolMap,
	name: string,
): T {
	const tool = tools[name];
	if (!tool) {
		throw new Error(`Missing tool ${name}`);
	}

	return tool as T;
}
