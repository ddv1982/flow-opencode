import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FLOW_SKILL_DEFINITIONS } from "./flow-skill-definitions";
import {
	FLOW_SKILL_MARKER_FILENAME,
	inspectFlowSkillDocument,
	parseFlowSkillFileHashes,
	parseFlowSkillFolderMarker,
	renderFlowSkillFolderMarker,
	sha256,
} from "./skill-markers";
import {
	resolveFlowHomeDir,
	resolveFlowSkillsRoot,
	resolveSkillFilePath,
} from "./sync-paths";
import {
	type FlowSkillDefinition,
	type FlowSkillFile,
	type FlowSkillSyncOptions,
	type FlowSkillSyncResult,
	type FlowSkillSyncStateEntry,
	SKILL_DOCUMENT_FILENAME,
} from "./sync-types";
import { readOptionalFile } from "./sync-utils";

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
