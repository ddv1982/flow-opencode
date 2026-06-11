import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	FLOW_SKILL_SPECS,
	renderFlowSkillDocument,
} from "../prompts/generated/skill-docs";
import {
	FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER,
	FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH,
	FLOW_SKILL_BACKUP_FILENAME,
	FLOW_SKILL_MARKER_FILENAME,
	FLOW_SKILLS_DIRECTORY,
	inspectFlowSkillDocument,
	parseFlowSkillFolderMarker,
	renderFlowSkillFolderMarker,
	sha256,
} from "./skill-markers";

type FlowSkillSyncAction =
	| "installed"
	| "updated"
	| "updated_with_backup"
	| "unchanged"
	| "skipped_foreign";

type FlowSkillSyncResult = {
	name: string;
	action: FlowSkillSyncAction;
	skillPath: string;
};

type FlowSkillSyncOptions = {
	homeDir?: string;
	version: string;
};

type FlowSkillSyncStateEntry = {
	name: string;
	state: "synced" | "stale" | "missing" | "foreign";
	skillPath: string;
};

type PreNpmFlowPluginCopy = {
	path: string;
	flowOwned: boolean;
};

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

function resolveFlowSkillsRoot(homeDir: string): string {
	return join(homeDir, FLOW_SKILLS_DIRECTORY);
}

/**
 * Idempotent startup sync of the bundled Flow skills into the global OpenCode
 * skill directory. Folder ownership is tracked with a plugin-owned marker file
 * (`.flow-skill-version`); pre-npm hash-locked installs (pre-npm distribution)
 * are recognized through their in-document marker and adopted. Folders without
 * either marker belong to the user (or another plugin) and are never touched.
 * A user-edited SKILL.md in a Flow-owned folder is backed up to
 * `SKILL.md.backup` before being replaced, never refused or silently lost.
 */
export async function syncFlowSkills({
	homeDir = resolveFlowHomeDir(),
	version,
}: FlowSkillSyncOptions): Promise<FlowSkillSyncResult[]> {
	const results: FlowSkillSyncResult[] = [];
	for (const skill of FLOW_SKILL_SPECS) {
		const folder = join(resolveFlowSkillsRoot(homeDir), skill.name);
		const skillPath = join(folder, "SKILL.md");
		const markerPath = join(folder, FLOW_SKILL_MARKER_FILENAME);
		const desired = renderFlowSkillDocument(skill);
		const desiredMarker = renderFlowSkillFolderMarker({
			version,
			hash: sha256(desired),
		});

		const existing = await readOptionalFile(skillPath);
		const markerContent = await readOptionalFile(markerPath);
		const marker =
			markerContent === null ? null : parseFlowSkillFolderMarker(markerContent);

		if (existing === null) {
			await mkdir(folder, { recursive: true });
			await writeFile(skillPath, desired, "utf8");
			await writeFile(markerPath, desiredMarker, "utf8");
			results.push({ name: skill.name, action: "installed", skillPath });
			continue;
		}

		const owned =
			marker !== null ||
			inspectFlowSkillDocument(existing).kind !== "not_generated";
		if (!owned) {
			results.push({ name: skill.name, action: "skipped_foreign", skillPath });
			continue;
		}

		if (existing === desired) {
			if (markerContent !== desiredMarker) {
				await writeFile(markerPath, desiredMarker, "utf8");
			}
			results.push({ name: skill.name, action: "unchanged", skillPath });
			continue;
		}

		const pristine =
			(marker?.hash !== null &&
				marker?.hash !== undefined &&
				sha256(existing) === marker.hash) ||
			inspectFlowSkillDocument(existing).kind === "valid_generated";
		if (!pristine) {
			await writeFile(
				join(folder, FLOW_SKILL_BACKUP_FILENAME),
				existing,
				"utf8",
			);
		}
		await writeFile(skillPath, desired, "utf8");
		await writeFile(markerPath, desiredMarker, "utf8");
		results.push({
			name: skill.name,
			action: pristine ? "updated" : "updated_with_backup",
			skillPath,
		});
	}
	return results;
}

export async function inspectFlowSkillSyncState(
	homeDir = resolveFlowHomeDir(),
): Promise<FlowSkillSyncStateEntry[]> {
	const entries: FlowSkillSyncStateEntry[] = [];
	for (const skill of FLOW_SKILL_SPECS) {
		const folder = join(resolveFlowSkillsRoot(homeDir), skill.name);
		const skillPath = join(folder, "SKILL.md");
		const existing = await readOptionalFile(skillPath);
		if (existing === null) {
			entries.push({ name: skill.name, state: "missing", skillPath });
			continue;
		}
		const markerContent = await readOptionalFile(
			join(folder, FLOW_SKILL_MARKER_FILENAME),
		);
		const owned =
			(markerContent !== null &&
				parseFlowSkillFolderMarker(markerContent) !== null) ||
			inspectFlowSkillDocument(existing).kind !== "not_generated";
		if (!owned) {
			entries.push({ name: skill.name, state: "foreign", skillPath });
			continue;
		}
		const desired = renderFlowSkillDocument(skill);
		entries.push({
			name: skill.name,
			state: existing === desired ? "synced" : "stale",
			skillPath,
		});
	}
	return entries;
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

type FlowStartupLogger = (level: "info" | "warn", message: string) => void;

/**
 * Best-effort startup hook: sync skills and surface the pre-npm-copy warning
 * without ever failing plugin initialization.
 */
export async function runFlowStartupSync(
	version: string,
	log: FlowStartupLogger,
): Promise<void> {
	try {
		const results = await syncFlowSkills({ version });
		const changed = results.filter(
			(result) =>
				result.action !== "unchanged" && result.action !== "skipped_foreign",
		);
		if (changed.length > 0) {
			log(
				"info",
				`Flow synced global skills (${changed
					.map((result) => `${result.name}: ${result.action}`)
					.join(", ")}). Restart OpenCode once if skills were just installed.`,
			);
		}
	} catch (error) {
		log("warn", `Flow skill sync failed: ${describeError(error)}`);
	}

	try {
		const preNpmCopy = await detectPreNpmFlowPlugin();
		if (preNpmCopy) {
			log(
				"warn",
				`Stale pre-npm Flow plugin copy detected at ${preNpmCopy.path}. Flow now loads from npm via the opencode.json plugin array; remove the stale copy to avoid loading Flow twice (run \`bunx opencode-plugin-flow uninstall\`${preNpmCopy.flowOwned ? "" : " or delete the file manually"}).`,
			);
		}
	} catch (error) {
		log("warn", `Flow pre-npm install check failed: ${describeError(error)}`);
	}
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

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
