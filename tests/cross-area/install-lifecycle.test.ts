import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	FLOW_SKILL_BUNDLE_DIRECTORY,
	resolveFlowSkillBundleFiles,
} from "../../src/adapters/opencode/skill-bundle";

const tempDirs: string[] = [];
type PluginFactory = typeof import("../../src/index").default;
const require = createRequire(import.meta.url);

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function copyScriptToTemp(scriptName: string, tempRoot: string): string {
	const sourcePath = join(import.meta.dir, "..", "..", "scripts", scriptName);
	const destinationPath = join(tempRoot, scriptName);
	mkdirSync(tempRoot, { recursive: true });
	copyFileSync(sourcePath, destinationPath);
	chmodSync(destinationPath, 0o755);
	return destinationPath;
}

async function runScript(
	scriptPath: string,
	homeDir: string,
	binDir: string,
	extraEnv: Record<string, string> = {},
	cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const spawned = Bun.spawn({
		cmd: ["bash", scriptPath],
		...(cwd === undefined ? {} : { cwd }),
		env: {
			...process.env,
			HOME: homeDir,
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			...extraEnv,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: await spawned.exited,
		stdout: await new Response(spawned.stdout).text(),
		stderr: await new Response(spawned.stderr).text(),
	};
}

function createSkillBundleArchive(tempRoot: string): string {
	const bundleRoot = join(tempRoot, "skill-bundle-root");
	const archivePath = join(tempRoot, "flow-skills.tar.gz");
	for (const file of resolveFlowSkillBundleFiles(bundleRoot)) {
		mkdirSync(dirname(file.absolutePath), { recursive: true });
		writeFileSync(file.absolutePath, file.content, "utf8");
	}
	const archiveProcess = Bun.spawnSync({
		cmd: ["tar", "-czf", archivePath, "-C", bundleRoot, ".config"],
		stdout: "pipe",
		stderr: "pipe",
	});
	if (!archiveProcess.success) {
		throw new Error(
			`failed to create skill bundle: ${new TextDecoder().decode(archiveProcess.stderr)}`,
		);
	}
	return archivePath;
}

async function importInstalledPlugin(
	pluginPath: string,
): Promise<PluginFactory> {
	const pluginDir = dirname(pluginPath);
	const peerDir = join(pluginDir, "node_modules", "@opencode-ai", "plugin");
	mkdirSync(peerDir, { recursive: true });
	copyFileSync(
		require.resolve("@opencode-ai/plugin/package.json"),
		join(peerDir, "package.json"),
	);
	const zodDir = join(pluginDir, "node_modules", "zod");
	cpSync(dirname(require.resolve("zod/package.json")), zodDir, {
		recursive: true,
	});
	mkdirSync(join(peerDir, "dist"), { recursive: true });
	writeFileSync(
		join(peerDir, "dist", "tool.js"),
		[
			'import { z } from "zod";',
			"export function tool(input) {",
			"  return input;",
			"}",
			"tool.schema = z;",
		].join("\n"),
	);
	writeFileSync(
		join(pluginDir, "package.json"),
		JSON.stringify({ type: "module" }, null, 2),
	);
	writeFileSync(
		join(peerDir, "dist", "index.js"),
		[`export { tool } from "./tool.js";`].join("\n"),
	);

	const module = (await import(`file://${pluginPath}`)) as {
		default: PluginFactory;
	};

	return module.default;
}

function writeCurlStub(
	tempRoot: string,
	{
		pluginBody,
		skillBundlePath = createSkillBundleArchive(tempRoot),
	}: { pluginBody: string; skillBundlePath?: string },
): string {
	const stubPath = join(tempRoot, "curl");
	const bodyPath = join(tempRoot, "curl-body.txt");
	writeFileSync(bodyPath, pluginBody);
	writeFileSync(
		stubPath,
		[
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			"output_path=''",
			"url=''",
			"while [[ $# -gt 0 ]]; do",
			'  case "$1" in',
			"    -o)",
			'      output_path="$2"',
			"      shift 2",
			"      ;;",
			"    -*)",
			"      shift",
			"      ;;",
			"    *)",
			'      url="$1"',
			"      shift",
			"      ;;",
			"  esac",
			"done",
			'if [[ -z "$output_path" ]]; then',
			"  echo 'curl stub expected -o <path>' >&2",
			"  exit 1",
			"fi",
			'case "$url" in',
			"  *flow-skills.tar.gz)",
			`    cp ${JSON.stringify(skillBundlePath)} "$output_path"`,
			"    ;;",
			"  *)",
			`    cp ${JSON.stringify(bodyPath)} "$output_path"`,
			"    ;;",
			"esac",
			'if [[ -n "$' + '{CURL_ARGS_PATH:-}" ]]; then',
			'  printf \'%s\\n\' "$url" >> "$CURL_ARGS_PATH"',
			"fi",
		].join("\n"),
		{ mode: 0o755 },
	);
	return stubPath;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("cross-area install lifecycle", () => {
	test("release scripts overwrite existing flow.js on install and remove canonical flow.js on uninstall", async () => {
		const tempRoot = makeTempDir("flow-install-lifecycle-");
		const homeDir = join(tempRoot, "home");
		const binDir = join(tempRoot, "bin");
		const projectRoot = join(tempRoot, "project");
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(binDir, { recursive: true });
		mkdirSync(projectRoot, { recursive: true });

		writeCurlStub(binDir, { pluginBody: "export default 'installed-flow';\n" });
		const installScript = copyScriptToTemp("release-install.sh", tempRoot);
		const uninstallScript = copyScriptToTemp("release-uninstall.sh", tempRoot);
		const canonicalPath = join(
			homeDir,
			".config",
			"opencode",
			"plugins",
			"flow.js",
		);
		mkdirSync(dirname(canonicalPath), { recursive: true });
		writeFileSync(canonicalPath, "// third-party plugin\n");

		const installResult = await runScript(
			installScript,
			homeDir,
			binDir,
			{},
			projectRoot,
		);
		expect(installResult.exitCode).toBe(0);
		expect(readFileSync(canonicalPath, "utf8")).toBe(
			"// Managed by flow-opencode install/uninstall\nexport default 'installed-flow';\n",
		);
		expect(installResult.stdout).toContain(
			`Flow skills installed to ${join(homeDir, FLOW_SKILL_BUNDLE_DIRECTORY)}`,
		);
		for (const file of resolveFlowSkillBundleFiles(homeDir)) {
			expect(readFileSync(file.absolutePath, "utf8")).toBe(file.content);
		}
		const userManagedSameNameSkill = resolveFlowSkillBundleFiles(homeDir).find(
			(file) => file.skill.name === "flow-plan",
		);
		if (!userManagedSameNameSkill) {
			throw new Error("Expected generated flow-plan skill fixture.");
		}
		writeFileSync(
			userManagedSameNameSkill.absolutePath,
			"# user-managed flow-plan\n",
		);

		writeFileSync(canonicalPath, "// third-party plugin\n");
		const uninstallResult = await runScript(
			uninstallScript,
			homeDir,
			binDir,
			{},
			projectRoot,
		);
		expect(uninstallResult.exitCode).toBe(0);
		expect(() => readFileSync(canonicalPath, "utf8")).toThrow();
		expect(uninstallResult.stdout).toContain(
			`Flow removed from ${canonicalPath}`,
		);
		expect(uninstallResult.stdout).toContain(
			`Flow skills removed from ${join(homeDir, FLOW_SKILL_BUNDLE_DIRECTORY)}`,
		);
		for (const file of resolveFlowSkillBundleFiles(homeDir)) {
			if (file.skill.name === "flow-plan") {
				expect(readFileSync(file.absolutePath, "utf8")).toBe(
					"# user-managed flow-plan\n",
				);
				continue;
			}
			expect(existsSync(file.absolutePath)).toBe(false);
		}
	});

	test("release scripts install to canonical path, plugin loads, flow_status reports missing session, and uninstall removes the file", async () => {
		const tempRoot = makeTempDir("flow-install-lifecycle-");
		const homeDir = join(tempRoot, "home");
		const binDir = join(tempRoot, "bin");
		const projectRoot = join(tempRoot, "project");
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(binDir, { recursive: true });
		mkdirSync(projectRoot, { recursive: true });

		const distPluginPath = join(
			import.meta.dir,
			"..",
			"..",
			"dist",
			"index.js",
		);
		const pluginBody = await readFile(distPluginPath, "utf8");
		writeCurlStub(binDir, { pluginBody });
		const curlArgsPath = join(tempRoot, "curl-url.txt");

		const installScript = copyScriptToTemp("release-install.sh", tempRoot);
		const generatedInstallScript = copyScriptToTemp(
			"release-install.sh",
			join(tempRoot, "generated"),
		);
		writeFileSync(
			generatedInstallScript,
			readFileSync(generatedInstallScript, "utf8").replaceAll(
				"__FLOW_RELEASE_TAG__",
				"v9.9.9",
			),
		);
		const uninstallScript = copyScriptToTemp("release-uninstall.sh", tempRoot);
		const canonicalPath = join(
			homeDir,
			".config",
			"opencode",
			"plugins",
			"flow.js",
		);

		const {
			exitCode: installExitCode,
			stdout: installStdout,
			stderr: installStderr,
		} = await runScript(installScript, homeDir, binDir, {}, projectRoot);

		if (installExitCode !== 0) {
			throw new Error(`install stderr: ${installStderr}`);
		}
		expect(installExitCode).toBe(0);
		expect(installStderr).toBe("");
		expect(installStdout).toContain(canonicalPath);
		const installedBytes = await readFile(canonicalPath, "utf8");
		expect(
			installedBytes.startsWith(
				"// Managed by flow-opencode install/uninstall\n",
			),
		).toBe(true);
		expect(installedBytes.endsWith(pluginBody)).toBe(true);

		const { exitCode: pinnedInstallExitCode, stderr: pinnedInstallStderr } =
			await runScript(
				generatedInstallScript,
				homeDir,
				binDir,
				{
					CURL_ARGS_PATH: curlArgsPath,
				},
				projectRoot,
			);
		expect(pinnedInstallExitCode).toBe(0);
		expect(pinnedInstallStderr).toBe("");
		expect(await readFile(curlArgsPath, "utf8")).toBe(
			[
				"https://github.com/ddv1982/flow-opencode/releases/download/v9.9.9/flow.js",
				"https://github.com/ddv1982/flow-opencode/releases/download/v9.9.9/flow-skills.tar.gz",
				"",
			].join("\n"),
		);

		const pluginModule = await importInstalledPlugin(canonicalPath);
		const worktree = makeTempDir("flow-install-worktree-");
		const plugin = await pluginModule({
			worktree,
		} as Parameters<PluginFactory>[0]);
		const flowStatusTool = plugin.tool?.flow_status;
		expect(flowStatusTool).toBeDefined();
		if (!flowStatusTool) {
			throw new Error("Expected installed plugin to expose flow_status.");
		}
		const statusResponse = JSON.parse(
			await flowStatusTool.execute({}, { worktree } as Parameters<
				NonNullable<
					Awaited<ReturnType<PluginFactory>>["tool"]
				>["flow_status"]["execute"]
			>[1]),
		);
		expect(statusResponse.status).toBe("missing");
		expect(statusResponse.summary).toBe("No active Flow session found.");

		const {
			exitCode: uninstallExitCode,
			stdout: uninstallStdout,
			stderr: uninstallStderr,
		} = await runScript(uninstallScript, homeDir, binDir, {}, projectRoot);

		expect(uninstallExitCode).toBe(0);
		expect(uninstallStderr).toBe("");
		expect(uninstallStdout).toContain(canonicalPath);
		await expect(readFile(canonicalPath, "utf8")).rejects.toThrow();
	});
});
