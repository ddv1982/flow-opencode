// Golden-transcript eval runner for the Flow driving loop.
//
// Manual lane: needs the opencode CLI on PATH and a configured model key, so it
// is never part of `bun run check` or default CI. Per scenario it copies a
// fixture repo to a temp workspace, loads the Flow plugin FROM THIS CHECKOUT
// (the built dist/index.js placed in the workspace's `.opencode/plugins/`,
// mirroring the local-build loading that scripts/cross-area/opencode-smoke.mjs
// exercises in-process), runs `opencode run "<prompt>"` headless with a
// timeout, then asserts observable outcomes from the persisted `.flow/**`
// state parsed with the runtime's own zod schema.
//
// Usage:
//   bun run evals:golden                       # run every scenario
//   bun run evals/golden/runner.ts --list
//   bun run evals/golden/runner.ts --scenario <name>
//   bun run evals/golden/runner.ts --dry-run   # prep workspaces, print commands
//   bun run evals/golden/runner.ts --model <provider/model>
//   bun run evals/golden/runner.ts --keep      # keep workspaces of passing runs

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
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionSchema } from "../../src/runtime/schema";
import {
	type FlowStateSnapshot,
	GOLDEN_SCENARIOS,
	type GoldenScenario,
	type SessionLocation,
	type SessionRecord,
} from "./scenarios";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixturesRoot = join(projectRoot, "evals", "golden", "fixtures");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_LOCATIONS: readonly SessionLocation[] = [
	"active",
	"stored",
	"completed",
];

function print(line: string): void {
	process.stdout.write(`${line}\n`);
}

type CliOptions = {
	list: boolean;
	dryRun: boolean;
	keep: boolean;
	scenario: string | null;
	model: string | null;
};

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		list: false,
		dryRun: false,
		keep: false,
		scenario: null,
		model: null,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--list") {
			options.list = true;
			continue;
		}
		if (arg === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		if (arg === "--keep") {
			options.keep = true;
			continue;
		}
		if (arg === "--scenario" || arg === "--model") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`${arg} requires a value.`);
			}
			if (arg === "--scenario") {
				options.scenario = value;
			} else {
				options.model = value;
			}
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function ensureDistBuilt(): void {
	if (!existsSync(join(projectRoot, "dist", "index.js"))) {
		throw new Error(
			"dist/index.js is missing. Run `bun run build` before the golden evals.",
		);
	}
}

function ensureOpencodeCli(): void {
	const result = spawnSync("opencode", ["--version"], { encoding: "utf8" });
	if (result.error || result.status !== 0) {
		throw new Error(
			"The `opencode` CLI is not available on PATH. Install it and configure a model key (see evals/golden/README.md).",
		);
	}
}

function warnAboutStaleGlobalPlugin(): void {
	const staleCopy = join(
		homedir(),
		".config",
		"opencode",
		"plugins",
		"flow.js",
	);
	if (existsSync(staleCopy)) {
		print(
			`WARNING: ${staleCopy} exists. That global pre-npm Flow copy loads in every opencode run and will double-load Flow next to the checkout build, corrupting eval results. Remove it first (\`bunx opencode-plugin-flow uninstall\`).`,
		);
	}
}

function pluginDependencyVersions(): Record<string, string> {
	const manifest = JSON.parse(
		readFileSync(join(projectRoot, "package.json"), "utf8"),
	) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const zodVersion = manifest.dependencies?.zod;
	const sdkVersion = manifest.devDependencies?.["@opencode-ai/plugin"];
	if (!zodVersion || !sdkVersion) {
		throw new Error(
			"Could not resolve zod / @opencode-ai/plugin versions from package.json.",
		);
	}
	return { "@opencode-ai/plugin": sdkVersion, zod: zodVersion };
}

// The built plugin (dist/index.js) marks zod and @opencode-ai/plugin as
// externals. OpenCode resolves dependencies of local plugins from a
// package.json in the config directory (it runs `bun install` there at
// startup); writing `.opencode/package.json` is the documented way to give a
// local plugin file its runtime dependencies.
function installFlowPluginFromCheckout(workspace: string): void {
	const configDir = join(workspace, ".opencode");
	const pluginsDir = join(configDir, "plugins");
	mkdirSync(pluginsDir, { recursive: true });
	cpSync(join(projectRoot, "dist", "index.js"), join(pluginsDir, "flow.js"));
	writeFileSync(
		join(configDir, "package.json"),
		`${JSON.stringify({ dependencies: pluginDependencyVersions() }, null, "\t")}\n`,
	);

	// Project-level skills are discovered from disk at startup; the plugin's
	// own global skill sync may only be discovered on the *next* OpenCode
	// start, so seed the checkout's skills as project skills instead.
	const skillsSource = join(projectRoot, "skills");
	for (const entry of readdirSync(skillsSource, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		cpSync(
			join(skillsSource, entry.name),
			join(configDir, "skills", entry.name),
			{
				recursive: true,
			},
		);
	}
}

function runGit(workspace: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed in ${workspace}: ${result.stderr}`,
		);
	}
}

function prepareWorkspace(scenario: GoldenScenario): string {
	const fixtureDir = join(fixturesRoot, scenario.fixture);
	if (!existsSync(fixtureDir)) {
		throw new Error(
			`Scenario '${scenario.name}' references missing fixture '${scenario.fixture}'.`,
		);
	}
	const workspace = mkdtempSync(
		join(tmpdir(), `flow-golden-${scenario.name}-`),
	);
	cpSync(fixtureDir, workspace, { recursive: true });
	installFlowPluginFromCheckout(workspace);
	writeFileSync(
		join(workspace, "opencode.json"),
		`${JSON.stringify(
			{
				$schema: "https://opencode.ai/config.json",
				autoupdate: false,
				share: "disabled",
				snapshot: false,
			},
			null,
			"\t",
		)}\n`,
	);

	// A git repo keeps OpenCode from walking up to parent configs and gives the
	// plugin a stable worktree root.
	runGit(workspace, ["init", "--quiet"]);
	runGit(workspace, ["add", "-A"]);
	runGit(workspace, [
		"-c",
		"user.name=Flow Golden Evals",
		"-c",
		"user.email=golden-evals@flow.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"fixture baseline",
	]);

	// Fail fast if a pre-seeded .flow/** fixture state does not parse.
	loadFlowStateSnapshot(workspace);
	return workspace;
}

function readSessionsUnder(
	workspace: string,
	location: SessionLocation,
): SessionRecord[] {
	const locationDir = join(workspace, ".flow", location);
	if (!existsSync(locationDir)) {
		return [];
	}
	const records: SessionRecord[] = [];
	for (const entry of readdirSync(locationDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const sessionPath = join(locationDir, entry.name, "session.json");
		if (!existsSync(sessionPath)) {
			throw new Error(
				`Malformed .flow state: ${join(".flow", location, entry.name)} has no session.json.`,
			);
		}
		const session = SessionSchema.parse(
			JSON.parse(readFileSync(sessionPath, "utf8")),
		);
		records.push({ dirName: entry.name, location, session });
	}
	return records;
}

function loadFlowStateSnapshot(workspace: string): FlowStateSnapshot {
	const snapshot: FlowStateSnapshot = {
		workspace,
		active: [],
		stored: [],
		completed: [],
	};
	for (const location of SESSION_LOCATIONS) {
		snapshot[location] = readSessionsUnder(workspace, location);
	}
	return snapshot;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function opencodeArgs(
	scenario: GoldenScenario,
	model: string | null,
): string[] {
	return ["run", ...(model ? ["--model", model] : []), scenario.prompt];
}

function tail(text: string, lines: number): string {
	return text.trim().split("\n").slice(-lines).join("\n");
}

type ScenarioResult = {
	name: string;
	status: "passed" | "failed" | "dry-run";
	durationMs: number;
	detail: string | null;
};

async function runScenario(
	scenario: GoldenScenario,
	options: CliOptions,
): Promise<ScenarioResult> {
	const startedAt = Date.now();
	let workspace: string | null = null;
	const fail = (detail: string): ScenarioResult => ({
		name: scenario.name,
		status: "failed",
		durationMs: Date.now() - startedAt,
		detail: workspace ? `${detail}\n  workspace kept at ${workspace}` : detail,
	});

	try {
		workspace = prepareWorkspace(scenario);
		const args = opencodeArgs(scenario, options.model);
		const command = `cd ${shellQuote(workspace)} && opencode ${args.map(shellQuote).join(" ")}`;

		if (options.dryRun) {
			print(`[dry-run] ${scenario.name}`);
			print(`  workspace: ${workspace}`);
			print(`  command:   ${command}`);
			return {
				name: scenario.name,
				status: "dry-run",
				durationMs: Date.now() - startedAt,
				detail: null,
			};
		}

		// Pre-install the local plugin's dependencies so a network/cache problem
		// fails loudly here instead of as an opaque opencode startup error.
		const install = spawnSync("bun", ["install", "--silent"], {
			cwd: join(workspace, ".opencode"),
			encoding: "utf8",
		});
		if (install.status !== 0) {
			return fail(
				`bun install for the local plugin dependencies failed: ${tail(install.stderr ?? "", 5)}`,
			);
		}

		const timeoutMs = scenario.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const result = spawnSync("opencode", args, {
			cwd: workspace,
			encoding: "utf8",
			timeout: timeoutMs,
			killSignal: "SIGKILL",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (result.error) {
			const code = (result.error as NodeJS.ErrnoException).code;
			if (code === "ETIMEDOUT") {
				return fail(`opencode run timed out after ${timeoutMs / 1000}s.`);
			}
			return fail(`opencode run failed to start: ${result.error.message}`);
		}
		if (result.status !== 0) {
			return fail(
				`opencode run exited with ${result.status}.\n  stderr tail:\n${tail(result.stderr ?? "", 12)}`,
			);
		}

		const snapshot = loadFlowStateSnapshot(workspace);
		await scenario.assert(snapshot);
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}

	if (workspace && !options.keep) {
		rmSync(workspace, { recursive: true, force: true });
		workspace = null;
	} else if (workspace) {
		print(`[keep] ${scenario.name}: workspace kept at ${workspace}`);
	}
	return {
		name: scenario.name,
		status: "passed",
		durationMs: Date.now() - startedAt,
		detail: null,
	};
}

function printList(): void {
	const nameWidth = Math.max(
		...GOLDEN_SCENARIOS.map((scenario) => scenario.name.length),
	);
	const fixtureWidth = Math.max(
		...GOLDEN_SCENARIOS.map((scenario) => scenario.fixture.length),
	);
	for (const scenario of GOLDEN_SCENARIOS) {
		print(
			`${scenario.name.padEnd(nameWidth)}  ${scenario.fixture.padEnd(fixtureWidth)}  ${scenario.summary}`,
		);
	}
}

function printResults(results: ScenarioResult[]): void {
	const nameWidth = Math.max(...results.map((result) => result.name.length));
	print("");
	print(`${"scenario".padEnd(nameWidth)}  ${"result".padEnd(7)}  duration`);
	print(`${"-".repeat(nameWidth)}  ${"-".repeat(7)}  --------`);
	for (const result of results) {
		const seconds = `${Math.round(result.durationMs / 1000)}s`;
		print(
			`${result.name.padEnd(nameWidth)}  ${result.status.padEnd(7)}  ${seconds}`,
		);
	}
	for (const result of results) {
		if (result.detail) {
			print("");
			print(`FAIL ${result.name}:`);
			print(`  ${result.detail.replaceAll("\n", "\n  ")}`);
		}
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));

	if (options.list) {
		printList();
		return;
	}

	let scenarios: GoldenScenario[] = [...GOLDEN_SCENARIOS];
	if (options.scenario) {
		scenarios = scenarios.filter(
			(scenario) => scenario.name === options.scenario,
		);
		if (scenarios.length === 0) {
			throw new Error(
				`Unknown scenario '${options.scenario}'. Use --list to see scenario names.`,
			);
		}
	}

	ensureDistBuilt();
	if (!options.dryRun) {
		ensureOpencodeCli();
		warnAboutStaleGlobalPlugin();
	}

	const results: ScenarioResult[] = [];
	for (const scenario of scenarios) {
		print(
			`${options.dryRun ? "Preparing" : "Running"} scenario: ${scenario.name}`,
		);
		results.push(await runScenario(scenario, options));
	}

	printResults(results);
	if (results.some((result) => result.status === "failed")) {
		process.exitCode = 1;
	}
}

await main();
