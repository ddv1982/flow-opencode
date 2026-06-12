import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import flowSkillDoc from "../../skills/flow/SKILL.md" with { type: "text" };
import flowPlanPlanningExamplesDoc from "../../skills/flow-plan/references/planning-examples.md" with {
	type: "text",
};
import flowPlanSkillDoc from "../../skills/flow-plan/SKILL.md" with {
	type: "text",
};
import flowReviewReviewRubricDoc from "../../skills/flow-review/references/review-rubric.md" with {
	type: "text",
};
import flowReviewSkillDoc from "../../skills/flow-review/SKILL.md" with {
	type: "text",
};
import flowRunValidationRubricDoc from "../../skills/flow-run/references/validation-rubric.md" with {
	type: "text",
};
import flowRunSkillDoc from "../../skills/flow-run/SKILL.md" with {
	type: "text",
};
import {
	FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER,
	FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH,
	FLOW_SKILL_MARKER_FILENAME,
	FLOW_SKILLS_DIRECTORY,
	inspectFlowSkillDocument,
	parseFlowSkillFileHashes,
	parseFlowSkillFolderMarker,
	renderFlowSkillFolderMarker,
	sha256,
} from "./skill-markers";

const SKILL_DOCUMENT_FILENAME = "SKILL.md";

type FlowSkillFile = {
	/** Path inside the installed skill folder, `/`-separated. */
	relativePath: string;
	content: string;
};

export type FlowSkillDefinition = {
	name: string;
	files: readonly FlowSkillFile[];
};

/**
 * The hand-authored skills shipped with the plugin. The markdown is embedded
 * at build time via Bun text imports so the bundled dist/index.js remains
 * self-contained. Source of truth: the `skills/` directory in the repo.
 */
export const FLOW_SKILL_DEFINITIONS: readonly FlowSkillDefinition[] = [
	{
		name: "flow",
		files: [{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowSkillDoc }],
	},
	{
		name: "flow-plan",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowPlanSkillDoc },
			{
				relativePath: "references/planning-examples.md",
				content: flowPlanPlanningExamplesDoc,
			},
		],
	},
	{
		name: "flow-run",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowRunSkillDoc },
			{
				relativePath: "references/validation-rubric.md",
				content: flowRunValidationRubricDoc,
			},
		],
	},
	{
		name: "flow-review",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowReviewSkillDoc },
			{
				relativePath: "references/review-rubric.md",
				content: flowReviewReviewRubricDoc,
			},
		],
	},
];

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

function resolveSkillFilePath(folder: string, relativePath: string): string {
	return join(folder, ...relativePath.split("/"));
}

function skillDocument(definition: FlowSkillDefinition): FlowSkillFile {
	const document = definition.files.find(
		(file) => file.relativePath === SKILL_DOCUMENT_FILENAME,
	);
	if (!document) {
		throw new Error(`Flow skill ${definition.name} is missing SKILL.md`);
	}
	return document;
}

function renderDesiredMarker(
	definition: FlowSkillDefinition,
	version: string,
): string {
	return renderFlowSkillFolderMarker({
		version,
		hash: sha256(skillDocument(definition).content),
		files: definition.files.map((file) => ({
			relativePath: file.relativePath,
			hash: sha256(file.content),
		})),
	});
}

/**
 * Idempotent startup sync of the embedded hand-authored Flow skills into the
 * global OpenCode skill directory. Folder ownership is tracked with a
 * plugin-owned marker file (`.flow-skill-version`); pre-npm hash-locked
 * installs are recognized through their in-document marker and adopted.
 * Folders without either marker belong to the user (or another plugin) and
 * are never touched. A user-edited file in a Flow-owned folder is backed up
 * next to itself (`SKILL.md.backup`, `references/<name>.backup`) before being
 * replaced, never refused or silently lost. Reference files sync alongside
 * SKILL.md.
 */
export async function syncFlowSkills({
	homeDir = resolveFlowHomeDir(),
	version,
}: FlowSkillSyncOptions): Promise<FlowSkillSyncResult[]> {
	const results: FlowSkillSyncResult[] = [];
	for (const definition of FLOW_SKILL_DEFINITIONS) {
		const folder = join(resolveFlowSkillsRoot(homeDir), definition.name);
		const skillPath = join(folder, SKILL_DOCUMENT_FILENAME);
		const markerPath = join(folder, FLOW_SKILL_MARKER_FILENAME);
		const desiredMarker = renderDesiredMarker(definition, version);

		const existingSkill = await readOptionalFile(skillPath);
		const markerContent = await readOptionalFile(markerPath);
		const marker =
			markerContent === null ? null : parseFlowSkillFolderMarker(markerContent);
		const recordedFileHashes =
			markerContent === null
				? new Map<string, string>()
				: parseFlowSkillFileHashes(markerContent);

		if (existingSkill === null && marker === null) {
			await writeSkillFiles(folder, definition);
			await writeFile(markerPath, desiredMarker, "utf8");
			results.push({ name: definition.name, action: "installed", skillPath });
			continue;
		}

		const owned =
			marker !== null ||
			(existingSkill !== null &&
				inspectFlowSkillDocument(existingSkill).kind !== "not_generated");
		if (!owned) {
			results.push({
				name: definition.name,
				action: "skipped_foreign",
				skillPath,
			});
			continue;
		}

		let changed = false;
		let backedUp = false;
		for (const file of definition.files) {
			const filePath = resolveSkillFilePath(folder, file.relativePath);
			const existing =
				file.relativePath === SKILL_DOCUMENT_FILENAME
					? existingSkill
					: await readOptionalFile(filePath);
			if (existing === file.content) {
				continue;
			}
			changed = true;
			if (
				existing !== null &&
				isUserEdited({
					relativePath: file.relativePath,
					existing,
					recordedFileHashes,
					markerHash: marker?.hash ?? null,
				})
			) {
				await writeFile(`${filePath}.backup`, existing, "utf8");
				backedUp = true;
			}
		}

		if (!changed) {
			if (markerContent !== desiredMarker) {
				await writeFile(markerPath, desiredMarker, "utf8");
			}
			results.push({ name: definition.name, action: "unchanged", skillPath });
			continue;
		}

		await writeSkillFiles(folder, definition);
		await writeFile(markerPath, desiredMarker, "utf8");
		results.push({
			name: definition.name,
			action: backedUp ? "updated_with_backup" : "updated",
			skillPath,
		});
	}
	return results;
}

/**
 * A file is user-edited when its on-disk content matches neither the hash the
 * marker recorded at install time nor (for SKILL.md) a pristine pre-npm
 * generated document. Markers without per-file hashes (pre per-file tracking)
 * fall back to the top-level SKILL.md hash; anything unprovable is treated as
 * user-edited, which costs at most a redundant backup.
 */
function isUserEdited(input: {
	relativePath: string;
	existing: string;
	recordedFileHashes: ReadonlyMap<string, string>;
	markerHash: string | null;
}): boolean {
	const existingHash = sha256(input.existing);
	const recorded = input.recordedFileHashes.get(input.relativePath);
	if (recorded !== undefined) {
		return existingHash !== recorded;
	}
	if (input.relativePath === SKILL_DOCUMENT_FILENAME) {
		if (input.markerHash !== null && existingHash === input.markerHash) {
			return false;
		}
		return inspectFlowSkillDocument(input.existing).kind !== "valid_generated";
	}
	return true;
}

async function writeSkillFiles(
	folder: string,
	definition: FlowSkillDefinition,
): Promise<void> {
	for (const file of definition.files) {
		const filePath = resolveSkillFilePath(folder, file.relativePath);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, file.content, "utf8");
	}
}

export async function inspectFlowSkillSyncState(
	homeDir = resolveFlowHomeDir(),
): Promise<FlowSkillSyncStateEntry[]> {
	const entries: FlowSkillSyncStateEntry[] = [];
	for (const definition of FLOW_SKILL_DEFINITIONS) {
		const folder = join(resolveFlowSkillsRoot(homeDir), definition.name);
		const skillPath = join(folder, SKILL_DOCUMENT_FILENAME);
		const existingSkill = await readOptionalFile(skillPath);
		if (existingSkill === null) {
			entries.push({ name: definition.name, state: "missing", skillPath });
			continue;
		}
		const markerContent = await readOptionalFile(
			join(folder, FLOW_SKILL_MARKER_FILENAME),
		);
		const owned =
			(markerContent !== null &&
				parseFlowSkillFolderMarker(markerContent) !== null) ||
			inspectFlowSkillDocument(existingSkill).kind !== "not_generated";
		if (!owned) {
			entries.push({ name: definition.name, state: "foreign", skillPath });
			continue;
		}
		let synced = true;
		for (const file of definition.files) {
			const existing =
				file.relativePath === SKILL_DOCUMENT_FILENAME
					? existingSkill
					: await readOptionalFile(
							resolveSkillFilePath(folder, file.relativePath),
						);
			if (existing !== file.content) {
				synced = false;
				break;
			}
		}
		entries.push({
			name: definition.name,
			state: synced ? "synced" : "stale",
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
