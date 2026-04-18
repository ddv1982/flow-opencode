import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FLOW_PLUGIN_FILENAME,
	INSTALL_USAGE,
	installBuiltPlugin,
	resolveInstallTarget,
	resolveInstallTargets,
	runInstallCommand,
	runUninstallCommand,
	shouldShowHelp,
	UNINSTALL_USAGE,
} from "../src/installer";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-opencode-install-"));
	tempDirs.push(dir);
	return dir;
}

async function writeBuiltPlugin(
	cwd: string,
	content = "export default 'flow';\n",
): Promise<string> {
	const distDir = join(cwd, "dist");
	const sourceFile = join(distDir, "index.js");
	await mkdir(distDir, { recursive: true });
	await writeFile(sourceFile, content, "utf8");
	return sourceFile;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (!dir) {
			break;
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("installer", () => {
	test("installer only accepts the default command or help", () => {
		expect(shouldShowHelp(["--help"], INSTALL_USAGE)).toBe(true);
		expect(() => shouldShowHelp(["--project", "demo"], INSTALL_USAGE)).toThrow(
			"Unknown argument",
		);
	});

	test("resolveInstallTarget defaults to the global OpenCode plugin directory", () => {
		const homeDir = "/tmp/flow-home";

		expect(resolveInstallTarget({ homeDir })).toBe(
			join(homeDir, ".opencode", "plugins", FLOW_PLUGIN_FILENAME),
		);
	});

	test("resolveInstallTargets returns the configured OpenCode plugin directory", () => {
		const homeDir = "/tmp/flow-home";

		expect(resolveInstallTargets({ homeDir })).toEqual([
			join(homeDir, ".opencode", "plugins", FLOW_PLUGIN_FILENAME),
		]);
	});

	test("installBuiltPlugin creates directories and copies the built artifact", async () => {
		const sourceRoot = makeTempDir();
		const targetRoot = makeTempDir();
		const sourceFile = await writeBuiltPlugin(sourceRoot, "flow-build\n");
		const destinationFile = join(
			targetRoot,
			".config",
			"opencode",
			"plugins",
			FLOW_PLUGIN_FILENAME,
		);
		const logs: string[] = [];

		const installedPath = await installBuiltPlugin({
			sourceFile,
			destinationFile,
			logger: (message) => logs.push(message),
		});

		expect(installedPath).toBe(destinationFile);
		expect(await readFile(destinationFile, "utf8")).toBe("flow-build\n");
		expect(logs).toEqual([`Installed Flow plugin to ${destinationFile}`]);
	});

	test("runInstallCommand installs to the configured plugin directory", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		const logs: string[] = [];
		let buildCalls = 0;

		await writeBuiltPlugin(cwd, "global-install\n");

		const installedPath = await runInstallCommand([], {
			cwd,
			homeDir,
			build: async () => {
				buildCalls += 1;
			},
			logger: (message) => logs.push(message),
		});

		const expectedPaths = resolveInstallTargets({ homeDir });

		expect(buildCalls).toBe(1);
		expect(installedPath).toBe(expectedPaths[0]);
		await expect(
			Promise.all(expectedPaths.map((path) => readFile(path, "utf8"))),
		).resolves.toEqual(["global-install\n"]);
		expect(logs).toEqual(
			expectedPaths.map((path) => `Installed Flow plugin to ${path}`),
		);
	});

	test("installBuiltPlugin reports a clear error when the build artifact is missing", async () => {
		const destinationFile = join(makeTempDir(), FLOW_PLUGIN_FILENAME);

		await expect(
			installBuiltPlugin({
				sourceFile: join(makeTempDir(), "dist", "index.js"),
				destinationFile,
				logger: () => {},
			}),
		).rejects.toThrow("Run `bun run build` first");
	});

	test("runUninstallCommand removes installed plugin files from the configured directory", async () => {
		const homeDir = makeTempDir();
		const destinationFiles = resolveInstallTargets({ homeDir });
		const logs: string[] = [];

		await Promise.all(
			destinationFiles.map(async (path) => {
				await mkdir(join(path, ".."), { recursive: true });
				await writeFile(path, "installed\n", "utf8");
			}),
		);

		const removedPath = await runUninstallCommand([], {
			homeDir,
			logger: (message) => logs.push(message),
		});

		await Promise.all(
			destinationFiles.map(async (path) => {
				await expect(readFile(path, "utf8")).rejects.toThrow();
			}),
		);
		expect(removedPath).toBe(destinationFiles[0]);
		expect(logs).toEqual(
			destinationFiles.map((path) => `Removed Flow plugin from ${path}`),
		);
	});

	test("runUninstallCommand accepts help and ignores missing files", async () => {
		const homeDir = makeTempDir();
		const logs: string[] = [];

		await expect(
			runUninstallCommand(["--project"], { homeDir }),
		).rejects.toThrow("Unknown argument");

		const removedPath = await runUninstallCommand([], {
			homeDir,
			logger: (message) => logs.push(message),
		});

		expect(removedPath).toBe(resolveInstallTargets({ homeDir })[0]);

		logs.length = 0;
		await runUninstallCommand(["--help"], {
			homeDir,
			logger: (message) => logs.push(message),
		});

		expect(logs).toEqual([UNINSTALL_USAGE]);
	});
});
