import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import {
	FLOW_SKILL_DEFINITIONS,
	type FlowSkillDefinition,
} from "./flow-skill-definitions";

const MARKER_FILENAME = ".flow-skill-version";

type FlowLog = (level: "info" | "warn" | "error", message: string) => void;

export type FlowSkillSyncAction =
	| "installed"
	| "updated"
	| "updated_with_backup"
	| "marker_updated"
	| "unchanged"
	| "skipped_foreign";

export type FlowSkillSyncResult = {
	name: string;
	action: FlowSkillSyncAction;
	backupPaths?: string[];
};

export type FlowSkillSyncHealth = {
	status: "ok" | "restart_required" | "action_required" | "error";
	version: string;
	root: string;
	checkedAt: string;
	expectedSkills: string[];
	results: FlowSkillSyncResult[];
	changedSkills: string[];
	actionRequiredSkills: string[];
	restartRequired: boolean;
	summary: string;
	error?: string;
};

export type FlowSkillSetupStatus = {
	status: "restart_required" | "action_required" | "sync_failed";
	summary: string;
	version: string;
	root: string;
	changed?: string[];
	actionRequired?: string[];
	error?: string;
};

export type FlowSkillDoctorSkill = {
	name: string;
	path: string;
	status: "ok" | "missing" | "foreign" | "incomplete" | "edited" | "outdated";
	markerVersion: string | null;
	missingFiles: string[];
	editedFiles: string[];
	outdatedFiles: string[];
};

export type FlowSkillDoctorReport = {
	status: "ok" | "sync_required" | "action_required";
	version: string;
	root: string;
	expectedSkills: string[];
	skills: FlowSkillDoctorSkill[];
	syncRequiredSkills: string[];
	actionRequiredSkills: string[];
	unmanagedFlowSkills: string[];
};

let latestFlowSkillSyncHealth: FlowSkillSyncHealth | null = null;

function homeDir(): string {
	return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

export function resolveFlowSkillsRoot(home = homeDir()): string {
	return join(home, ".config", "opencode", "skills");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function markerFor(definition: FlowSkillDefinition, version: string): string {
	return [
		`version=${version}`,
		...definition.files.map(
			(file) => `file=${file.relativePath} sha256=${sha256(file.content)}`,
		),
		"",
	].join("\n");
}

async function optionalRead(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function parseMarkerFiles(content: string | null): Map<string, string> {
	const files = new Map<string, string>();
	if (!content) return files;
	for (const line of content.split(/\r?\n/)) {
		const match =
			/^file=(.+) sha256=([a-f0-9]{64})$/.exec(line) ??
			/^file=(.+)=sha256:([a-f0-9]{64})$/.exec(line);
		if (match?.[1] && match[2]) files.set(match[1], match[2]);
		const topLevelHash = /^hash=sha256:([a-f0-9]{64})$/.exec(line);
		if (topLevelHash?.[1] && !files.has("SKILL.md")) {
			files.set("SKILL.md", topLevelHash[1]);
		}
	}
	return files;
}

function parseMarkerVersion(content: string | null): string | null {
	if (!content) return null;
	for (const line of content.split(/\r?\n/)) {
		const match = /^version=(.+)$/.exec(line);
		if (match?.[1]) return match[1];
	}
	return null;
}

function resolveSkillFile(folder: string, relativePath: string): string {
	const resolved = normalize(join(folder, ...relativePath.split("/")));
	if (resolved !== folder && resolved.startsWith(`${folder}${sep}`)) {
		return resolved;
	}
	throw new Error(`Unsafe skill file path '${relativePath}'.`);
}

async function writeBackup(path: string, content: string): Promise<string> {
	const basePath = `${path}.backup.${sha256(content).slice(0, 12)}`;
	for (let index = 0; ; index += 1) {
		const backupPath = index === 0 ? basePath : `${basePath}.${index}`;
		try {
			await writeFile(backupPath, content, { encoding: "utf8", flag: "wx" });
			return backupPath;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
	}
}

async function syncSkill(
	definition: FlowSkillDefinition,
	version: string,
	root: string,
): Promise<FlowSkillSyncResult> {
	const folder = join(root, definition.name);
	const markerPath = join(folder, MARKER_FILENAME);
	const markerContent = await optionalRead(markerPath);
	const existingMarkerHashes = parseMarkerFiles(markerContent);
	const existingSkill = await optionalRead(join(folder, "SKILL.md"));
	if (existingSkill !== null && markerContent === null) {
		return { name: definition.name, action: "skipped_foreign" as const };
	}

	let changed = false;
	const backupPaths: string[] = [];
	const currentRelativePaths = new Set(
		definition.files.map((file) => file.relativePath),
	);
	for (const file of definition.files) {
		const path = resolveSkillFile(folder, file.relativePath);
		const existing = await optionalRead(path);
		if (existing === file.content) continue;
		changed = true;
		const recordedHash = existingMarkerHashes.get(file.relativePath);
		const userEdited =
			existing !== null &&
			(recordedHash
				? sha256(existing) !== recordedHash
				: markerContent !== null);
		if (userEdited) {
			backupPaths.push(await writeBackup(path, existing));
		}
	}
	for (const [relativePath, recordedHash] of existingMarkerHashes) {
		if (currentRelativePaths.has(relativePath)) continue;
		const path = resolveSkillFile(folder, relativePath);
		const existing = await optionalRead(path);
		if (existing === null) continue;
		changed = true;
		if (sha256(existing) !== recordedHash) {
			backupPaths.push(await writeBackup(path, existing));
		}
		await rm(path, { force: true });
	}

	if (!changed && markerContent === markerFor(definition, version)) {
		return { name: definition.name, action: "unchanged" };
	}

	if (!changed) {
		await writeFile(markerPath, markerFor(definition, version), "utf8");
		return { name: definition.name, action: "marker_updated" };
	}

	const managedSkillExists = markerContent !== null;
	for (const file of definition.files) {
		const path = resolveSkillFile(folder, file.relativePath);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file.content, "utf8");
	}
	await writeFile(markerPath, markerFor(definition, version), "utf8");
	return {
		name: definition.name,
		action:
			backupPaths.length > 0
				? "updated_with_backup"
				: managedSkillExists
					? "updated"
					: "installed",
		...(backupPaths.length > 0 ? { backupPaths } : {}),
	};
}

function expectedSkillNames(): string[] {
	return FLOW_SKILL_DEFINITIONS.map((definition) => definition.name);
}

function createHealth(
	version: string,
	root: string,
	results: FlowSkillSyncResult[],
): FlowSkillSyncHealth {
	const changedSkills = results
		.filter((result) =>
			["installed", "updated", "updated_with_backup"].includes(result.action),
		)
		.map((result) => result.name);
	const actionRequiredSkills = results
		.filter((result) => result.action === "skipped_foreign")
		.map((result) => result.name);
	const status =
		actionRequiredSkills.length > 0
			? "action_required"
			: changedSkills.length > 0
				? "restart_required"
				: "ok";
	const summaryParts: string[] = [];
	if (changedSkills.length > 0) {
		summaryParts.push(
			`Flow installed or updated skills during this startup (${changedSkills.join(", ")}). Restart OpenCode before loading Flow skills.`,
		);
	}
	if (actionRequiredSkills.length > 0) {
		summaryParts.push(
			`Flow found user-owned skill folders for managed skills (${actionRequiredSkills.join(", ")}). Run ${formatFlowDoctorCommand(version)} for repair guidance.`,
		);
	}
	const summary =
		summaryParts.length > 0
			? summaryParts.join(" ")
			: "Flow skills are synced.";
	return {
		status,
		version,
		root,
		checkedAt: new Date().toISOString(),
		expectedSkills: expectedSkillNames(),
		results,
		changedSkills,
		actionRequiredSkills,
		restartRequired: changedSkills.length > 0,
		summary,
	};
}

function createErrorHealth(
	version: string,
	root: string,
	error: unknown,
): FlowSkillSyncHealth {
	const message = error instanceof Error ? error.message : String(error);
	return {
		status: "error",
		version,
		root,
		checkedAt: new Date().toISOString(),
		expectedSkills: expectedSkillNames(),
		results: [],
		changedSkills: [],
		actionRequiredSkills: [],
		restartRequired: false,
		summary: `Flow skill sync failed: ${message}`,
		error: message,
	};
}

export function getLatestFlowSkillSyncHealth(): FlowSkillSyncHealth | null {
	return latestFlowSkillSyncHealth;
}

export function formatFlowDoctorCommand(version: string): string {
	const pin = version === "0.0.0" ? "latest" : version;
	return `npx -y opencode-plugin-flow@${pin} doctor`;
}

export function getFlowSkillSetupStatus(
	health = latestFlowSkillSyncHealth,
): FlowSkillSetupStatus | null {
	if (!health || health.status === "ok") return null;
	const status = health.status === "error" ? "sync_failed" : health.status;
	return {
		status,
		summary: health.summary,
		version: health.version,
		root: health.root,
		...(health.changedSkills.length > 0
			? { changed: health.changedSkills }
			: {}),
		...(health.actionRequiredSkills.length > 0
			? { actionRequired: health.actionRequiredSkills }
			: {}),
		...(health.error ? { error: health.error } : {}),
	};
}

export function formatFlowSkillSetupWarning(
	health = latestFlowSkillSyncHealth,
): string | null {
	const setup = getFlowSkillSetupStatus(health);
	if (!setup) return null;
	return [
		"Flow setup warning:",
		setup.summary,
		`Skills root: ${setup.root}`,
		`Use \`${formatFlowDoctorCommand(setup.version)}\` for details.`,
	].join("\n");
}

export function resolveFlowPluginVersion(): string {
	if (process.env.npm_package_version) return process.env.npm_package_version;
	try {
		const require = createRequire(import.meta.url);
		for (const path of ["../package.json", "../../package.json"]) {
			try {
				const manifest = require(path) as { version?: string };
				if (manifest.version) return manifest.version;
			} catch {
				// Try the next layout: source tree and bundled dist differ.
			}
		}
	} catch {
		// Fall through to sentinel.
	}
	return "0.0.0";
}

export async function syncFlowSkills(version: string, home = homeDir()) {
	const root = resolveFlowSkillsRoot(home);
	return Promise.all(
		FLOW_SKILL_DEFINITIONS.map((definition) =>
			syncSkill(definition, version, root),
		),
	);
}

export async function runFlowSkillSync(
	version: string,
	log: FlowLog,
	home = homeDir(),
): Promise<void> {
	const root = resolveFlowSkillsRoot(home);
	try {
		const results = await syncFlowSkills(version, home);
		latestFlowSkillSyncHealth = createHealth(version, root, results);
		const changed = results.filter(
			(result) =>
				result.action === "installed" ||
				result.action === "updated" ||
				result.action === "updated_with_backup",
		);
		if (changed.length > 0) {
			log(
				"info",
				`Flow synced skills (${changed.map((item) => `${item.name}:${item.action}`).join(", ")}). Restart OpenCode if skills were just installed.`,
			);
		}
		if (latestFlowSkillSyncHealth.status === "action_required") {
			log("warn", latestFlowSkillSyncHealth.summary);
		}
	} catch (error) {
		latestFlowSkillSyncHealth = createErrorHealth(version, root, error);
		log("warn", latestFlowSkillSyncHealth.summary);
	}
}

export async function inspectFlowSkillInstall(
	version = resolveFlowPluginVersion(),
	home = homeDir(),
): Promise<FlowSkillDoctorReport> {
	const root = resolveFlowSkillsRoot(home);
	const expected = new Set(expectedSkillNames());
	const skills = await Promise.all(
		FLOW_SKILL_DEFINITIONS.map(async (definition) => {
			const folder = join(root, definition.name);
			const markerContent = await optionalRead(join(folder, MARKER_FILENAME));
			const markerVersion = parseMarkerVersion(markerContent);
			const markerHashes = parseMarkerFiles(markerContent);
			const existingSkill = await optionalRead(join(folder, "SKILL.md"));
			if (existingSkill === null) {
				return {
					name: definition.name,
					path: folder,
					status: "missing" as const,
					markerVersion,
					missingFiles: definition.files.map((file) => file.relativePath),
					editedFiles: [],
					outdatedFiles: [],
				};
			}
			if (markerContent === null) {
				return {
					name: definition.name,
					path: folder,
					status: "foreign" as const,
					markerVersion,
					missingFiles: [],
					editedFiles: [],
					outdatedFiles: [],
				};
			}
			const missingFiles: string[] = [];
			const editedFiles: string[] = [];
			const outdatedFiles: string[] = [];
			for (const file of definition.files) {
				const existing = await optionalRead(
					resolveSkillFile(folder, file.relativePath),
				);
				if (existing === null) {
					missingFiles.push(file.relativePath);
					continue;
				}
				if (existing === file.content) continue;
				const recordedHash = markerHashes.get(file.relativePath);
				if (recordedHash && sha256(existing) !== recordedHash) {
					editedFiles.push(file.relativePath);
					continue;
				}
				outdatedFiles.push(file.relativePath);
			}
			const markerDrift = markerContent !== markerFor(definition, version);
			const status: FlowSkillDoctorSkill["status"] =
				missingFiles.length > 0
					? "incomplete"
					: editedFiles.length > 0
						? "edited"
						: markerDrift || outdatedFiles.length > 0
							? "outdated"
							: "ok";
			return {
				name: definition.name,
				path: folder,
				status,
				markerVersion,
				missingFiles,
				editedFiles,
				outdatedFiles,
			};
		}),
	);

	let entries: string[] = [];
	try {
		entries = await readdir(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const unmanagedFlowSkills = entries
		.filter(
			(name) =>
				(name === "flow" || name.startsWith("flow-")) && !expected.has(name),
		)
		.map((name) => join(root, name));

	const syncRequiredSkills = skills
		.filter((skill) =>
			["missing", "incomplete", "outdated"].includes(skill.status),
		)
		.map((skill) => skill.name);
	const actionRequiredSkills = skills
		.filter((skill) => ["foreign", "edited"].includes(skill.status))
		.map((skill) => skill.name);
	const actionRequired = actionRequiredSkills.length > 0;
	const syncRequired = syncRequiredSkills.length > 0;
	return {
		status: actionRequired
			? "action_required"
			: syncRequired
				? "sync_required"
				: "ok",
		version,
		root,
		expectedSkills: [...expected],
		skills,
		syncRequiredSkills,
		actionRequiredSkills,
		unmanagedFlowSkills,
	};
}

function appendSkillList(
	lines: string[],
	label: string,
	skills: string[],
): void {
	if (skills.length === 0) return;
	lines.push(`- ${label}: ${skills.join(", ")}`);
}

export function formatFlowSkillDoctor(report: FlowSkillDoctorReport): string {
	const lines = [
		"Flow doctor",
		`- status: ${report.status}`,
		`- plugin version: ${report.version}`,
		`- skills root: ${report.root}`,
		`- expected skills: ${report.expectedSkills.join(", ")}`,
	];
	appendSkillList(
		lines,
		"startup sync can install/update",
		report.syncRequiredSkills,
	);
	appendSkillList(lines, "needs user decision", report.actionRequiredSkills);
	lines.push("", "Skills:");
	for (const skill of report.skills) {
		lines.push(
			`- ${skill.name}: ${skill.status} (${skill.path})${
				skill.markerVersion ? ` marker=${skill.markerVersion}` : ""
			}`,
		);
		if (skill.missingFiles.length > 0) {
			lines.push(`  missing: ${skill.missingFiles.join(", ")}`);
		}
		if (skill.editedFiles.length > 0) {
			lines.push(`  edited: ${skill.editedFiles.join(", ")}`);
		}
		if (skill.outdatedFiles.length > 0) {
			lines.push(`  outdated: ${skill.outdatedFiles.join(", ")}`);
		}
	}
	if (report.unmanagedFlowSkills.length > 0) {
		lines.push("", "Unmanaged Flow-like skill folders:");
		for (const path of report.unmanagedFlowSkills) lines.push(`- ${path}`);
	}
	lines.push("", "Recommendation:");
	if (report.status === "ok") {
		lines.push("- Flow skills are present and current.");
	} else if (report.status === "sync_required") {
		lines.push(
			"- Start or restart OpenCode with opencode-plugin-flow enabled so startup sync can install or update the listed skills. If Flow then reports restart_required, restart OpenCode once more so the refreshed skill registry is used.",
		);
	} else {
		lines.push(
			"- Resolve user-owned or edited managed skill folders, then restart OpenCode. Move a folder aside to let Flow recreate it, or keep it intentionally as a local override.",
		);
	}
	lines.push(`- Details command: ${formatFlowDoctorCommand(report.version)}`);
	return `${lines.join("\n")}\n`;
}

async function listSkillFolderFiles(folder: string): Promise<string[]> {
	const entries = await readdir(folder, {
		recursive: true,
		withFileTypes: true,
	});
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) =>
			join(entry.parentPath, entry.name)
				.slice(folder.length + 1)
				.split(sep)
				.join("/"),
		);
}

async function isPristineManagedFolder(
	folder: string,
	markerContent: string,
): Promise<boolean> {
	const hashes = parseMarkerFiles(markerContent);
	if (hashes.size === 0) return false;
	for (const relativePath of await listSkillFolderFiles(folder)) {
		if (relativePath === MARKER_FILENAME) continue;
		const recordedHash = hashes.get(relativePath);
		if (recordedHash === undefined) return false;
		const content = await optionalRead(resolveSkillFile(folder, relativePath));
		if (content === null || sha256(content) !== recordedHash) return false;
	}
	return true;
}

export async function uninstallFlowSkills(
	home = homeDir(),
	options: { dryRun?: boolean } = {},
) {
	const root = resolveFlowSkillsRoot(home);
	const removed: string[] = [];
	const kept: string[] = [];
	let entries: string[];
	try {
		entries = await readdir(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { removed, kept };
		}
		throw error;
	}
	for (const name of entries) {
		if (name !== "flow" && !name.startsWith("flow-")) continue;
		const folder = join(root, name);
		const markerContent = await optionalRead(join(folder, MARKER_FILENAME));
		if (
			markerContent === null ||
			!(await isPristineManagedFolder(folder, markerContent))
		) {
			kept.push(folder);
			continue;
		}
		if (!options.dryRun) {
			await rm(folder, { recursive: true, force: true });
		}
		removed.push(folder);
	}
	return { removed, kept };
}
