import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const temporaryRoots: string[] = [];

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "flow-activation-cli-"));
	temporaryRoots.push(root);
	const project = join(root, "project");
	const home = join(root, "home");
	const xdgConfig = join(root, "xdg-config");
	const xdgCache = join(root, "xdg-cache");
	await mkdir(project, { recursive: true });
	await mkdir(join(xdgConfig, "opencode"), { recursive: true });
	await writeFile(
		join(xdgConfig, "opencode", "opencode.json"),
		`${JSON.stringify({ plugin: [`opencode-plugin-flow@${packageJson.version}`] })}\n`,
		"utf8",
	);
	return { root, project, home, xdgConfig, xdgCache };
}

function runCli(
	args: string[],
	environment: Awaited<ReturnType<typeof fixture>>,
) {
	return spawnSync(process.execPath, ["run", "./src/cli.ts", ...args], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: {
			...process.env,
			HOME: environment.home,
			XDG_CONFIG_HOME: environment.xdgConfig,
			XDG_CACHE_HOME: environment.xdgCache,
			OPENCODE_TEST_MANAGED_CONFIG_DIR: join(
				environment.root,
				"managed",
				"opencode",
			),
		},
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("activation CLI", () => {
	test("checks the embedded exact version without touching the isolated roots", async () => {
		const environment = await fixture();
		const result = runCli(
			["activation-check", "--project", environment.project, "--json"],
			environment,
		);

		expect(result.status).toBe(0);
		const report = JSON.parse(result.stdout) as {
			mode?: string;
			target?: string;
			coverage?: { otherProjectTrees?: boolean };
			singleVersionSatisfied?: boolean;
		};
		expect(report).toMatchObject({
			mode: "check",
			target: packageJson.version,
			coverage: { otherProjectTrees: false },
			singleVersionSatisfied: true,
		});
		expect(result.stderr).toBe("");
	});

	test("keeps activation-apply read-only unless --apply is explicit", async () => {
		const environment = await fixture();
		const projectConfig = join(environment.project, "opencode.json");
		const result = runCli(
			[
				"activation-apply",
				"--project",
				environment.project,
				"--scope",
				"project",
				"--json",
			],
			environment,
		);

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			mode: "dry-run",
			status: "ready",
			scope: "project",
		});
		expect(await Bun.file(projectConfig).exists()).toBe(false);
	});

	test("installs the embedded version immediately and permanently removes a proven older cache", async () => {
		const environment = await fixture();
		const globalConfig = join(
			environment.xdgConfig,
			"opencode",
			"opencode.json",
		);
		await writeFile(
			globalConfig,
			`${JSON.stringify({ plugin: ["opencode-plugin-flow@5.2.2"] })}\n`,
			"utf8",
		);
		const oldCache = join(
			environment.xdgCache,
			"opencode",
			"packages",
			"opencode-plugin-flow@5.2.2",
		);
		await mkdir(join(oldCache, "node_modules", "opencode-plugin-flow"), {
			recursive: true,
		});
		await writeFile(
			join(oldCache, "node_modules", "opencode-plugin-flow", "package.json"),
			'{"name":"opencode-plugin-flow","version":"5.2.2"}\n',
			"utf8",
		);

		const result = runCli(
			[
				"install",
				"--project",
				environment.project,
				"--scope",
				"global",
				"--json",
			],
			environment,
		);

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			mode: "apply",
			status: "applied",
			target: packageJson.version,
			after: { singleVersionSatisfied: true },
		});
		expect(JSON.parse(await Bun.file(globalConfig).text())).toEqual({
			plugin: [`opencode-plugin-flow@${packageJson.version}`],
		});
		await expect(access(oldCache)).rejects.toThrow();
	});

	test("labels a refused install plan as unexecuted", async () => {
		const environment = await fixture();
		const pluginDirectory = join(environment.xdgConfig, "opencode", "plugins");
		await mkdir(pluginDirectory, { recursive: true });
		await writeFile(
			join(pluginDirectory, "flow-custom-wrapper.js"),
			'export { default } from "opencode-plugin-flow@5.2.2";\n',
			"utf8",
		);
		await writeFile(
			join(environment.xdgConfig, "opencode", "opencode.json"),
			`${JSON.stringify({ plugin: ["./plugins/flow-custom-wrapper.js"] })}\n`,
			"utf8",
		);

		const result = runCli(
			["install", "--project", environment.project, "--scope", "global"],
			environment,
		);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain("Flow activation apply: refused");
		expect(result.stdout).toContain("- blocked plan (not executed):");
		expect(result.stdout.indexOf("- refused:")).toBeLessThan(
			result.stdout.indexOf("- blocked plan (not executed):"),
		);
		expect(result.stdout).toContain("- would-rewrite-config:");
	});

	test("rejects tags locally and preserves legacy-cleanup", async () => {
		const environment = await fixture();
		const invalid = runCli(
			[
				"activation-check",
				"--project",
				environment.project,
				"--target",
				"latest",
			],
			environment,
		);
		expect(invalid.status).toBe(1);
		expect(invalid.stderr).toContain("must be an exact semantic version");

		const legacy = runCli(
			["legacy-cleanup", "--dry-run", "--json"],
			environment,
		);
		expect(legacy.status).toBe(0);
		expect(JSON.parse(legacy.stdout)).toMatchObject({ mode: "dry-run" });
	});
});
