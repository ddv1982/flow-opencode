import { constants } from "node:fs";
import {
	access,
	mkdir,
	readFile,
	rm,
	rmdir,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	FLOW_SKILL_GENERATED_VERSION,
	FLOW_SKILL_SPECS,
	type FlowSkillSpec,
	inspectFlowSkillDocument,
	renderFlowSkillDocument,
} from "../../prompts/generated/skill-docs";

export const FLOW_SKILL_BUNDLE_DIRECTORY = join(".opencode", "skills");

export const FLOW_OPENCODE_SKILL_PERMISSION_EXPECTATION = {
	discoveryPath: ".opencode/skills/<name>/SKILL.md",
	permissionPattern: "flow-*",
	allowedPostures: ["allow", "ask"],
	deniedPosture: "deny hides generated Flow skills from agents",
} as const;

export type FlowSkillBundleFile = {
	skill: FlowSkillSpec;
	relativePath: string;
	absolutePath: string;
	content: string;
};

export type FlowSkillBundleInstallResult = {
	installed: string[];
};

export type FlowSkillBundleUninstallResult = {
	removed: string[];
};

type FlowSkillBundleFileSnapshot = {
	file: FlowSkillBundleFile;
	existing: string | null;
};

export type FlowSkillBundleSnapshot = {
	files: FlowSkillBundleFileSnapshot[];
};

export type FlowSkillBundleOptions = {
	projectRoot: string;
	logger?: (message: string) => void;
};

export function resolveFlowSkillBundleFiles(
	projectRoot: string,
): FlowSkillBundleFile[] {
	return FLOW_SKILL_SPECS.map((skill) => {
		const relativePath = join(
			FLOW_SKILL_BUNDLE_DIRECTORY,
			skill.name,
			"SKILL.md",
		);
		return {
			skill,
			relativePath,
			absolutePath: join(projectRoot, relativePath),
			content: renderFlowSkillDocument(skill),
		};
	});
}

export async function assertFlowSkillBundleCanInstall({
	projectRoot,
}: FlowSkillBundleOptions): Promise<void> {
	const files = resolveFlowSkillBundleFiles(projectRoot);
	for (const file of files) {
		await assertSkillCanBeWritten(file);
	}
}

export async function installFlowSkillBundle({
	projectRoot,
	logger,
}: FlowSkillBundleOptions): Promise<FlowSkillBundleInstallResult> {
	const files = resolveFlowSkillBundleFiles(projectRoot);
	await assertFlowSkillBundleCanInstall({ projectRoot });
	const snapshot = await snapshotFlowSkillBundle({ projectRoot });

	try {
		for (const file of files) {
			await mkdir(dirname(file.absolutePath), { recursive: true });
			await writeFile(file.absolutePath, file.content, "utf8");
		}
	} catch (error) {
		await restoreFlowSkillBundleSnapshot(snapshot);
		throw error;
	}

	const installed = files.map((file) => file.relativePath);
	logger?.(
		`Installed Flow skills to ${join(projectRoot, FLOW_SKILL_BUNDLE_DIRECTORY)}`,
	);
	return { installed };
}

export async function assertFlowSkillBundleCanUninstall({
	projectRoot,
}: FlowSkillBundleOptions): Promise<void> {
	await collectRemovableFlowSkillFiles(projectRoot);
}

export async function uninstallFlowSkillBundle({
	projectRoot,
	logger,
}: FlowSkillBundleOptions): Promise<FlowSkillBundleUninstallResult> {
	const existingFiles = await collectRemovableFlowSkillFiles(projectRoot);
	const snapshot = await snapshotFlowSkillBundle({ projectRoot });

	try {
		for (const file of existingFiles) {
			await rm(file.absolutePath, { force: true });
			await removeDirectoryIfEmpty(dirname(file.absolutePath));
		}
		await removeDirectoryIfEmpty(
			join(projectRoot, FLOW_SKILL_BUNDLE_DIRECTORY),
		);
		await removeDirectoryIfEmpty(join(projectRoot, ".opencode"));
	} catch (error) {
		await restoreFlowSkillBundleSnapshot(snapshot);
		throw error;
	}

	const removed = existingFiles.map((file) => file.relativePath);
	if (removed.length > 0) {
		logger?.(
			`Removed Flow skills from ${join(projectRoot, FLOW_SKILL_BUNDLE_DIRECTORY)}`,
		);
	}
	return { removed };
}

export async function snapshotFlowSkillBundle({
	projectRoot,
}: Pick<
	FlowSkillBundleOptions,
	"projectRoot"
>): Promise<FlowSkillBundleSnapshot> {
	const files = resolveFlowSkillBundleFiles(projectRoot);
	return {
		files: await Promise.all(
			files.map(async (file) => ({
				file,
				existing: await readOptionalFile(file.absolutePath),
			})),
		),
	};
}

export async function restoreFlowSkillBundleSnapshot({
	files,
}: FlowSkillBundleSnapshot): Promise<void> {
	for (const { file, existing } of files) {
		if (existing === null) {
			await rm(file.absolutePath, { force: true });
			await removeDirectoryIfEmpty(dirname(file.absolutePath));
			continue;
		}
		await mkdir(dirname(file.absolutePath), { recursive: true });
		await writeFile(file.absolutePath, existing, "utf8");
	}
}

async function collectRemovableFlowSkillFiles(
	projectRoot: string,
): Promise<FlowSkillBundleFile[]> {
	const files = resolveFlowSkillBundleFiles(projectRoot);
	const existingFiles: FlowSkillBundleFile[] = [];
	for (const file of files) {
		const existing = await readOptionalFile(file.absolutePath);
		if (existing === null) {
			continue;
		}
		if (isRemovableFlowGeneratedSkill(file, existing)) {
			existingFiles.push(file);
		}
	}
	return existingFiles;
}

async function assertSkillCanBeWritten(
	file: FlowSkillBundleFile,
): Promise<void> {
	const existing = await readOptionalFile(file.absolutePath);
	if (existing === null || existing === file.content) {
		return;
	}
	assertExpectedFlowGeneratedSkill(file, existing, "overwrite");
}

function isRemovableFlowGeneratedSkill(
	file: FlowSkillBundleFile,
	existing: string,
): boolean {
	const inspection = inspectFlowSkillDocument(existing);
	if (inspection.kind === "not_generated") {
		return false;
	}
	assertExpectedFlowGeneratedSkill(file, existing, "remove");
	return true;
}

function assertExpectedFlowGeneratedSkill(
	file: FlowSkillBundleFile,
	existing: string,
	action: "overwrite" | "remove",
): void {
	const inspection = inspectFlowSkillDocument(existing);
	if (inspection.kind === "not_generated") {
		throw new Error(
			`Refusing to ${action} user-managed OpenCode skill at ${file.absolutePath}.`,
		);
	}
	if (inspection.kind === "invalid_generated") {
		throw new Error(
			`Refusing to ${action} user-edited OpenCode skill at ${file.absolutePath}.`,
		);
	}
	if (
		inspection.marker.name !== file.skill.name ||
		inspection.marker.version !== FLOW_SKILL_GENERATED_VERSION
	) {
		throw new Error(
			`Refusing to ${action} mismatched Flow-generated OpenCode skill at ${file.absolutePath}.`,
		);
	}
}

async function readOptionalFile(path: string): Promise<string | null> {
	try {
		await access(path, constants.F_OK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
	return readFile(path, "utf8");
}

async function removeDirectoryIfEmpty(path: string): Promise<void> {
	try {
		await rmdir(path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTEMPTY") {
			return;
		}
		throw error;
	}
}
