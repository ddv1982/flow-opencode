import { constants } from "node:fs";
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const FLOW_PLUGIN_FILENAME = "flow.js";
const CANONICAL_OPENCODE_PLUGIN_DIRECTORY = [
	".config",
	"opencode",
	"plugins",
] as const;
const LEGACY_OPENCODE_PLUGIN_DIRECTORY = [".opencode", "plugins"] as const;
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

export function resolveInstallTargets({
	homeDir = homedir(),
	filename = FLOW_PLUGIN_FILENAME,
}: ResolveInstallTargetOptions): string[] {
	return [
		join(homeDir, ...CANONICAL_OPENCODE_PLUGIN_DIRECTORY, filename),
		join(homeDir, ...LEGACY_OPENCODE_PLUGIN_DIRECTORY, filename),
	];
}

export async function installBuiltPlugin({
	sourceFile,
	destinationFile,
	logger = console.log,
}: InstallBuiltPluginOptions): Promise<string> {
	await assertSourceFileExists(sourceFile);
	await mkdir(dirname(destinationFile), { recursive: true });
	await copyFile(sourceFile, destinationFile);

	logger(`Installed Flow plugin to ${destinationFile}`);

	return destinationFile;
}

export async function runInstallCommand(
	argv: string[],
	{
		build = buildPlugin,
		cwd = process.cwd(),
		homeDir,
		logger = console.log,
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
	const [canonicalPath, legacyPath] = resolveInstallTargets(
		homeDir ? { homeDir } : {},
	);
	const destinationFile = legacyPath
		? (await pathExists(legacyPath))
			? legacyPath
			: canonicalPath
		: canonicalPath;

	if (!destinationFile) {
		return undefined;
	}

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
		logger = console.log,
	}: Pick<InstallCommandDependencies, "homeDir" | "logger"> = {},
): Promise<string | undefined> {
	if (shouldShowHelp(argv, UNINSTALL_USAGE)) {
		logger(UNINSTALL_USAGE);
		return;
	}

	const destinationFiles = resolveInstallTargets(homeDir ? { homeDir } : {});
	let removedPath: string | null = null;

	for (const destinationFile of destinationFiles) {
		if (await pathExists(destinationFile)) {
			await rm(destinationFile, { force: true });
			logger(`Removed Flow plugin from ${destinationFile}`);
			removedPath ??= destinationFile;
		}
	}

	return removedPath ?? undefined;
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

async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target, constants.F_OK);
		return true;
	} catch {
		return false;
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
