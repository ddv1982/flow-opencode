import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	assertFlowSkillBundleCanInstall,
	assertFlowSkillBundleCanUninstall,
	installFlowSkillBundle,
	restoreFlowSkillBundleSnapshot,
	snapshotFlowSkillBundle,
	uninstallFlowSkillBundle,
} from "./adapters/opencode/skill-bundle";

export const FLOW_PLUGIN_FILENAME = "flow.js";
export const FLOW_PLUGIN_OWNERSHIP_HEADER =
	"// Managed by flow-opencode install/uninstall\n";
const CANONICAL_OPENCODE_PLUGIN_DIRECTORY = [
	".config",
	"opencode",
	"plugins",
] as const;
export const INSTALL_USAGE = `Install the built Flow plugin and generated Flow skills.

Usage:
  bun run install:opencode [--project <path>] [--help]

Options:
  --project <path> Install generated project-local Flow skills into this workspace (default: cwd)
  --help           Show this message`;

export const UNINSTALL_USAGE = `Remove the canonical Flow plugin slot and intact generated Flow skills.

Usage:
  bun run uninstall:opencode [--project <path>] [--help]

Options:
  --project <path> Remove generated project-local Flow skills from this workspace (default: cwd)
  --help           Show this message`;

export interface ResolveInstallTargetOptions {
	homeDir?: string;
	filename?: string;
}

export interface InstallBuiltPluginOptions {
	sourceFile: string;
	destinationFile: string;
	logger?: (message: string) => void;
}

export interface InstallCommandDependencies {
	build?: () => Promise<void>;
	cwd?: string;
	homeDir?: string;
	logger?: (message: string) => void;
	projectRoot?: string;
	sourceFile?: string;
}

type ParsedLifecycleOptions = {
	projectRoot?: string;
	showHelp: boolean;
};

type PluginSnapshot = {
	destinationFile: string;
	existing: string | null;
};

function parseLifecycleOptions(
	argv: string[],
	usage: string,
): ParsedLifecycleOptions {
	let projectRoot: string | undefined;
	let showHelp = false;

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help") {
			showHelp = true;
			continue;
		}
		if (argument === "--project") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`Missing value for --project\n\n${usage}`);
			}
			projectRoot = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}\n\n${usage}`);
	}

	return projectRoot === undefined ? { showHelp } : { projectRoot, showHelp };
}

export function resolveInstallTarget({
	homeDir = homedir(),
	filename = FLOW_PLUGIN_FILENAME,
}: ResolveInstallTargetOptions): string {
	return join(homeDir, ...CANONICAL_OPENCODE_PLUGIN_DIRECTORY, filename);
}

export function writeStdoutLine(message: string): void {
	process.stdout.write(`${message}\n`);
}

export function writeStderrLine(message: string): void {
	process.stderr.write(`${message}\n`);
}

export async function installBuiltPlugin({
	sourceFile,
	destinationFile,
	logger = writeStdoutLine,
}: InstallBuiltPluginOptions): Promise<string> {
	await assertSourceFileExists(sourceFile);
	await assertPluginDestinationCanInstall(destinationFile);
	await mkdir(dirname(destinationFile), { recursive: true });

	const pluginContent = await readFile(sourceFile, "utf8");
	const managedContent = pluginContent.startsWith(FLOW_PLUGIN_OWNERSHIP_HEADER)
		? pluginContent
		: `${FLOW_PLUGIN_OWNERSHIP_HEADER}${pluginContent}`;
	await writeFile(destinationFile, managedContent, "utf8");

	logger(`Installed Flow plugin to ${destinationFile}`);

	return destinationFile;
}

export async function runInstallCommand(
	argv: string[],
	{
		build = buildPlugin,
		cwd = process.cwd(),
		homeDir,
		logger = writeStdoutLine,
		projectRoot = cwd,
		sourceFile,
	}: InstallCommandDependencies = {},
): Promise<string | undefined> {
	const options = parseLifecycleOptions(argv, INSTALL_USAGE);
	if (options.showHelp) {
		logger(INSTALL_USAGE);
		return;
	}

	const resolvedProjectRoot = options.projectRoot
		? resolveFromCwd(cwd, options.projectRoot)
		: projectRoot;
	const resolvedSourceFile = sourceFile
		? resolveFromCwd(cwd, sourceFile)
		: join(cwd, "dist", "index.js");
	const destinationFile = resolveInstallTarget(homeDir ? { homeDir } : {});

	await assertFlowSkillBundleCanInstall({ projectRoot: resolvedProjectRoot });
	await assertPluginDestinationCanInstall(destinationFile);
	await build();
	await assertSourceFileExists(resolvedSourceFile);

	const pluginSnapshot = await snapshotPlugin(destinationFile);
	const skillSnapshot = await snapshotFlowSkillBundle({
		projectRoot: resolvedProjectRoot,
	});

	try {
		const installedPath = await installBuiltPlugin({
			sourceFile: resolvedSourceFile,
			destinationFile,
			logger,
		});
		await installFlowSkillBundle({ projectRoot: resolvedProjectRoot, logger });
		return installedPath;
	} catch (error) {
		await restoreFlowSkillBundleSnapshot(skillSnapshot);
		await restorePluginSnapshot(pluginSnapshot);
		throw error;
	}
}

export async function runUninstallCommand(
	argv: string[],
	{
		cwd = process.cwd(),
		homeDir,
		logger = writeStdoutLine,
		projectRoot = cwd,
	}: Pick<
		InstallCommandDependencies,
		"cwd" | "homeDir" | "logger" | "projectRoot"
	> = {},
): Promise<string | undefined> {
	const options = parseLifecycleOptions(argv, UNINSTALL_USAGE);
	if (options.showHelp) {
		logger(UNINSTALL_USAGE);
		return;
	}

	const resolvedProjectRoot = options.projectRoot
		? resolveFromCwd(cwd, options.projectRoot)
		: projectRoot;
	await assertFlowSkillBundleCanUninstall({ projectRoot: resolvedProjectRoot });

	const destinationFile = resolveInstallTarget(homeDir ? { homeDir } : {});
	const pluginSnapshot = await snapshotPlugin(destinationFile);
	const skillSnapshot = await snapshotFlowSkillBundle({
		projectRoot: resolvedProjectRoot,
	});

	try {
		await uninstallFlowSkillBundle({
			projectRoot: resolvedProjectRoot,
			logger,
		});
		const removedPath = await removeInstalledPluginIfPresent(
			destinationFile,
			logger,
		);
		return removedPath;
	} catch (error) {
		await restoreFlowSkillBundleSnapshot(skillSnapshot);
		await restorePluginSnapshot(pluginSnapshot);
		throw error;
	}
}

async function snapshotPlugin(
	destinationFile: string,
): Promise<PluginSnapshot> {
	return {
		destinationFile,
		existing: await readOptionalFile(destinationFile),
	};
}

async function restorePluginSnapshot({
	destinationFile,
	existing,
}: PluginSnapshot): Promise<void> {
	if (existing === null) {
		await rm(destinationFile, { force: true });
		return;
	}
	await mkdir(dirname(destinationFile), { recursive: true });
	await writeFile(destinationFile, existing, "utf8");
}

async function removeInstalledPluginIfPresent(
	destinationFile: string,
	logger: (message: string) => void,
): Promise<string | undefined> {
	const existing = await readOptionalFile(destinationFile);
	if (existing === null) {
		return undefined;
	}
	await rm(destinationFile, { force: true });
	logger(`Removed Flow plugin from ${destinationFile}`);
	return destinationFile;
}

async function assertPluginDestinationCanInstall(
	destinationFile: string,
): Promise<void> {
	const existing = await readOptionalFile(destinationFile);
	if (existing === null || isFlowOwnedPlugin(existing)) {
		return;
	}
	throw new Error(
		`Refusing to overwrite user-managed OpenCode plugin at ${destinationFile}.`,
	);
}

function isFlowOwnedPlugin(content: string): boolean {
	return content.startsWith(FLOW_PLUGIN_OWNERSHIP_HEADER);
}

async function readOptionalFile(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function assertSourceFileExists(sourceFile: string): Promise<void> {
	try {
		await access(sourceFile, constants.F_OK);
	} catch {
		throw new Error(
			`Build artifact not found at ${sourceFile}. Run \`bun run build\` first.`,
		);
	}
}

async function buildPlugin(): Promise<void> {
	const buildProcess = Bun.spawn({
		cmd: ["bun", "run", "build"],
		stdout: "inherit",
		stderr: "inherit",
	});

	const exitCode = await buildProcess.exited;

	if (exitCode !== 0) {
		throw new Error("Failed to build Flow before installation.");
	}
}

function resolveFromCwd(cwd: string, target: string): string {
	return resolve(cwd, target);
}
