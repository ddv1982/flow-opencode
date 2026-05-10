import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FLOW_SKILL_BUNDLE_DIRECTORY,
	resolveFlowSkillBundleFiles,
} from "../src/adapters/opencode/skill-bundle";
import {
	FLOW_PLUGIN_FILENAME,
	FLOW_PLUGIN_OWNERSHIP_HEADER,
	INSTALL_USAGE,
	installBuiltPlugin,
	resolveInstallTarget,
	runInstallCommand,
	runUninstallCommand,
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

function getFlowSkillBundleFile(
	cwd: string,
	skillName: "flow-plan" | "flow-run" | "flow-review",
) {
	const file = resolveFlowSkillBundleFiles(cwd).find(
		(item) => item.skill.name === skillName,
	);
	if (!file) {
		throw new Error(`Missing generated skill fixture for ${skillName}.`);
	}
	return file;
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
	test("runInstallCommand accepts help and rejects unknown arguments", async () => {
		const logs: string[] = [];

		await runInstallCommand(["--help"], {
			build: async () => {
				throw new Error("help must not build");
			},
			logger: (message) => logs.push(message),
		});

		expect(logs).toEqual([INSTALL_USAGE]);
		await expect(
			runInstallCommand(["--unknown"], {
				build: async () => {},
			}),
		).rejects.toThrow("Unknown argument");
		await expect(
			runInstallCommand(["--project"], {
				build: async () => {},
			}),
		).rejects.toThrow("Missing value for --project");
	});

	test("resolveInstallTarget defaults to the global OpenCode plugin directory", () => {
		const homeDir = "/tmp/flow-home";

		expect(resolveInstallTarget({ homeDir })).toBe(
			join(homeDir, ".config", "opencode", "plugins", FLOW_PLUGIN_FILENAME),
		);
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
		expect(await readFile(destinationFile, "utf8")).toBe(
			`${FLOW_PLUGIN_OWNERSHIP_HEADER}flow-build\n`,
		);
		expect(logs).toEqual([`Installed Flow plugin to ${destinationFile}`]);
	});

	test("runInstallCommand installs the global plugin and generated skills by default", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		const logs: string[] = [];
		let buildCalls = 0;
		const canonicalPath = resolveInstallTarget({ homeDir });

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
			`${FLOW_PLUGIN_OWNERSHIP_HEADER}global-install\n`,
		);
		for (const file of resolveFlowSkillBundleFiles(cwd)) {
			await expect(readFile(file.absolutePath, "utf8")).resolves.toBe(
				file.content,
			);
		}
		expect(existsSync(join(cwd, ".flow"))).toBe(false);
		expect(logs).toEqual([
			`Installed Flow plugin to ${canonicalPath}`,
			`Installed Flow skills to ${join(cwd, FLOW_SKILL_BUNDLE_DIRECTORY)}`,
		]);
	});

	test("runInstallCommand can target generated skills at an explicit project", async () => {
		const cwd = makeTempDir();
		const projectRoot = makeTempDir();
		const homeDir = makeTempDir();
		const canonicalPath = resolveInstallTarget({ homeDir });
		await writeBuiltPlugin(cwd, "global-install\n");

		const installedPath = await runInstallCommand(["--project", projectRoot], {
			cwd,
			homeDir,
			build: async () => {},
			logger: () => {},
		});

		expect(installedPath).toBe(canonicalPath);
		for (const file of resolveFlowSkillBundleFiles(projectRoot)) {
			await expect(readFile(file.absolutePath, "utf8")).resolves.toBe(
				file.content,
			);
		}
		for (const file of resolveFlowSkillBundleFiles(cwd)) {
			expect(existsSync(file.absolutePath)).toBe(false);
		}
	});

	test("runInstallCommand preflights skill conflicts before global plugin mutation", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		let buildCalls = 0;
		const canonicalPath = resolveInstallTarget({ homeDir });
		const flowPlanSkill = getFlowSkillBundleFile(cwd, "flow-plan");
		await mkdir(join(flowPlanSkill.absolutePath, ".."), { recursive: true });
		await writeFile(
			flowPlanSkill.absolutePath,
			"# user-managed flow-plan\n",
			"utf8",
		);

		await expect(
			runInstallCommand([], {
				cwd,
				homeDir,
				build: async () => {
					buildCalls += 1;
				},
				logger: () => {},
			}),
		).rejects.toThrow("Refusing to overwrite user-managed OpenCode skill");

		expect(buildCalls).toBe(0);
		expect(existsSync(canonicalPath)).toBe(false);
		await expect(readFile(flowPlanSkill.absolutePath, "utf8")).resolves.toBe(
			"# user-managed flow-plan\n",
		);
	});

	test("runInstallCommand preflights unowned plugin conflicts before build or skill writes", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		let buildCalls = 0;
		const canonicalPath = resolveInstallTarget({ homeDir });
		await mkdir(join(canonicalPath, ".."), { recursive: true });
		await writeFile(canonicalPath, "// not flow managed\n", "utf8");

		await expect(
			runInstallCommand([], {
				cwd,
				homeDir,
				build: async () => {
					buildCalls += 1;
				},
				logger: () => {},
			}),
		).rejects.toThrow("Refusing to overwrite user-managed OpenCode plugin");

		expect(buildCalls).toBe(0);
		await expect(readFile(canonicalPath, "utf8")).resolves.toBe(
			"// not flow managed\n",
		);
		for (const file of resolveFlowSkillBundleFiles(cwd)) {
			expect(existsSync(file.absolutePath)).toBe(false);
		}
	});

	test("runInstallCommand does not install the global plugin when skill installation fails", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		let buildCalls = 0;
		const canonicalPath = resolveInstallTarget({ homeDir });
		const flowPlanSkill = getFlowSkillBundleFile(cwd, "flow-plan");
		await writeBuiltPlugin(cwd, "global-install\n");

		await expect(
			runInstallCommand([], {
				cwd,
				homeDir,
				build: async () => {
					buildCalls += 1;
					await mkdir(join(flowPlanSkill.absolutePath, ".."), {
						recursive: true,
					});
					await writeFile(
						flowPlanSkill.absolutePath,
						"# user-managed flow-plan\n",
						"utf8",
					);
				},
				logger: () => {},
			}),
		).rejects.toThrow("Refusing to overwrite user-managed OpenCode skill");

		expect(buildCalls).toBe(1);
		expect(existsSync(canonicalPath)).toBe(false);
		await expect(readFile(flowPlanSkill.absolutePath, "utf8")).resolves.toBe(
			"# user-managed flow-plan\n",
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

	test("installBuiltPlugin refuses to overwrite an unowned flow.js", async () => {
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
		await mkdir(join(destinationFile, ".."), { recursive: true });
		await writeFile(
			destinationFile,
			"// stale or third-party flow.js\n",
			"utf8",
		);

		await expect(
			installBuiltPlugin({
				sourceFile,
				destinationFile,
				logger: () => {},
			}),
		).rejects.toThrow("Refusing to overwrite user-managed OpenCode plugin");

		expect(await readFile(destinationFile, "utf8")).toBe(
			"// stale or third-party flow.js\n",
		);
	});

	test("installBuiltPlugin can replace an existing Flow-owned flow.js", async () => {
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
		await mkdir(join(destinationFile, ".."), { recursive: true });
		await writeFile(
			destinationFile,
			`${FLOW_PLUGIN_OWNERSHIP_HEADER}old-flow-build\n`,
			"utf8",
		);

		const installedPath = await installBuiltPlugin({
			sourceFile,
			destinationFile,
			logger: () => {},
		});

		expect(installedPath).toBe(destinationFile);
		expect(await readFile(destinationFile, "utf8")).toBe(
			`${FLOW_PLUGIN_OWNERSHIP_HEADER}flow-build\n`,
		);
	});

	test("runUninstallCommand removes the installed canonical plugin file and generated skills", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		const logs: string[] = [];
		const canonicalPath = resolveInstallTarget({ homeDir });
		await writeBuiltPlugin(cwd, "installed\n");
		await runInstallCommand([], {
			cwd,
			homeDir,
			build: async () => {},
			logger: () => {},
		});

		const removedPath = await runUninstallCommand([], {
			cwd,
			homeDir,
			logger: (message) => logs.push(message),
		});

		await expect(readFile(canonicalPath, "utf8")).rejects.toThrow();
		expect(removedPath).toBe(canonicalPath);
		for (const file of resolveFlowSkillBundleFiles(cwd)) {
			expect(existsSync(file.absolutePath)).toBe(false);
		}
		expect(logs).toEqual([
			`Removed Flow skills from ${join(cwd, FLOW_SKILL_BUNDLE_DIRECTORY)}`,
			`Removed Flow plugin from ${canonicalPath}`,
		]);
	});

	test("runUninstallCommand removes an outdated canonical flow.js", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		const logs: string[] = [];
		const canonicalPath = resolveInstallTarget({ homeDir });
		await mkdir(join(canonicalPath, ".."), { recursive: true });
		await writeFile(canonicalPath, "// stale outdated flow plugin\n", "utf8");

		const removedPath = await runUninstallCommand([], {
			cwd,
			homeDir,
			logger: (message) => logs.push(message),
		});

		await expect(readFile(canonicalPath, "utf8")).rejects.toThrow();
		expect(removedPath).toBe(canonicalPath);
		expect(logs).toEqual([`Removed Flow plugin from ${canonicalPath}`]);
	});

	test("runUninstallCommand preflights skill conflicts before global plugin removal", async () => {
		const cwd = makeTempDir();
		const homeDir = makeTempDir();
		const canonicalPath = resolveInstallTarget({ homeDir });
		await mkdir(join(canonicalPath, ".."), { recursive: true });
		await writeFile(
			canonicalPath,
			`${FLOW_PLUGIN_OWNERSHIP_HEADER}installed\n`,
			"utf8",
		);
		await writeBuiltPlugin(cwd, "installed\n");
		await runInstallCommand([], {
			cwd,
			homeDir,
			build: async () => {},
			logger: () => {},
		});
		const flowRunSkill = getFlowSkillBundleFile(cwd, "flow-run");
		await writeFile(
			flowRunSkill.absolutePath,
			`${await readFile(flowRunSkill.absolutePath, "utf8")}\nuser edit\n`,
			"utf8",
		);

		await expect(
			runUninstallCommand([], {
				cwd,
				homeDir,
				logger: () => {},
			}),
		).rejects.toThrow("Refusing to remove user-edited OpenCode skill");

		await expect(readFile(canonicalPath, "utf8")).resolves.toBe(
			`${FLOW_PLUGIN_OWNERSHIP_HEADER}installed\n`,
		);
		expect(existsSync(flowRunSkill.absolutePath)).toBe(true);
	});

	test("runUninstallCommand accepts help and ignores missing files", async () => {
		const homeDir = makeTempDir();
		const logs: string[] = [];

		await expect(
			runUninstallCommand(["--project"], { homeDir }),
		).rejects.toThrow("Missing value for --project");
		await expect(
			runInstallCommand(["--with-skills"], {
				homeDir,
				build: async () => {},
			}),
		).rejects.toThrow("Unknown argument");
		await expect(
			runInstallCommand(["--skills-only"], {
				homeDir,
				build: async () => {},
			}),
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
