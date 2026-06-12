import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import {
	FLOW_AGENTS_DIRECTORY,
	FLOW_COMMANDS_DIRECTORY,
	FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER,
	FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH,
	FLOW_SKILL_BACKUP_FILENAME,
	FLOW_SKILL_MARKER_FILENAME,
	FLOW_SKILLS_DIRECTORY,
	type FlowManagedMarkdownKind,
	inspectFlowSkillDocument,
	parseFlowManagedMarkdownMarker,
	parseFlowSkillFileHashes,
	parseFlowSkillFolderMarker,
	sha256,
} from "./skill-markers";
import { flowAgentDefinitions, flowCommandDefinitions } from "./skill-sync";

type FlowUninstallOptions = {
	homeDir: string;
	dryRun?: boolean;
	logger?: (message: string) => void;
};

type FlowUninstallResult = {
	removedSkills: string[];
	keptUserEditedSkills: string[];
	removedCommands: string[];
	keptUserEditedCommands: string[];
	removedAgents: string[];
	keptUserEditedAgents: string[];
	removedPreNpmPlugin: string | null;
	keptForeignPreNpmPlugin: string | null;
};

/**
 * Removes Flow-owned global skills and the pre-npm bundled plugin copy.
 *
 * A skill folder is Flow-owned when it carries the `.flow-skill-version`
 * marker file or its SKILL.md carries the pre-npm generated marker. Pristine
 * Flow-owned skills are removed; user-edited ones are kept (with a notice) so
 * uninstalling never destroys user-authored content. Folders without a Flow
 * marker are never touched.
 */
export async function uninstallFlow({
	homeDir,
	dryRun = false,
	logger,
}: FlowUninstallOptions): Promise<FlowUninstallResult> {
	const result: FlowUninstallResult = {
		removedSkills: [],
		keptUserEditedSkills: [],
		removedCommands: [],
		keptUserEditedCommands: [],
		removedAgents: [],
		keptUserEditedAgents: [],
		removedPreNpmPlugin: null,
		keptForeignPreNpmPlugin: null,
	};

	const skillsRoot = join(homeDir, FLOW_SKILLS_DIRECTORY);
	for (const folderName of await listDirectories(skillsRoot)) {
		if (folderName !== "flow" && !folderName.startsWith("flow-")) {
			continue;
		}
		const folder = join(skillsRoot, folderName);
		const ownership = await classifySkillFolder(folder);
		if (ownership === "foreign") {
			continue;
		}
		if (ownership === "user_edited") {
			result.keptUserEditedSkills.push(folder);
			logger?.(
				`Kept user-edited Flow skill at ${folder}; remove it manually if it is no longer needed.`,
			);
			continue;
		}
		if (!dryRun) {
			await removeSkillFolder(folder);
		}
		result.removedSkills.push(folder);
		logger?.(`${dryRun ? "Would remove" : "Removed"} Flow skill at ${folder}.`);
	}

	await removeManagedMarkdownFiles({
		homeDir,
		dryRun,
		logger,
		kind: "command",
		root: join(homeDir, FLOW_COMMANDS_DIRECTORY),
		files: flowCommandDefinitions(),
		removed: result.removedCommands,
		keptUserEdited: result.keptUserEditedCommands,
	});
	await removeManagedMarkdownFiles({
		homeDir,
		dryRun,
		logger,
		kind: "agent",
		root: join(homeDir, FLOW_AGENTS_DIRECTORY),
		files: flowAgentDefinitions(),
		removed: result.removedAgents,
		keptUserEdited: result.keptUserEditedAgents,
	});

	const preNpmPath = join(homeDir, FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH);
	const preNpmContent = await readOptionalFile(preNpmPath);
	if (preNpmContent !== null) {
		if (preNpmContent.startsWith(FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER)) {
			if (!dryRun) {
				await rm(preNpmPath, { force: true });
			}
			result.removedPreNpmPlugin = preNpmPath;
			logger?.(
				`${dryRun ? "Would remove" : "Removed"} pre-npm Flow plugin copy at ${preNpmPath}.`,
			);
		} else {
			result.keptForeignPreNpmPlugin = preNpmPath;
			logger?.(
				`Kept ${preNpmPath}: it is not managed by Flow. Remove it manually if it is a stale Flow copy.`,
			);
		}
	}

	logger?.(
		'Finally, remove "opencode-plugin-flow" from the plugin array in opencode.json and restart OpenCode.',
	);
	return result;
}

type SkillFolderOwnership = "foreign" | "pristine" | "user_edited";

async function classifySkillFolder(
	folder: string,
): Promise<SkillFolderOwnership> {
	const skillPath = join(folder, "SKILL.md");
	const skillContent = await readOptionalFile(skillPath);
	const markerContent = await readOptionalFile(
		join(folder, FLOW_SKILL_MARKER_FILENAME),
	);
	const marker =
		markerContent === null ? null : parseFlowSkillFolderMarker(markerContent);

	if (marker !== null && markerContent !== null) {
		// Any marker-listed reference file that exists but no longer matches its
		// recorded hash carries user edits the uninstall must not destroy.
		for (const [relativePath, hash] of parseFlowSkillFileHashes(
			markerContent,
		)) {
			if (relativePath === "SKILL.md") {
				continue;
			}
			const filePath = resolveMarkerFilePath(folder, relativePath);
			if (filePath === null) {
				continue;
			}
			const content = await readOptionalFile(filePath);
			if (content !== null && sha256(content) !== hash) {
				return "user_edited";
			}
		}
		if (skillContent === null) {
			return "pristine";
		}
		if (marker.hash !== null && sha256(skillContent) === marker.hash) {
			return "pristine";
		}
		// Marker without a usable hash, or edited content: fall through to the
		// pre-npm in-document inspection before deciding.
		const inspection = inspectFlowSkillDocument(skillContent);
		return inspection.kind === "valid_generated" ? "pristine" : "user_edited";
	}

	if (skillContent === null) {
		return "foreign";
	}
	const inspection = inspectFlowSkillDocument(skillContent);
	if (inspection.kind === "valid_generated") {
		return "pristine";
	}
	if (inspection.kind === "invalid_generated") {
		return "user_edited";
	}
	return "foreign";
}

/**
 * Marker-recorded relative paths are written by the plugin itself, but the
 * marker file on disk is still untrusted input: refuse anything absolute or
 * escaping the skill folder.
 */
function resolveMarkerFilePath(
	folder: string,
	relativePath: string,
): string | null {
	const resolved = normalize(join(folder, ...relativePath.split("/")));
	if (resolved !== folder && resolved.startsWith(`${folder}${sep}`)) {
		return resolved;
	}
	return null;
}

async function removeSkillFolder(folder: string): Promise<void> {
	const markerContent = await readOptionalFile(
		join(folder, FLOW_SKILL_MARKER_FILENAME),
	);
	const subdirectories = new Set<string>();
	if (markerContent !== null) {
		for (const relativePath of parseFlowSkillFileHashes(markerContent).keys()) {
			const filePath = resolveMarkerFilePath(folder, relativePath);
			if (filePath === null) {
				continue;
			}
			await rm(filePath, { force: true });
			await rm(`${filePath}.backup`, { force: true });
			const parent = dirname(filePath);
			if (parent !== folder) {
				subdirectories.add(parent);
			}
		}
	}
	await rm(join(folder, "SKILL.md"), { force: true });
	await rm(join(folder, FLOW_SKILL_MARKER_FILENAME), { force: true });
	await rm(join(folder, FLOW_SKILL_BACKUP_FILENAME), { force: true });
	// Deepest first so nested marker-owned directories collapse bottom-up.
	for (const subdirectory of [...subdirectories].sort(
		(a, b) => b.length - a.length,
	)) {
		await removeDirectoryIfEmpty(subdirectory);
	}
	await removeDirectoryIfEmpty(folder);
}

async function removeDirectoryIfEmpty(path: string): Promise<void> {
	try {
		await rmdir(path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTEMPTY") {
			throw error;
		}
	}
}

async function listDirectories(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
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

async function removeManagedMarkdownFiles(input: {
	homeDir: string;
	dryRun: boolean;
	logger: ((message: string) => void) | undefined;
	kind: FlowManagedMarkdownKind;
	root: string;
	files: ReadonlyMap<string, string>;
	removed: string[];
	keptUserEdited: string[];
}): Promise<void> {
	for (const [name, desiredContent] of input.files) {
		const path = join(input.root, `${name}.md`);
		const markerPath = join(input.root, `.${name}.flow-version`);
		const content = await readOptionalFile(path);
		const markerContent = await readOptionalFile(markerPath);
		const marker =
			markerContent === null
				? null
				: parseFlowManagedMarkdownMarker(markerContent, input.kind, name);
		if (content === null && marker === null) {
			continue;
		}
		const owned = marker !== null || content === desiredContent;
		if (!owned) {
			continue;
		}
		if (
			content !== null &&
			marker !== null &&
			sha256(content) !== marker.hash
		) {
			input.keptUserEdited.push(path);
			input.logger?.(
				`Kept user-edited Flow ${input.kind} at ${path}; remove it manually if it is no longer needed.`,
			);
			continue;
		}
		if (!input.dryRun) {
			await rm(path, { force: true });
			await rm(markerPath, { force: true });
			await rm(`${path}.backup`, { force: true });
		}
		input.removed.push(path);
		input.logger?.(
			`${input.dryRun ? "Would remove" : "Removed"} Flow ${input.kind} at ${path}.`,
		);
	}
	if (!input.dryRun) {
		await removeDirectoryIfEmpty(input.root);
	}
}
