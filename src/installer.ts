import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const FLOW_PLUGIN_FILENAME = "flow.js";
export const FLOW_PLUGIN_OWNERSHIP_HEADER =
	"// Managed by flow-opencode install/uninstall\n";
const CANONICAL_OPENCODE_PLUGIN_DIRECTORY = [
	".config",
	"opencode",
	"plugins",
] as const;
export const INSTALL_USAGE = `Install the built Flow plugin into an OpenCode plugin directory.

Usage:
  bun run install:opencode

Options:
  --help            Show this message`;

export const UNINSTALL_USAGE = `Remove the installed Flow plugin from the OpenCode plugin directory.

Usage:
  bun run uninstall:opencode

Options:
  --help            Show this message`;

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
	sourceFile?: string;
}

export function shouldShowHelp(argv: string[], usage: string): boolean {
	for (const argument of argv) {
		if (argument === "--help") {
			return true;
		}
	}

	if (argv.length > 0) {
		throw new Error(`Unknown argument: ${argv[0]}\n\n${usage}`);
	}

	return false;
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
	await mkdir(dirname(destinationFile), { recursive: true });

	const existing = await readInstalledPluginMarker(destinationFile);
	if (existing.exists && !existing.managedByFlow) {
		throw new Error(
			`Refusing to overwrite existing non-Flow plugin at ${destinationFile}. Remove it manually first.`,
		);
	}

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
	if (shouldShowHelp(argv, INSTALL_USAGE)) {
		logger(INSTALL_USAGE);
		return;
	}

	await build();

	const resolvedSourceFile = sourceFile
		? resolveFromCwd(cwd, sourceFile)
		: join(cwd, "dist", "index.js");
	const destinationFile = resolveInstallTarget(homeDir ? { homeDir } : {});

	return installBuiltPlugin({
		sourceFile: resolvedSourceFile,
		destinationFile,
		logger,
	});
}

export async function runUninstallCommand(
	argv: string[],
	{
		homeDir,
		logger = writeStdoutLine,
	}: Pick<InstallCommandDependencies, "homeDir" | "logger"> = {},
): Promise<string | undefined> {
	if (shouldShowHelp(argv, UNINSTALL_USAGE)) {
		logger(UNINSTALL_USAGE);
		return;
	}

	const destinationFile = resolveInstallTarget(homeDir ? { homeDir } : {});

	const existing = await readInstalledPluginMarker(destinationFile);
	if (existing.exists) {
		if (!existing.managedByFlow) {
			throw new Error(
				`Refusing to remove unowned plugin at ${destinationFile}. Only Flow-managed files can be uninstalled.`,
			);
		}
		await rm(destinationFile, { force: true });
		logger(`Removed Flow plugin from ${destinationFile}`);
		return destinationFile;
	}

	return undefined;
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

async function readInstalledPluginMarker(target: string): Promise<{
	exists: boolean;
	managedByFlow: boolean;
}> {
	try {
		const content = await readFile(target, "utf8");
		return {
			exists: true,
			managedByFlow: isManagedByFlowPluginContent(content),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { exists: false, managedByFlow: false };
		}
		throw error;
	}
}

function isManagedByFlowPluginContent(content: string): boolean {
	return content.startsWith(FLOW_PLUGIN_OWNERSHIP_HEADER);
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
