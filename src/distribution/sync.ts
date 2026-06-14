import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, normalize, sep } from "node:path";
import {
	FLOW_SKILL_DEFINITIONS,
	type FlowSkillDefinition,
} from "./flow-skill-definitions";

const MARKER_FILENAME = ".flow-skill-version";

type FlowLog = (level: "info" | "warn" | "error", message: string) => void;

function homeDir(): string {
	return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function skillsRoot(home = homeDir()): string {
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

function resolveSkillFile(folder: string, relativePath: string): string {
	const resolved = normalize(join(folder, ...relativePath.split("/")));
	if (resolved !== folder && resolved.startsWith(`${folder}${sep}`)) {
		return resolved;
	}
	throw new Error(`Unsafe skill file path '${relativePath}'.`);
}

async function syncSkill(
	definition: FlowSkillDefinition,
	version: string,
	root: string,
) {
	const folder = join(root, definition.name);
	const markerPath = join(folder, MARKER_FILENAME);
	const markerContent = await optionalRead(markerPath);
	const existingMarkerHashes = parseMarkerFiles(markerContent);
	const existingSkill = await optionalRead(join(folder, "SKILL.md"));
	if (existingSkill !== null && markerContent === null) {
		return { name: definition.name, action: "skipped_foreign" as const };
	}

	let changed = false;
	let backedUp = false;
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
			await writeFile(`${path}.backup`, existing, "utf8");
			backedUp = true;
		}
	}

	if (!changed && markerContent === markerFor(definition, version)) {
		return { name: definition.name, action: "unchanged" as const };
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
		action: backedUp
			? ("updated_with_backup" as const)
			: managedSkillExists
				? ("updated" as const)
				: ("installed" as const),
	};
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
	const root = skillsRoot(home);
	return Promise.all(
		FLOW_SKILL_DEFINITIONS.map((definition) =>
			syncSkill(definition, version, root),
		),
	);
}

export async function runFlowSkillSync(
	version: string,
	log: FlowLog,
): Promise<void> {
	try {
		const results = await syncFlowSkills(version);
		const changed = results.filter(
			(result) =>
				result.action !== "unchanged" && result.action !== "skipped_foreign",
		);
		if (changed.length > 0) {
			log(
				"info",
				`Flow synced skills (${changed.map((item) => `${item.name}:${item.action}`).join(", ")}). Restart OpenCode if skills were just installed.`,
			);
		}
	} catch (error) {
		log(
			"warn",
			`Flow skill sync failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function uninstallFlowSkills(home = homeDir()) {
	const root = skillsRoot(home);
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
		if (markerContent === null) {
			kept.push(folder);
			continue;
		}
		const hashes = parseMarkerFiles(markerContent);
		let userEdited = false;
		for (const [relativePath, recordedHash] of hashes) {
			const content = await optionalRead(
				resolveSkillFile(folder, relativePath),
			);
			if (content !== null && sha256(content) !== recordedHash) {
				userEdited = true;
				break;
			}
		}
		if (userEdited) {
			kept.push(folder);
			continue;
		}
		await rm(folder, { recursive: true, force: true });
		removed.push(folder);
	}
	return { removed, kept };
}
