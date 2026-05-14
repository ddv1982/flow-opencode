#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageJson = JSON.parse(
	readFileSync(join(projectRoot, "package.json"), "utf8"),
);
const releaseInstallScript = join(projectRoot, "scripts", "release-install.sh");
const releaseUninstallScript = join(
	projectRoot,
	"scripts",
	"release-uninstall.sh",
);
const distPath = join(projectRoot, "dist", "index.js");
const generatedSkillNames = ["flow-plan", "flow-run", "flow-review"];
const manualStep =
	"Run real OpenCode manually in a disposable project to verify /flow-doctor, /flow-plan, /flow-status, and /flow-session UI/runtime behavior.";

function parseArgs(argv) {
	const options = {
		skipBuild: false,
		jsonPath: undefined,
		summaryPath: undefined,
		keepTemp: false,
		flowJsPath: undefined,
		skillBundlePath: undefined,
		installScriptPath: undefined,
		uninstallScriptPath: undefined,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--skip-build") {
			options.skipBuild = true;
			continue;
		}
		if (arg === "--keep-temp") {
			options.keepTemp = true;
			continue;
		}
		if (arg === "--json") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--json requires an output path.");
			}
			options.jsonPath = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--summary") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--summary requires an output path.");
			}
			options.summaryPath = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--flow-js") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--flow-js requires a path.");
			}
			options.flowJsPath = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--skill-bundle") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--skill-bundle requires a path.");
			}
			options.skillBundlePath = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--install-script") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--install-script requires a path.");
			}
			options.installScriptPath = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--uninstall-script") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--uninstall-script requires a path.");
			}
			options.uninstallScriptPath = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? projectRoot,
		env: options.env ?? process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed with exit ${result.status}: ${result.stderr || result.stdout}`,
		);
	}
	return result;
}

function ensureParent(path) {
	mkdirSync(dirname(path), { recursive: true });
}

function writeJson(path, evidence) {
	if (!path) {
		return;
	}
	ensureParent(path);
	writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function writeSummary(path, evidence) {
	if (!path) {
		return;
	}
	ensureParent(path);
	writeFileSync(
		path,
		[
			"# OpenCode-oriented Flow smoke evidence",
			"",
			`- Status: ${evidence.status}`,
			`- Package version: ${evidence.packageVersion}`,
			`- Release install mode: ${evidence.releaseInstall.assetMode}`,
			`- Surface: ${evidence.surface.agents} agents, ${evidence.surface.commands} commands, ${evidence.surface.tools} tools`,
			`- Real OpenCode CLI invoked: ${evidence.hostBoundary.realOpenCodeCliInvoked}`,
			`- Manual live OpenCode required: ${evidence.hostBoundary.manualLiveOpenCodeRequired}`,
			"",
			"## Runtime smoke",
			...evidence.runtimeSmoke.map(
				(item) => `- ${item.tool}: ${item.assertion} (${item.status})`,
			),
			"",
			`Remaining manual live OpenCode validation: ${evidence.remainingManualStep}`,
			"",
		].join("\n"),
		"utf8",
	);
}

function createBaseEvidence(tempRoot) {
	return {
		schemaVersion: 1,
		status: "failed",
		generatedAt: new Date().toISOString(),
		packageVersion: packageJson.version,
		environment: {
			node: process.version,
			bun: undefined,
			platform: process.platform,
		},
		releaseInstall: {
			assetMode: "local-file-url",
			pluginPath: join(
				tempRoot,
				"home",
				".config",
				"opencode",
				"plugins",
				"flow.js",
			),
			skillsPath: join(tempRoot, "home", ".config", "opencode", "skills"),
			installed: false,
			uninstalled: false,
		},
		hostBoundary: {
			mode: "local-import-with-project-sdk-peer",
			realOpenCodeCliInvoked: false,
			manualLiveOpenCodeRequired: true,
		},
		surface: {
			agents: 0,
			commands: 0,
			tools: 0,
			expectedAgentsPresent: [],
			expectedCommandsPresent: [],
			expectedToolsPresent: [],
			generatedSkillsPresent: [],
		},
		runtimeSmoke: [],
		remainingManualStep: manualStep,
	};
}

function prepareSkillBundle(tempRoot) {
	const bundleRoot = join(tempRoot, "skill-bundle-root");
	const archivePath = join(tempRoot, "assets", "flow-skills.tar.gz");
	mkdirSync(dirname(archivePath), { recursive: true });
	run("bun", [
		"run",
		"./scripts/cross-area/write-release-skill-bundle.ts",
		bundleRoot,
	]);
	run("tar", ["-czf", archivePath, "-C", bundleRoot, ".config"]);
	return archivePath;
}

function installPeerForLocalImport(pluginPath) {
	const pluginDir = dirname(pluginPath);
	const peerTarget = join(pluginDir, "node_modules", "@opencode-ai", "plugin");
	const zodTarget = join(pluginDir, "node_modules", "zod");
	mkdirSync(dirname(peerTarget), { recursive: true });
	cpSync(
		join(projectRoot, "node_modules", "@opencode-ai", "plugin"),
		peerTarget,
		{
			recursive: true,
		},
	);
	cpSync(join(projectRoot, "node_modules", "zod"), zodTarget, {
		recursive: true,
	});
	writeFileSync(
		join(pluginDir, "package.json"),
		JSON.stringify({ type: "module" }, null, 2),
	);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function assertFileExists(path, label) {
	assert(existsSync(path), `Missing smoke asset ${label}: ${path}`);
}

function toolOutput(result) {
	return typeof result === "string" ? result : result.output;
}

function parseToolJson(result) {
	return JSON.parse(toolOutput(result));
}

function validateGeneratedSkills(homeDir) {
	const present = [];
	for (const name of generatedSkillNames) {
		const skillPath = join(
			homeDir,
			".config",
			"opencode",
			"skills",
			name,
			"SKILL.md",
		);
		assert(existsSync(skillPath), `Missing generated skill ${name}`);
		const text = readFileSync(skillPath, "utf8");
		assert(
			new RegExp(
				`^<!-- flow-opencode-generated-skill name=${name} version=[0-9]+ hash=sha256:[a-f0-9]{64} -->`,
				"m",
			).test(text),
			`Generated skill ${name} is missing its intact marker.`,
		);
		present.push(name);
	}
	return present;
}

async function runSmoke(options) {
	const tempRoot = mkdtempSync(join(tmpdir(), "flow-opencode-smoke-"));
	const homeDir = join(tempRoot, "home");
	const worktree = join(tempRoot, "worktree");
	const assetsDir = join(tempRoot, "assets");
	mkdirSync(homeDir, { recursive: true });
	mkdirSync(worktree, { recursive: true });
	mkdirSync(assetsDir, { recursive: true });

	const evidence = createBaseEvidence(tempRoot);
	try {
		const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" });
		if (bunVersion.status === 0) {
			evidence.environment.bun = bunVersion.stdout.trim();
		}

		if (!options.skipBuild) {
			run("bun", ["run", "build"]);
		}
		assert(
			existsSync(distPath),
			"dist/index.js is missing; run bun run build first or omit --skip-build.",
		);

		const explicitAssetProvided = Boolean(
			options.flowJsPath ||
				options.skillBundlePath ||
				options.installScriptPath ||
				options.uninstallScriptPath,
		);
		const flowAssetPath = options.flowJsPath ?? join(assetsDir, "flow.js");
		if (!options.flowJsPath) {
			copyFileSync(distPath, flowAssetPath);
		}
		const skillBundlePath = options.skillBundlePath ?? prepareSkillBundle(tempRoot);
		const installScriptPath = options.installScriptPath ?? releaseInstallScript;
		const uninstallScriptPath =
			options.uninstallScriptPath ?? releaseUninstallScript;
		assertFileExists(flowAssetPath, "--flow-js path");
		assertFileExists(skillBundlePath, "--skill-bundle path");
		assertFileExists(installScriptPath, "--install-script path");
		assertFileExists(uninstallScriptPath, "--uninstall-script path");
		evidence.releaseInstall.assetSource = explicitAssetProvided
			? "explicit-or-mixed"
			: "generated-defaults";
		evidence.releaseInstall.assets = {
			flowJs: flowAssetPath,
			skillBundle: skillBundlePath,
			installScript: installScriptPath,
			uninstallScript: uninstallScriptPath,
		};
		evidence.workspaceIsolation = {
			repoRoot: projectRoot,
			worktree,
			worktreeFlowPath: join(worktree, ".flow"),
			repoRootFlowPath: join(projectRoot, ".flow"),
			repoRootFlowExistedBefore: existsSync(join(projectRoot, ".flow")),
			repoRootFlowExistedAfter: undefined,
			worktreeFlowCreated: false,
		};

		run("bash", [installScriptPath], {
			env: {
				...process.env,
				HOME: homeDir,
				FLOW_RELEASE_DOWNLOAD_URL: pathToFileURL(flowAssetPath).href,
				FLOW_RELEASE_SKILL_BUNDLE_URL: pathToFileURL(skillBundlePath).href,
			},
			cwd: worktree,
		});
		evidence.releaseInstall.installed = true;
		assert(
			existsSync(evidence.releaseInstall.pluginPath),
			"Release install did not write the canonical plugin path.",
		);

		evidence.surface.generatedSkillsPresent = validateGeneratedSkills(homeDir);
		installPeerForLocalImport(evidence.releaseInstall.pluginPath);

		const logs = [];
		const pluginModule = await import(
			`${pathToFileURL(evidence.releaseInstall.pluginPath).href}?t=${Date.now()}`
		);
		const plugin = await pluginModule.default({
			worktree,
			client: {
				app: {
					log(entry) {
						logs.push(entry);
					},
				},
			},
		});
		assert(
			logs.some((entry) => entry.message === "Flow plugin initialized."),
			"Plugin initialization log was not emitted.",
		);
		assert(
			logs.some((entry) => entry.message === "Creating Flow tool surface."),
			"Tool surface log was not emitted.",
		);

		const config = { agent: {}, command: {} };
		await plugin.config(config);
		const agentNames = Object.keys(config.agent).sort();
		const commandNames = Object.keys(config.command).sort();
		const toolNames = Object.keys(plugin.tool ?? {}).sort();
		evidence.surface = {
			...evidence.surface,
			agents: agentNames.length,
			commands: commandNames.length,
			tools: toolNames.length,
			expectedAgentsPresent: agentNames,
			expectedCommandsPresent: commandNames,
			expectedToolsPresent: toolNames,
		};
		assert(
			agentNames.length === 7,
			`Expected 7 agents, found ${agentNames.length}.`,
		);
		assert(
			commandNames.length === 9,
			`Expected 9 commands, found ${commandNames.length}.`,
		);
		assert(
			toolNames.length === 18,
			`Expected 18 tools, found ${toolNames.length}.`,
		);
		assert(
			typeof plugin.hooks?.["tool.definition"] === "function",
			"Missing tool.definition hook.",
		);
		assert(
			typeof plugin.hooks?.["experimental.chat.system.transform"] ===
				"function",
			"Missing system transform hook.",
		);
		assert(
			typeof plugin.hooks?.["experimental.session.compacting"] === "function",
			"Missing session compacting hook.",
		);
		assert(
			plugin.hooks?.["experimental.attachment"] === undefined,
			"Unexpected attachment hook is present.",
		);

		const missingStatus = parseToolJson(
			await plugin.tool.flow_status.execute({}, { worktree }),
		);
		assert(
			missingStatus.status === "missing",
			"flow_status did not report missing before plan start.",
		);
		evidence.runtimeSmoke.push({
			tool: "flow_status",
			assertion: "missing before plan start",
			status: "passed",
		});

		const planStart = parseToolJson(
			await plugin.tool.flow_plan_start.execute(
				{ goal: "OpenCode smoke automation" },
				{ worktree },
			),
		);
		assert(planStart.status === "ok", "flow_plan_start did not return ok.");
		evidence.workspaceIsolation.worktreeFlowCreated = existsSync(
			evidence.workspaceIsolation.worktreeFlowPath,
		);
		assert(
			evidence.workspaceIsolation.worktreeFlowCreated,
			"flow_plan_start did not create state under the temp worktree.",
		);
		evidence.runtimeSmoke.push({
			tool: "flow_plan_start",
			assertion: "starts a temp-worktree planning session",
			status: "passed",
		});

		const detailedStatus = parseToolJson(
			await plugin.tool.flow_status.execute({ view: "detailed" }, { worktree }),
		);
		assert(
			detailedStatus.status === "planning",
			"flow_status did not report planning after plan start.",
		);
		assert(
			detailedStatus.session?.goal === "OpenCode smoke automation",
			"flow_status did not expose the smoke goal.",
		);
		evidence.runtimeSmoke.push({
			tool: "flow_status",
			assertion: "planning after plan start",
			status: "passed",
		});

		const history = parseToolJson(
			await plugin.tool.flow_history.execute({}, { worktree }),
		);
		const entries = [
			history.history?.active,
			...(history.history?.stored ?? []),
			...(history.history?.completed ?? []),
		].filter(Boolean);
		assert(
			entries.some((entry) => entry.goal === "OpenCode smoke automation"),
			"flow_history did not expose the smoke session.",
		);
		evidence.runtimeSmoke.push({
			tool: "flow_history",
			assertion: "includes smoke session",
			status: "passed",
		});

		evidence.workspaceIsolation.repoRootFlowExistedAfter = existsSync(
			evidence.workspaceIsolation.repoRootFlowPath,
		);

		run("bash", [uninstallScriptPath], {
			env: { ...process.env, HOME: homeDir },
			cwd: worktree,
		});
		evidence.releaseInstall.uninstalled = true;
		assert(
			!existsSync(evidence.releaseInstall.pluginPath),
			"Release uninstall did not remove the canonical plugin path.",
		);
		for (const name of generatedSkillNames) {
			assert(
				!existsSync(
					join(homeDir, ".config", "opencode", "skills", name, "SKILL.md"),
				),
				`Release uninstall did not remove ${name}.`,
			);
		}

		evidence.status = "passed";
		writeJson(options.jsonPath, evidence);
		writeSummary(options.summaryPath, evidence);
		console.log(JSON.stringify(evidence, null, 2));
		return evidence;
	} catch (error) {
		evidence.status = "failed";
		evidence.failure = {
			message: error instanceof Error ? error.message : String(error),
		};
		writeJson(options.jsonPath, evidence);
		writeSummary(options.summaryPath, evidence);
		throw error;
	} finally {
		if (options.keepTemp) {
			console.error(`Kept temp directory: ${tempRoot}`);
		} else {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	}
}

try {
	await runSmoke(parseArgs(process.argv.slice(2)));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
