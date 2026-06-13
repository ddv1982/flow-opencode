import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
	test("documents source owners and projection surfaces outside the checker", () => {
		const adr = readFileSync(
			join(
				repoRoot,
				"docs",
				"architecture",
				"allowed-cross-layer-dependencies.md",
			),
			"utf8",
		);

		expect(adr).toContain("`shared` (`src/config-shared.ts`)");
		expect(adr).toContain("`distribution` owns package startup sync");
		expect(adr).toContain(
			"Root entrypoints (`src/index.ts`, `src/config.ts`, `src/cli.ts`)",
		);
		expect(adr).toContain("Projection surfaces outside this seam checker");
		expect(adr).toContain(
			"`src/prompts/**` and `src/audit/**` were governed projection surfaces",
		);
		expect(adr).toContain("deleted in the skills-first overhaul");
		expect(adr).toContain("hand-authored `skills/**` content");
	});

	test("does not partially enforce prompts or audit projection imports", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/prompts/contracts.ts",
					content:
						'import { runtimeValue } from "../runtime/domain/value";\nexport const promptValue = runtimeValue;\n',
				},
				{
					path: "src/audit/report-schema.ts",
					content:
						'import { adapterValue } from "../adapters/opencode/value";\nexport const auditValue = adapterValue;\n',
				},
				{
					path: "src/runtime/domain/value.ts",
					content: "export const runtimeValue = 1;\n",
				},
				{
					path: "src/adapters/opencode/value.ts",
					content: "export const adapterValue = 2;\n",
				},
			],
		});

		expect(await process.exited).toBe(0);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("Architecture seams OK");
		expect(stdout).not.toContain("prompts");
		expect(stdout).not.toContain("audit");
	});

	test("reports violations but stays green in report mode", async () => {
		const process = runArchitectureSeams({
			mode: "report",
			layout: [
				{
					path: "src/core/workflow/a.ts",
					content:
						'import { x } from "../../runtime/domain/b";\nexport const y = x;\n',
				},
				{ path: "src/runtime/domain/b.ts", content: "export const x = 1;\n" },
			],
		});
		expect(await process.exited).toBe(0);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("report-only mode");
		expect(stdout).toContain("core->runtime");
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

	test("fails in enforce mode when core imports workflow facade", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/core/registry/a.ts",
					content:
						'import type { SemanticInvariantId } from "../../workflow/domain";\nexport type LocalInvariantId = SemanticInvariantId;\n',
				},
				{
					path: "src/workflow/domain.ts",
					content: "export type SemanticInvariantId = 'x';\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("core->workflow");
		expect(stdout).toContain("src/core/registry/a.ts");
	});

	test("fails in enforce mode when workflow domain imports runtime domain", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/workflow/domain.ts",
					content: 'export { x } from "../runtime/domain/b";\n',
				},
				{ path: "src/runtime/domain/b.ts", content: "export const x = 1;\n" },
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("workflow->runtime");
		expect(stdout).toContain("src/runtime/domain/b");
	});

	test("fails in enforce mode when workflow imports adapters", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/workflow/domain.ts",
					content:
						'import { x } from "../adapters/opencode/b";\nexport const y = x;\n',
				},
				{
					path: "src/adapters/opencode/b.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("workflow->adapters");
	});

	test("fails in enforce mode when workflow domain facade imports runtime application", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/workflow/domain.ts",
					content:
						'import { x } from "../runtime/application/b";\nexport const y = x;\n',
				},
				{
					path: "src/runtime/application/b.ts",
					content: "export const x = 1;\n",
				},
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("workflow->runtime");
		expect(stdout).toContain("src/runtime/application/b");
	});

	test("fails in enforce mode when non-facade workflow files import runtime", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/workflow/worker.ts",
					content:
						'import { x } from "../runtime/domain/b";\nexport const y = x;\n',
				},
				{ path: "src/runtime/domain/b.ts", content: "export const x = 1;\n" },
			],
		});
		expect(await process.exited).toBe(1);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("workflow->runtime");
		expect(stdout).toContain("src/workflow/worker.ts");
	});

	test("passes clean layouts in enforce mode", async () => {
		const process = runArchitectureSeams({
			mode: "enforce",
			layout: [
				{
					path: "src/core/workflow/a.ts",
					content: "export const y = 1;\n",
				},
				{
					path: "src/runtime/domain/b.ts",
					content:
						'import { y } from "../../core/workflow/a";\nexport const z = y;\n',
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
