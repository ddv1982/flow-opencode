import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const scriptPath = join(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"architecture-seams.mjs",
);

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-architecture-seams-"));
	tempDirs.push(dir);
	return dir;
}

function writeFileInRepo(root: string, relativePath: string, content: string) {
	const filePath = join(root, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content);
}

function runArchitectureSeams({
	mode = "report",
	layout,
}: {
	mode?: "report" | "enforce";
	layout: Array<{ path: string; content: string }>;
}) {
	const directory = makeTempDir();
	for (const entry of layout) {
		writeFileInRepo(directory, entry.path, entry.content);
	}

	return Bun.spawn({
		cmd: ["node", scriptPath],
		cwd: repoRoot,
		env: {
			...process.env,
			FLOW_ARCH_SEAMS_ROOT: directory,
			FLOW_ARCH_SEAMS_MODE: mode,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("architecture seams script", () => {
	test("reports violations but stays green in report mode", async () => {
		const process = runArchitectureSeams({
			mode: "report",
			layout: [
				{
					path: "src/runtime/application/a.ts",
					content:
						'import { x } from "../../adapters/opencode/b";\nexport const y = x;\n',
				},
				{
					path: "src/adapters/opencode/b.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(0);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("report-only mode");
		expect(stdout).toContain("runtime->adapters");
	});

	test("fails in enforce mode when blocked edge exists", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/runtime/application/a.ts",
					content:
						'import { x } from "../../adapters/opencode/b";\nexport const y = x;\n',
				},
				{
					path: "src/adapters/opencode/b.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("Architecture seam contract violations detected.");
		expect(stdout).toContain("runtime->adapters");
	});

	test("fails in enforce mode when runtime imports distribution", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/runtime/application/a.ts",
					content:
						'import { x } from "../../distribution/skill-sync";\nexport const y = x;\n',
				},
				{
					path: "src/distribution/skill-sync.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("runtime->distribution");
	});

	test("fails in enforce mode when runtime imports a root entrypoint facade", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/runtime/application/a.ts",
					content: 'import { x } from "../../config";\nexport const y = x;\n',
				},
				{
					path: "src/config.ts",
					content: 'export { x } from "./adapters/opencode/config";\n',
				},
				{
					path: "src/adapters/opencode/config.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("runtime->entrypoints");
		expect(stdout).toContain("src/runtime/application/a.ts");
	});

	test("fails in enforce mode when shared config imports adapter implementation", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/config-shared.ts",
					content:
						'import { x } from "./adapters/opencode/config";\nexport const y = x;\n',
				},
				{
					path: "src/adapters/opencode/config.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("shared->adapters");
		expect(stdout).toContain("src/config-shared.ts");
	});

	test("fails in enforce mode when distribution imports runtime", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/distribution/skill-sync.ts",
					content:
						'import { x } from "../runtime/application/index";\nexport const y = x;\n',
				},
				{
					path: "src/runtime/application/index.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("distribution->runtime");
	});

	test("fails in enforce mode when distribution imports adapters", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/distribution/skill-sync.ts",
					content:
						'import { x } from "../adapters/opencode/config";\nexport const y = x;\n',
				},
				{
					path: "src/adapters/opencode/config.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("distribution->adapters");
	});

	test("fails in enforce mode when adapters import root entrypoint facades", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/adapters/opencode/plugin.ts",
					content: 'import { x } from "../../config";\nexport const y = x;\n',
				},
				{
					path: "src/config.ts",
					content: 'export { x } from "./config-shared";\n',
				},
				{
					path: "src/config-shared.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("adapters->entrypoints");
	});

	test("resolves extension-bearing imports before layer classification", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/runtime/application/a.ts",
					content:
						'import { x } from "../../config.js";\nexport const y = x;\n',
				},
				{
					path: "src/config.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("runtime->entrypoints");
		expect(stdout).toContain("src/config.ts");
	});

	test("resolves directory index imports before layer classification", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/distribution/skill-sync.ts",
					content:
						'import { x } from "../runtime/application";\nexport const y = x;\n',
				},
				{
					path: "src/runtime/application/index.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("distribution->runtime");
		expect(stdout).toContain("src/runtime/application/index.ts");
	});

	test("passes clean layouts in enforce mode", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/runtime/domain/b.ts",
					content: "export const z = 1;\n",
				},
				{
					path: "src/adapters/opencode/plugin.ts",
					content:
						'import { z } from "../../runtime/domain/b";\nimport { sync } from "../../distribution/skill-sync";\nimport { shared } from "../../config-shared";\nexport const plugin = [z, sync, shared];\n',
				},
				{
					path: "src/distribution/skill-sync.ts",
					content:
						'import { shared } from "../config-shared";\nexport const sync = shared;\n',
				},
				{
					path: "src/config-shared.ts",
					content: "export const shared = 1;\n",
				},
				{
					path: "src/index.ts",
					content:
						'export { plugin as default } from "./adapters/opencode/plugin";\n',
				},
			],
		});
		expect(await process.exited).toBe(0);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("Architecture seams OK");
	});
});
