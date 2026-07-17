import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	type FileHandle,
	lstat,
	mkdir,
	open,
	readdir,
	rename,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, sep } from "node:path";
import { FLOW_GUIDANCE_TOPICS } from "../guidance/ids.js";

const LEGACY_MARKER = ".flow-skill-version";
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const SUPPORTED_LEGACY_MAJOR = "4";
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type ParsedMarker = {
	version: string;
	files: Map<string, string>;
};

export type LegacySkillCleanupResult = {
	name: string;
	path: string;
	status: "absent" | "eligible" | "archived" | "refused" | "quarantined";
	reason?: string;
	archivePath?: string;
};

export type LegacyCleanupReport = {
	mode: "dry-run" | "apply";
	root: string;
	archiveRoot: string;
	results: LegacySkillCleanupResult[];
};

function configuredHome(): string {
	return (
		process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir()
	);
}

export function resolveLegacySkillsRoot(home = configuredHome()): string {
	return join(home, ".config", "opencode", "skills");
}

export function resolveLegacyArchiveRoot(home = configuredHome()): string {
	return join(home, ".config", "opencode", "flow-legacy-skills");
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function safeLegacyPath(folder: string, relativePath: string): string {
	if (
		!relativePath ||
		isAbsolute(relativePath) ||
		relativePath.includes("\\") ||
		relativePath
			.split("/")
			.some((part) => !part || part === "." || part === "..")
	) {
		throw new Error(`unsafe marker path '${relativePath}'`);
	}
	const resolved = normalize(join(folder, ...relativePath.split("/")));
	if (!resolved.startsWith(`${folder}${sep}`)) {
		throw new Error(`unsafe marker path '${relativePath}'`);
	}
	return resolved;
}

async function optionalStat(path: string) {
	try {
		return await lstat(path, { bigint: false });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function readRegularFileWithoutFollowing(path: string): Promise<string> {
	let handle: FileHandle | undefined;
	try {
		const pathMetadata = await lstat(path);
		if (pathMetadata.isSymbolicLink()) {
			throw new Error(`symbolic link refused: ${path}`);
		}
		if (!pathMetadata.isFile()) throw new Error(`not a regular file: ${path}`);
		handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error(`not a regular file: ${path}`);
		if (
			metadata.dev !== pathMetadata.dev ||
			metadata.ino !== pathMetadata.ino
		) {
			throw new Error(`file changed while cleanup was running: ${path}`);
		}
		return await handle.readFile({ encoding: "utf8" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOOP") {
			throw new Error(`symbolic link refused: ${path}`);
		}
		throw error;
	} finally {
		await handle?.close();
	}
}

function parseMarker(content: string): ParsedMarker {
	let version: string | undefined;
	const files = new Map<string, string>();
	for (const line of content.split(/\r?\n/)) {
		if (!line) continue;
		const versionMatch = /^version=(.+)$/.exec(line);
		if (versionMatch?.[1]) {
			if (version) throw new Error("marker contains duplicate versions");
			version = versionMatch[1];
			continue;
		}
		const fileMatch =
			/^file=(.+) sha256=([a-f0-9]{64})$/.exec(line) ??
			/^file=(.+)=sha256:([a-f0-9]{64})$/.exec(line);
		if (fileMatch?.[1] && fileMatch[2]) {
			if (files.has(fileMatch[1])) {
				throw new Error(`marker contains duplicate file '${fileMatch[1]}'`);
			}
			files.set(fileMatch[1], fileMatch[2]);
			continue;
		}
		const topLevelHash = /^hash=sha256:([a-f0-9]{64})$/.exec(line);
		if (topLevelHash?.[1] && !files.has("SKILL.md")) {
			files.set("SKILL.md", topLevelHash[1]);
			continue;
		}
		throw new Error(`marker contains an invalid line: '${line}'`);
	}
	if (!version) throw new Error("marker has no version");
	if (!files.has("SKILL.md")) throw new Error("marker does not own SKILL.md");
	return { version, files };
}

function assertSupportedLegacyVersion(version: string): void {
	const match = SEMVER_PATTERN.exec(version);
	if (!match) {
		throw new Error(
			`marker version '${version}' is not a valid semantic version`,
		);
	}
	if (match[1] !== SUPPORTED_LEGACY_MAJOR) {
		throw new Error(
			`marker version '${version}' is outside the supported legacy range >=4.0.0 <5.0.0`,
		);
	}
}

function expectedDirectoryEntries(
	marker: ParsedMarker,
): Map<string, Set<string>> {
	const entries = new Map<string, Set<string>>([
		["", new Set([LEGACY_MARKER])],
	]);
	for (const relativePath of marker.files.keys()) {
		const parts = relativePath.split("/");
		let parent = "";
		for (let index = 0; index < parts.length; index += 1) {
			const part = parts[index];
			if (!part) throw new Error(`unsafe marker path '${relativePath}'`);
			const children = entries.get(parent) ?? new Set<string>();
			children.add(part);
			entries.set(parent, children);
			if (index < parts.length - 1) {
				parent = parent ? `${parent}/${part}` : part;
				if (!entries.has(parent)) entries.set(parent, new Set());
			}
		}
	}
	return entries;
}

async function inspectLegacyFolder(
	name: string,
	folder: string,
): Promise<LegacySkillCleanupResult> {
	const metadata = await optionalStat(folder);
	if (!metadata) return { name, path: folder, status: "absent" };
	if (!metadata.isDirectory()) {
		return {
			name,
			path: folder,
			status: "refused",
			reason: "path is not a real directory",
		};
	}

	try {
		const markerPath = join(folder, LEGACY_MARKER);
		const marker = parseMarker(
			await readRegularFileWithoutFollowing(markerPath),
		);
		assertSupportedLegacyVersion(marker.version);
		const directories = expectedDirectoryEntries(marker);
		for (const [relativeDirectory, expectedEntries] of directories) {
			const directory = relativeDirectory
				? safeLegacyPath(folder, relativeDirectory)
				: folder;
			const directoryMetadata = await optionalStat(directory);
			if (!directoryMetadata?.isDirectory()) {
				throw new Error(`expected real directory: ${relativeDirectory || "."}`);
			}
			const actualEntries = await readdir(directory);
			const unexpected = actualEntries.filter(
				(entry) => !expectedEntries.has(entry),
			);
			const missing = [...expectedEntries].filter(
				(entry) => !actualEntries.includes(entry),
			);
			if (unexpected.length > 0 || missing.length > 0) {
				throw new Error(
					[
						unexpected.length > 0
							? `unexpected entries: ${unexpected.join(", ")}`
							: "",
						missing.length > 0 ? `missing entries: ${missing.join(", ")}` : "",
					]
						.filter(Boolean)
						.join("; "),
				);
			}
		}
		for (const [relativePath, expectedHash] of marker.files) {
			const path = safeLegacyPath(folder, relativePath);
			const content = await readRegularFileWithoutFollowing(path);
			if (sha256(content) !== expectedHash) {
				throw new Error(`edited file refused: ${relativePath}`);
			}
		}
		return {
			name,
			path: folder,
			status: "eligible",
		};
	} catch (error) {
		return {
			name,
			path: folder,
			status: "refused",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

async function ensureRealArchiveRoot(path: string): Promise<void> {
	const existing = await optionalStat(path);
	if (existing) {
		if (!existing.isDirectory()) {
			throw new Error(`Legacy archive path is not a real directory: ${path}`);
		}
		return;
	}
	try {
		await mkdir(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const raced = await optionalStat(path);
		if (!raced?.isDirectory()) {
			throw new Error(`Legacy archive path is not a real directory: ${path}`);
		}
	}
}

export async function cleanupLegacySkills(options?: {
	home?: string;
	apply?: boolean;
	/** @internal Deterministic race-testing seam; package consumers should omit it. */
	afterQuarantine?: (context: {
		name: string;
		path: string;
		archivePath: string;
	}) => Promise<void>;
}): Promise<LegacyCleanupReport> {
	const home = options?.home ?? configuredHome();
	const root = resolveLegacySkillsRoot(home);
	const archiveRoot = resolveLegacyArchiveRoot(home);
	const apply = options?.apply === true;
	const results: LegacySkillCleanupResult[] = [];

	let archiveReady = false;
	for (const name of FLOW_GUIDANCE_TOPICS) {
		const path = join(root, name);
		const inspected = await inspectLegacyFolder(name, path);
		if (!apply || inspected.status !== "eligible") {
			results.push(inspected);
			continue;
		}
		if (!archiveReady) {
			await ensureRealArchiveRoot(archiveRoot);
			archiveReady = true;
		}
		const archivePath = join(
			archiveRoot,
			`${name}-${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}`,
		);
		try {
			await rename(path, archivePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			results.push({
				name,
				path,
				status: "refused",
				reason: "folder changed while cleanup was running",
			});
			continue;
		}
		await options?.afterQuarantine?.({ name, path, archivePath });
		const verified = await inspectLegacyFolder(name, archivePath);
		if (verified.status !== "eligible") {
			results.push({
				name,
				path,
				status: "quarantined",
				reason:
					"folder changed while cleanup was running; preserved for manual recovery",
				archivePath,
			});
			continue;
		}
		results.push({
			name,
			path,
			status: "archived",
			archivePath,
		});
	}

	return {
		mode: apply ? "apply" : "dry-run",
		root,
		archiveRoot,
		results,
	};
}
