import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const scriptPath = join(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"dependency-contract.mjs",
);

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-dependency-contract-"));
	tempDirs.push(dir);
	return dir;
}

function writeJson(filePath: string, value: unknown) {
	writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function runDependencyContract({
	projectZod = "4.1.8",
	rootZod = "4.1.8",
	pluginDependencyZod = "4.1.8",
	pluginEffectiveZod = "4.1.8",
}: {
	projectZod?: string;
	rootZod?: string;
	pluginDependencyZod?: string;
	pluginEffectiveZod?: string;
}) {
	const directory = makeTempDir();
	const packageJsonPath = join(directory, "package.json");
	const pluginPackageJsonPath = join(directory, "plugin-package.json");
	const rootZodPackageJsonPath = join(directory, "root-zod-package.json");
	const pluginZodPackageJsonPath = join(directory, "plugin-zod-package.json");

	writeJson(packageJsonPath, {
		name: "opencode-plugin-flow",
		dependencies: {
			zod: projectZod,
		},
	});
	writeJson(pluginPackageJsonPath, {
		name: "@opencode-ai/plugin",
		dependencies: {
			zod: pluginDependencyZod,
		},
	});
	writeJson(rootZodPackageJsonPath, {
		name: "zod",
		version: rootZod,
	});
	writeJson(pluginZodPackageJsonPath, {
		name: "zod",
		version: pluginEffectiveZod,
	});

	return Bun.spawn({
		cmd: ["node", scriptPath],
		cwd: repoRoot,
		env: {
			...process.env,
			FLOW_DEPENDENCY_CONTRACT_PACKAGE_JSON_PATH: packageJsonPath,
			FLOW_DEPENDENCY_CONTRACT_PLUGIN_PACKAGE_JSON_PATH: pluginPackageJsonPath,
			FLOW_DEPENDENCY_CONTRACT_ROOT_ZOD_PACKAGE_JSON_PATH:
				rootZodPackageJsonPath,
			FLOW_DEPENDENCY_CONTRACT_PLUGIN_ZOD_PACKAGE_JSON_PATH:
				pluginZodPackageJsonPath,
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

describe("dependency contract script", () => {
	test("passes when project and plugin zod contracts align", async () => {
		const process = runDependencyContract({});
		expect(await process.exited).toBe(0);
		const stdout = await new Response(process.stdout).text();
		expect(stdout).toContain("Dependency contract OK.");
		expect(stdout).toContain("project dependency zod=4.1.8");
	});

	test("fails when the project dependency drifts from the installed root zod", async () => {
		const process = runDependencyContract({
			projectZod: "4.1.8",
			rootZod: "4.2.0",
		});
		expect(await process.exited).toBe(1);
		const stderr = await new Response(process.stderr).text();
		expect(stderr).toContain("Dependency contract failed.");
		expect(stderr).toContain(
			"Project zod dependency 4.1.8 does not match installed root zod 4.2.0.",
		);
	});

	test("fails when the plugin effective zod drifts from the root zod", async () => {
		const process = runDependencyContract({
			pluginEffectiveZod: "4.2.0",
		});
		expect(await process.exited).toBe(1);
		const stderr = await new Response(process.stderr).text();
		expect(stderr).toContain(
			"Installed root zod 4.1.8 does not match plugin effective zod 4.2.0.",
		);
	});
});
