import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
	copyFileSync(sourcePath, destinationPath);
	chmodSync(destinationPath, 0o755);
	return destinationPath;
}

async function runScript(
	scriptPath: string,
	homeDir: string,
	binDir: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const spawned = Bun.spawn({
		cmd: ["bash", scriptPath],
		env: {
			...process.env,
			HOME: homeDir,
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
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

function writeCurlStub(tempRoot: string, body: string): string {
	const stubPath = join(tempRoot, "curl");
	writeFileSync(
		stubPath,
		[
			"#!/usr/bin/python3",
			"# -*- coding: utf-8 -*-",
			"import pathlib",
			"import sys",
			"",
			"args = sys.argv[1:]",
			"output_path = None",
			"index = 0",
			"while index < len(args):",
			"    if args[index] == '-o' and index + 1 < len(args):",
			"        output_path = args[index + 1]",
			"        index += 2",
			"        continue",
			"    index += 1",
			"",
			"if output_path is None:",
			"    raise SystemExit('curl stub expected -o <path>')",
			"",
			`pathlib.Path(output_path).write_text(${JSON.stringify(body)}, encoding='utf-8')`,
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
	test("release scripts install to canonical path, plugin loads, flow_status reports missing session, and uninstall removes the file", async () => {
		const tempRoot = makeTempDir("flow-install-lifecycle-");
		const homeDir = join(tempRoot, "home");
		const binDir = join(tempRoot, "bin");
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(binDir, { recursive: true });

		const distPluginPath = join(
			import.meta.dir,
			"..",
			"..",
			"dist",
			"index.js",
		);
		const pluginBody = await readFile(distPluginPath, "utf8");
		writeCurlStub(binDir, pluginBody);

		const installScript = copyScriptToTemp("release-install.sh", tempRoot);
		const uninstallScript = copyScriptToTemp("release-uninstall.sh", tempRoot);
		const canonicalPath = join(
			homeDir,
			".config",
			"opencode",
			"plugins",
			"flow.js",
		);
		const legacyPath = join(homeDir, ".opencode", "plugins", "flow.js");

		const {
			exitCode: installExitCode,
			stdout: installStdout,
			stderr: installStderr,
		} = await runScript(installScript, homeDir, binDir);

		if (installExitCode !== 0) {
			throw new Error(`install stderr: ${installStderr}`);
		}
		expect(installExitCode).toBe(0);
		expect(installStderr).toBe("");
		expect(installStdout).toContain(canonicalPath);
		expect(await readFile(canonicalPath, "utf8")).toBe(pluginBody);
		await expect(readFile(legacyPath, "utf8")).rejects.toThrow();

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
		} = await runScript(uninstallScript, homeDir, binDir);

		expect(uninstallExitCode).toBe(0);
		expect(uninstallStderr).toBe("");
		expect(uninstallStdout).toContain(canonicalPath);
		await expect(readFile(canonicalPath, "utf8")).rejects.toThrow();
	});

	test("release scripts preserve and remove a legacy pre-existing install path", async () => {
		const tempRoot = makeTempDir("flow-install-legacy-");
		const homeDir = join(tempRoot, "home");
		const binDir = join(tempRoot, "bin");
		const legacyPath = join(homeDir, ".opencode", "plugins", "flow.js");
		const canonicalPath = join(
			homeDir,
			".config",
			"opencode",
			"plugins",
			"flow.js",
		);
		mkdirSync(dirname(legacyPath), { recursive: true });
		mkdirSync(binDir, { recursive: true });
		writeFileSync(legacyPath, "legacy");

		const distPluginPath = join(
			import.meta.dir,
			"..",
			"..",
			"dist",
			"index.js",
		);
		const pluginBody = await readFile(distPluginPath, "utf8");
		writeCurlStub(binDir, pluginBody);

		const installScript = copyScriptToTemp("release-install.sh", tempRoot);
		const uninstallScript = copyScriptToTemp("release-uninstall.sh", tempRoot);

		const installResult = await runScript(installScript, homeDir, binDir);
		if (installResult.exitCode !== 0) {
			throw new Error(`legacy install stderr: ${installResult.stderr}`);
		}
		expect(installResult.exitCode).toBe(0);
		expect(installResult.stdout).toContain(legacyPath);
		expect(await readFile(legacyPath, "utf8")).toBe(pluginBody);
		await expect(readFile(canonicalPath, "utf8")).rejects.toThrow();

		const uninstallResult = await runScript(uninstallScript, homeDir, binDir);
		expect(uninstallResult.exitCode).toBe(0);
		expect(uninstallResult.stdout).toContain(legacyPath);
		await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
	});
});
