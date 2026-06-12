#!/usr/bin/env node

// npm distribution smoke: packs the package exactly as it would be published,
// extracts the tarball, vendors runtime dependencies the way OpenCode's
// Bun-based plugin install would resolve them, then exercises plugin startup
// (skill sync, pre-npm-copy warning), the tool surface, and the uninstall CLI.

import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The packed plugin schedules a best-effort npm update check at startup;
// keep the smoke deterministic and network-free.
process.env.FLOW_DISABLE_UPDATE_CHECK = "1";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageJson = JSON.parse(
	readFileSync(join(projectRoot, "package.json"), "utf8"),
);

// The seven canonical tools are the whole registered surface as of v3.1;
// extraToolCount asserts nothing else sneaks in.
const CANONICAL_TOOL_NAMES = [
	"flow_status",
	"flow_plan_save",
	"flow_plan_approve",
	"flow_run_start",
	"flow_feature_complete",
	"flow_review_record",
	"flow_session",
];

function parseArgs(argv) {
	const options = { tarball: null, evidenceDir: null };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--tarball") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--tarball requires a path.");
			}
			options.tarball = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--evidence-dir") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--evidence-dir requires a path.");
			}
			options.evidenceDir = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function run(cmd, args, options = {}) {
	const result = spawnSync(cmd, args, {
		encoding: "utf8",
		...options,
	});
	if (result.status !== 0) {
		throw new Error(
			`${cmd} ${args.join(" ")} failed (${result.status}): ${result.stderr}`,
		);
	}
	return result;
}

function packTarball(destination) {
	for (const artifact of ["index.js", "cli.js"]) {
		if (!existsSync(join(projectRoot, "dist", artifact))) {
			throw new Error(
				`dist/${artifact} is missing. Run \`bun run build\` before the smoke.`,
			);
		}
	}
	run("bun", ["pm", "pack", "--destination", destination], {
		cwd: projectRoot,
	});
	const tarball = readdirSync(destination).find((name) =>
		name.endsWith(".tgz"),
	);
	if (!tarball) {
		throw new Error("bun pm pack did not produce a tarball.");
	}
	return join(destination, tarball);
}

function vendorRuntimeDependencies(packageDir) {
	// OpenCode installs npm plugins with Bun and resolves their dependencies;
	// vendor zod (a real dependency) and a minimal @opencode-ai/plugin peer mock.
	cpSync(
		join(projectRoot, "node_modules", "zod"),
		join(packageDir, "node_modules", "zod"),
		{ recursive: true, dereference: true },
	);
	const peerDir = join(packageDir, "node_modules", "@opencode-ai", "plugin");
	mkdirSync(peerDir, { recursive: true });
	writeFileSync(
		join(peerDir, "package.json"),
		JSON.stringify(
			{
				name: "@opencode-ai/plugin",
				version: "0.0.0-smoke",
				type: "module",
				exports: "./index.js",
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(peerDir, "index.js"),
		[
			"import { createRequire } from 'node:module';",
			`const require = createRequire(${JSON.stringify(join(projectRoot, "package.json"))});`,
			"const zodModule = require('zod');",
			"const z = zodModule.z ?? zodModule;",
			"export function tool(definition) {",
			"  return definition;",
			"}",
			"tool.schema = z;",
		].join("\n"),
	);
}

async function withHome(homeDir, fn) {
	const originalHome = process.env.HOME;
	process.env.HOME = homeDir;
	try {
		return await fn();
	} finally {
		process.env.HOME = originalHome;
	}
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const tempRoot = mkdtempSync(join(tmpdir(), "flow-npm-smoke-"));
	try {
		const tarball = options.tarball ?? packTarball(tempRoot);

		const installDir = join(tempRoot, "install");
		mkdirSync(installDir, { recursive: true });
		run("tar", ["-xzf", tarball, "-C", installDir]);
		const packageDir = join(installDir, "package");

		const packedManifest = JSON.parse(
			readFileSync(join(packageDir, "package.json"), "utf8"),
		);
		assert(
			packedManifest.name === "opencode-plugin-flow",
			"Packed package has the wrong name.",
		);
		assert(
			existsSync(join(packageDir, "dist", "index.js")),
			"Tarball is missing dist/index.js.",
		);
		assert(
			existsSync(join(packageDir, "dist", "cli.js")),
			"Tarball is missing dist/cli.js.",
		);
		assert(
			!existsSync(join(packageDir, "src")),
			"Tarball unexpectedly contains src/.",
		);

		vendorRuntimeDependencies(packageDir);

		// OpenCode caches plugin installs per spec string and never re-resolves,
		// so the README recommends an exact-version pin; keep it current with
		// every release by failing the gate when it drifts from package.json.
		const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
		const readmePin = readme.match(/"opencode-plugin-flow@(\d+\.\d+\.\d+)"/);
		assert(
			readmePin !== null,
			"README.md install snippet no longer pins an exact opencode-plugin-flow version.",
		);
		assert(
			readmePin[1] === packageJson.version,
			`README.md pins opencode-plugin-flow@${readmePin[1]} but package.json is ${packageJson.version}; bump the README install snippet.`,
		);

		const homeDir = join(tempRoot, "home");
		const worktree = join(tempRoot, "worktree");
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(worktree, { recursive: true });

		const logs = [];
		const pluginModule = await import(
			`file://${join(packageDir, "dist", "index.js")}`
		);
		const plugin = await withHome(homeDir, () =>
			pluginModule.default({
				worktree,
				client: { app: { log: (entry) => logs.push(entry) } },
			}),
		);

		const skillsRoot = join(homeDir, ".config", "opencode", "skills");
		const syncedSkills = existsSync(skillsRoot)
			? readdirSync(skillsRoot).sort()
			: [];
		assert(syncedSkills.length > 0, "Plugin startup did not sync any skills.");
		for (const name of syncedSkills) {
			assert(
				existsSync(join(skillsRoot, name, ".flow-skill-version")),
				`Synced skill ${name} is missing its marker file.`,
			);
		}
		const commandsRoot = join(homeDir, ".config", "opencode", "commands");
		const syncedCommands = existsSync(commandsRoot)
			? readdirSync(commandsRoot)
					.filter((name) => name.endsWith(".md"))
					.sort()
			: [];
		assert(
			syncedCommands.includes("flow-auto.md"),
			"Plugin startup did not sync /flow-auto as a command file.",
		);
		for (const file of syncedCommands) {
			const commandName = file.slice(0, -".md".length);
			assert(
				existsSync(join(commandsRoot, `.${commandName}.flow-version`)),
				`Synced command ${file} is missing its marker file.`,
			);
		}
		const agentsRoot = join(homeDir, ".config", "opencode", "agents");
		const syncedAgents = existsSync(agentsRoot)
			? readdirSync(agentsRoot)
					.filter((name) => name.endsWith(".md"))
					.sort()
			: [];
		assert(
			syncedAgents.includes("flow-reviewer.md"),
			"Plugin startup did not sync flow-reviewer as an agent file.",
		);
		for (const file of syncedAgents) {
			const agentName = file.slice(0, -".md".length);
			assert(
				existsSync(join(agentsRoot, `.${agentName}.flow-version`)),
				`Synced agent ${file} is missing its marker file.`,
			);
		}

		const config = { agent: {}, command: {} };
		await plugin.config(config);

		const planSave = JSON.parse(
			await plugin.tool.flow_plan_save.execute(
				{ goal: "npm smoke" },
				{ worktree },
			),
		);
		assert(planSave.status === "ok", "flow_plan_save failed in npm smoke.");
		const status = JSON.parse(
			await plugin.tool.flow_status.execute({}, { worktree }),
		);
		assert(
			status.status === "planning" && status.session?.goal === "npm smoke",
			"flow_status did not report the smoke session.",
		);

		// Pre-npm double-load warning: a stale pre-npm plugin copy must be flagged.
		const preNpmHome = join(tempRoot, "pre-npm-home");
		const preNpmPluginDir = join(preNpmHome, ".config", "opencode", "plugins");
		mkdirSync(preNpmPluginDir, { recursive: true });
		writeFileSync(
			join(preNpmPluginDir, "flow.js"),
			"// Managed by flow-opencode install/uninstall\nexport default 'stale';\n",
		);
		const preNpmLogs = [];
		await withHome(preNpmHome, () =>
			pluginModule.default({
				worktree,
				client: { app: { log: (entry) => preNpmLogs.push(entry) } },
			}),
		);
		assert(
			preNpmLogs.some(
				(entry) =>
					entry.level === "warn" &&
					String(entry.message).includes("Stale pre-npm Flow plugin copy"),
			),
			"Plugin startup did not warn about the pre-npm plugin copy.",
		);

		const uninstall = spawnSync(
			"node",
			[join(packageDir, "dist", "cli.js"), "uninstall"],
			{
				encoding: "utf8",
				env: { ...process.env, HOME: homeDir },
			},
		);
		assert(uninstall.status === 0, `uninstall CLI failed: ${uninstall.stderr}`);
		assert(
			uninstall.stdout.includes("opencode-plugin-flow"),
			"uninstall CLI did not print the opencode.json cleanup step.",
		);
		const remainingSkills = existsSync(skillsRoot)
			? readdirSync(skillsRoot).filter((name) => name.startsWith("flow"))
			: [];
		assert(
			remainingSkills.length === 0,
			`uninstall CLI left Flow skills behind: ${remainingSkills.join(", ")}`,
		);
		const remainingCommands = existsSync(commandsRoot)
			? readdirSync(commandsRoot).filter((name) => name.startsWith("flow"))
			: [];
		assert(
			remainingCommands.length === 0,
			`uninstall CLI left Flow commands behind: ${remainingCommands.join(", ")}`,
		);
		const remainingAgents = existsSync(agentsRoot)
			? readdirSync(agentsRoot).filter((name) => name.startsWith("flow"))
			: [];
		assert(
			remainingAgents.length === 0,
			`uninstall CLI left Flow agents behind: ${remainingAgents.join(", ")}`,
		);

		const report = {
			packedVersion: packedManifest.version,
			expectedVersion: packageJson.version,
			readmePinnedVersion: readmePin[1],
			tarball,
			syncedSkills,
			syncedCommands,
			syncedAgents,
			configAgents: Object.keys(config.agent).length,
			configCommands: Object.keys(config.command).length,
			toolCount: CANONICAL_TOOL_NAMES.filter((name) => name in plugin.tool)
				.length,
			extraToolCount: Object.keys(plugin.tool).filter(
				(name) => !CANONICAL_TOOL_NAMES.includes(name),
			).length,
			startupLogCount: logs.length,
			preNpmWarningVerified: true,
			uninstallVerified: true,
		};
		assert(
			report.packedVersion === report.expectedVersion,
			"Packed version does not match package.json.",
		);

		if (options.evidenceDir) {
			mkdirSync(options.evidenceDir, { recursive: true });
			writeFileSync(
				join(options.evidenceDir, "opencode-smoke-evidence.json"),
				`${JSON.stringify(report, null, 2)}\n`,
			);
			writeFileSync(
				join(options.evidenceDir, "opencode-smoke-evidence.md"),
				[
					"# npm install smoke evidence",
					"",
					`- Packed version: ${report.packedVersion}`,
					`- Synced skills: ${report.syncedSkills.join(", ")}`,
					`- Synced commands: ${report.syncedCommands.join(", ")}`,
					`- Synced agents: ${report.syncedAgents.join(", ")}`,
					`- Tools: ${report.toolCount} canonical (no extras), agents: ${report.configAgents}, commands: ${report.configCommands}`,
					"- Pre-npm double-load warning verified",
					"- Uninstall CLI verified",
					"",
				].join("\n"),
			);
		}

		console.log(JSON.stringify(report, null, 2));
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

await main();
