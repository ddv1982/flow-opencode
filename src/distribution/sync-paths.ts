import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	FLOW_AGENTS_DIRECTORY,
	FLOW_COMMANDS_DIRECTORY,
	FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER,
	FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH,
	FLOW_SKILLS_DIRECTORY,
} from "./skill-markers";
import type { PreNpmFlowPluginCopy } from "./sync-types";
import { readOptionalFile } from "./sync-utils";

export function resolveFlowHomeDir(): string {
	return process.env.HOME ?? homedir();
}

/**
 * In the published npm layout, package.json sits one directory above the
 * bundled dist/index.js. Reading it at runtime keeps the version out of the
 * bundle and immune to release-time drift; sandboxes without a version field
 * fall back to a sentinel.
 */
export function resolveFlowPluginVersion(): string {
	try {
		const require = createRequire(import.meta.url);
		const manifest = require("../package.json") as { version?: string };
		return manifest.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

export function resolveFlowSkillsRoot(homeDir: string): string {
	return join(homeDir, FLOW_SKILLS_DIRECTORY);
}

export function resolveFlowCommandsRoot(homeDir: string): string {
	return join(homeDir, FLOW_COMMANDS_DIRECTORY);
}

export function resolveFlowAgentsRoot(homeDir: string): string {
	return join(homeDir, FLOW_AGENTS_DIRECTORY);
}

export function resolveSkillFilePath(
	folder: string,
	relativePath: string,
): string {
	return join(folder, ...relativePath.split("/"));
}

export async function detectPreNpmFlowPlugin(
	homeDir = resolveFlowHomeDir(),
): Promise<PreNpmFlowPluginCopy | null> {
	const path = join(homeDir, FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH);
	const content = await readOptionalFile(path);
	if (content === null) {
		return null;
	}
	return {
		path,
		flowOwned: content.startsWith(FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER),
	};
}
