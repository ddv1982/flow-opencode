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
export const INSTALL_USAGE = `Install the built Flow plugin and generated global Flow skills.

Usage:
  bun run install:opencode [--help]

Options:
  --help           Show this message`;

export const UNINSTALL_USAGE = `Remove the canonical Flow plugin slot and intact generated global Flow skills.

Usage:
  bun run uninstall:opencode [--help]

Options:
  --help           Show this message`;

interface ResolveInstallTargetOptions {
	homeDir?: string;
	filename?: string;
}

interface InstallBuiltPluginOptions {
	sourceFile: string;
	destinationFile: string;
	logger?: (message: string) => void;
}

interface InstallCommandDependencies {
	build?: () => Promise<void>;
	cwd?: string;
	homeDir?: string;
	logger?: (message: string) => void;
	sourceFile?: string;
}

type ParsedLifecycleOptions = {
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
	let showHelp = false;

	for (const argument of argv) {
		if (argument === "--help") {
			showHelp = true;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}\n\n${usage}`);
	}

	return { showHelp };
}

export function resolveInstallTarget({
	homeDir = homedir(),
	filename = FLOW_PLUGIN_FILENAME,
}: ResolveInstallTargetOptions): string {
	return join(homeDir, ...CANONICAL_OPENCODE_PLUGIN_DIRECTORY, filename);
}

function writeStdoutLine(message: string): void {
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
		sourceFile,
	}: InstallCommandDependencies = {},
): Promise<string | undefined> {
	const options = parseLifecycleOptions(argv, INSTALL_USAGE);
	if (options.showHelp) {
		logger(INSTALL_USAGE);
		return;
	}

	const skillRoot = homeDir ?? homedir();
	const resolvedSourceFile = sourceFile
		? resolveFromCwd(cwd, sourceFile)
		: join(cwd, "dist", "index.js");
	const destinationFile = resolveInstallTarget({ homeDir: skillRoot });

	await assertFlowSkillBundleCanInstall({ projectRoot: skillRoot });
	await assertPluginDestinationCanInstall(destinationFile);
	await build();
	await assertSourceFileExists(resolvedSourceFile);

	const pluginSnapshot = await snapshotPlugin(destinationFile);
	const skillSnapshot = await snapshotFlowSkillBundle({
		projectRoot: skillRoot,
	});

	try {
		const installedPath = await installBuiltPlugin({
			sourceFile: resolvedSourceFile,
			destinationFile,
			logger,
		});
		await installFlowSkillBundle({ projectRoot: skillRoot, logger });
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
		homeDir,
		logger = writeStdoutLine,
	}: Pick<InstallCommandDependencies, "homeDir" | "logger"> = {},
): Promise<string | undefined> {
	const options = parseLifecycleOptions(argv, UNINSTALL_USAGE);
	if (options.showHelp) {
		logger(UNINSTALL_USAGE);
		return;
	}

	const skillRoot = homeDir ?? homedir();
	await assertFlowSkillBundleCanUninstall({ projectRoot: skillRoot });

	const destinationFile = resolveInstallTarget({ homeDir: skillRoot });
	const pluginSnapshot = await snapshotPlugin(destinationFile);
	const skillSnapshot = await snapshotFlowSkillBundle({
		projectRoot: skillRoot,
	});

	try {
		await uninstallFlowSkillBundle({
			projectRoot: skillRoot,
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
