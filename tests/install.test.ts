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

function getInstallTargets(homeDir: string): {
	canonicalPath: string;
	legacyPath: string;
} {
	const [canonicalPath, legacyPath] = resolveInstallTargets({ homeDir });

	if (!canonicalPath || !legacyPath) {
		throw new Error("Expected canonical and legacy install targets.");
	}

	return { canonicalPath, legacyPath };
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
			join(homeDir, ".config", "opencode", "plugins", FLOW_PLUGIN_FILENAME),
		);
	});

	test("resolveInstallTargets returns canonical and legacy OpenCode plugin directories", () => {
		const homeDir = "/tmp/flow-home";

		expect(resolveInstallTargets({ homeDir })).toEqual([
			join(homeDir, ".config", "opencode", "plugins", FLOW_PLUGIN_FILENAME),
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

	test("runInstallCommand installs to the canonical plugin directory when no legacy install exists", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		const logs: string[] = [];
		let buildCalls = 0;
		const { canonicalPath, legacyPath } = getInstallTargets(homeDir);

		await writeBuiltPlugin(cwd, "global-install\n");

		const installedPath = await runInstallCommand([], {
			cwd,
			homeDir,
			build: async () => {
				buildCalls += 1;
			},
			logger: (message) => logs.push(message),
		});

		expect(buildCalls).toBe(1);
		expect(installedPath).toBe(canonicalPath);
		await expect(readFile(canonicalPath, "utf8")).resolves.toBe(
			"global-install\n",
		);
		await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
		expect(logs).toEqual([`Installed Flow plugin to ${canonicalPath}`]);
	});

	test("runInstallCommand preserves a legacy install path in place", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		const logs: string[] = [];
		const { canonicalPath, legacyPath } = getInstallTargets(homeDir);

		await writeBuiltPlugin(cwd, "legacy-install\n");
		await mkdir(join(legacyPath, ".."), { recursive: true });
		await writeFile(legacyPath, "old-legacy-install\n", "utf8");

		const installedPath = await runInstallCommand([], {
			cwd,
			homeDir,
			build: async () => {},
			logger: (message) => logs.push(message),
		});

		expect(installedPath).toBe(legacyPath);
		await expect(readFile(legacyPath, "utf8")).resolves.toBe(
			"legacy-install\n",
		);
		await expect(readFile(canonicalPath, "utf8")).rejects.toThrow();
		expect(logs).toEqual([`Installed Flow plugin to ${legacyPath}`]);
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

	test.each([
		{
			name: "canonical-only",
			seed: ({ canonicalPath }: ReturnType<typeof getInstallTargets>) => [
				canonicalPath,
			],
			expectedRemoved: ({
				canonicalPath,
			}: ReturnType<typeof getInstallTargets>) => [canonicalPath],
			expectedReturn: ({
				canonicalPath,
			}: ReturnType<typeof getInstallTargets>) => canonicalPath,
		},
		{
			name: "legacy-only",
			seed: ({ legacyPath }: ReturnType<typeof getInstallTargets>) => [
				legacyPath,
			],
			expectedRemoved: ({
				legacyPath,
			}: ReturnType<typeof getInstallTargets>) => [legacyPath],
			expectedReturn: ({ legacyPath }: ReturnType<typeof getInstallTargets>) =>
				legacyPath,
		},
		{
			name: "canonical and legacy",
			seed: ({
				canonicalPath,
				legacyPath,
			}: ReturnType<typeof getInstallTargets>) => [canonicalPath, legacyPath],
			expectedRemoved: ({
				canonicalPath,
				legacyPath,
			}: ReturnType<typeof getInstallTargets>) => [canonicalPath, legacyPath],
			expectedReturn: ({
				canonicalPath,
			}: ReturnType<typeof getInstallTargets>) => canonicalPath,
		},
	])("runUninstallCommand removes installed plugin files for $name homes", async ({
		seed,
		expectedRemoved,
		expectedReturn,
	}) => {
		const homeDir = makeTempDir();
		const targets = getInstallTargets(homeDir);
		const logs: string[] = [];
		const seededPaths = seed(targets);

		for (const path of seededPaths) {
			await mkdir(join(path, ".."), { recursive: true });
			await writeFile(path, "installed\n", "utf8");
		}

		const removedPath = await runUninstallCommand([], {
			homeDir,
			logger: (message) => logs.push(message),
		});

		for (const path of seededPaths) {
			await expect(readFile(path, "utf8")).rejects.toThrow();
		}

		expect(removedPath).toBe(expectedReturn(targets));
		expect(logs).toEqual(
			expectedRemoved(targets).map(
				(path) => `Removed Flow plugin from ${path}`,
			),
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

		expect(removedPath).toBeUndefined();

		logs.length = 0;
		await runUninstallCommand(["--help"], {
			homeDir,
			logger: (message) => logs.push(message),
		});

		expect(logs).toEqual([UNINSTALL_USAGE]);
	});
});
