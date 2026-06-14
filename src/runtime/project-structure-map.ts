import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import ignore from "ignore";
import {
	artifactMatchesAnyTarget,
	normalizeContextPath,
} from "./context-paths";
import type { Session } from "./schema";

export type ProjectStructureEntryKind = "directory" | "file";
export type ProjectStructureEntryRole =
	| "changed"
	| "planned"
	| "config"
	| "test"
	| "docs"
	| "source"
	| "other";

export type ProjectStructureEntry = {
	path: string;
	kind: ProjectStructureEntryKind;
	depth: number;
	role: ProjectStructureEntryRole;
	markers: string[];
};

export type ProjectStructureMapProjection = {
	rootName: string;
	entryCount: number;
	truncated: boolean;
	maxDepth: number;
	maxEntries: number;
	ignoredDirectories: string[];
	ignoreSources: string[];
	focus: {
		plannedTargets: string[];
		plannedTargetsRedacted: number;
		changedArtifacts: string[];
		changedArtifactsRedacted: number;
	};
	entries: ProjectStructureEntry[];
};

type ProjectStructureMapOptions = {
	maxDepth?: number;
	maxEntries?: number;
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES = 160;
const IGNORED_DIRECTORY_NAMES = new Set([
	".cache",
	".flow",
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
	"vendor",
]);

const SENSITIVE_DIRECTORY_NAMES = new Set([
	".aws",
	".azure",
	".gcloud",
	".secrets",
	"secrets",
]);
const SENSITIVE_FILE_NAMES = new Set([".env", ".netrc", ".npmrc", ".pypirc"]);
const SENSITIVE_FILE_EXTENSIONS = [".crt", ".key", ".p12", ".pem"];
const REDACTED_FOCUS_PATH = "[redacted sensitive or ignored path]";

const CONFIG_FILE_NAMES = new Set([
	".eslintrc",
	".eslintrc.cjs",
	".eslintrc.js",
	".eslintrc.json",
	".gitignore",
	"AGENTS.md",
	"CLAUDE.md",
	"Makefile",
	"README.md",
	"biome.json",
	"bun.lock",
	"bun.lockb",
	"deno.json",
	"package-lock.json",
	"package.json",
	"pnpm-lock.yaml",
	"tsconfig.json",
	"yarn.lock",
]);

function uniqueStrings(values: string[]): string[] {
	return Array.from(
		new Set(values.map((value) => normalizeContextPath(value)).filter(Boolean)),
	);
}

function plannedTargets(session: Session | null | undefined): string[] {
	return uniqueStrings(
		(session?.plan?.features ?? []).flatMap((feature) => [
			...feature.fileTargets,
			...(feature.reviewScope ?? []).map((target) => target.target),
		]),
	);
}

function changedArtifacts(session: Session | null | undefined): string[] {
	return uniqueStrings([
		...(session?.artifacts ?? []).map((artifact) => artifact.path),
		...(session?.execution.history ?? []).flatMap((entry) =>
			entry.artifactsChanged.map((artifact) => artifact.path),
		),
	]);
}

function classifyRole(
	path: string,
	kind: ProjectStructureEntryKind,
	targets: string[],
	changed: string[],
): ProjectStructureEntryRole {
	if (artifactMatchesAnyTarget(path, changed)) {
		return "changed";
	}
	if (artifactMatchesAnyTarget(path, targets)) {
		return "planned";
	}
	const name = basename(path);
	if (CONFIG_FILE_NAMES.has(name)) {
		return "config";
	}
	if (
		path === "docs" ||
		path.startsWith("docs/") ||
		name.toLowerCase().endsWith(".md")
	) {
		return "docs";
	}
	if (
		path === "tests" ||
		path.startsWith("tests/") ||
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
	) {
		return "test";
	}
	if (kind === "directory" && (path === "src" || path.startsWith("src/"))) {
		return "source";
	}
	if (kind === "file" && path.startsWith("src/")) {
		return "source";
	}
	return "other";
}

function markersForRole(role: ProjectStructureEntryRole): string[] {
	return role === "other" ? [] : [role];
}

function shouldIgnoreDirectory(name: string): boolean {
	return IGNORED_DIRECTORY_NAMES.has(name);
}

function isSensitivePath(
	path: string,
	kind: ProjectStructureEntryKind,
): boolean {
	const name = basename(path).toLowerCase();
	if (kind === "directory") {
		return SENSITIVE_DIRECTORY_NAMES.has(name);
	}
	if (SENSITIVE_FILE_NAMES.has(name) || name.startsWith(".env.")) {
		return true;
	}
	return SENSITIVE_FILE_EXTENSIONS.some((extension) =>
		name.endsWith(extension),
	);
}

function isSensitiveFocusPath(path: string): boolean {
	const normalizedPath = normalizeContextPath(path);
	const segments = normalizedPath
		.split("/")
		.map((segment) => segment.toLowerCase())
		.filter(Boolean);
	const name = segments.at(-1) ?? "";
	return (
		segments.some((segment) => SENSITIVE_DIRECTORY_NAMES.has(segment)) ||
		SENSITIVE_FILE_NAMES.has(name) ||
		name.startsWith(".env.") ||
		SENSITIVE_FILE_EXTENSIONS.some((extension) => name.endsWith(extension))
	);
}

function isSafeRelativeIgnorePath(path: string): boolean {
	const normalizedPath = normalizeContextPath(path);
	return (
		normalizedPath.length > 0 &&
		!normalizedPath.startsWith("/") &&
		normalizedPath !== ".." &&
		!normalizedPath.startsWith("../") &&
		!normalizedPath.includes("/../")
	);
}

async function createGitignoreMatcher(root: string) {
	try {
		const contents = await readFile(join(root, ".gitignore"), "utf8");
		return ignore().add(contents);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		return null;
	}
}

function isIgnoredByGitignore(
	path: string,
	kind: ProjectStructureEntryKind,
	gitignoreMatcher: ReturnType<typeof ignore> | null,
): boolean {
	if (!gitignoreMatcher || !isSafeRelativeIgnorePath(path)) {
		return false;
	}
	if (gitignoreMatcher.ignores(path)) {
		return true;
	}
	return kind === "directory" && gitignoreMatcher.ignores(`${path}/`);
}

function isIgnoredFocusPath(
	path: string,
	gitignoreMatcher: ReturnType<typeof ignore> | null,
): boolean {
	const normalizedPath = normalizeContextPath(path);
	if (!isSafeRelativeIgnorePath(normalizedPath)) {
		return true;
	}
	if (!gitignoreMatcher) {
		return false;
	}
	return (
		gitignoreMatcher.ignores(normalizedPath) ||
		gitignoreMatcher.ignores(`${normalizedPath}/`)
	);
}

function sanitizeFocusValues(
	values: string[],
	gitignoreMatcher: ReturnType<typeof ignore> | null,
): { values: string[]; redacted: number } {
	let redacted = 0;
	return {
		values: values.map((value) => {
			if (
				isSensitiveFocusPath(value) ||
				isIgnoredFocusPath(value, gitignoreMatcher)
			) {
				redacted += 1;
				return REDACTED_FOCUS_PATH;
			}
			return normalizeContextPath(value);
		}),
		redacted,
	};
}

export async function buildProjectStructureMap(
	root: string,
	session?: Session | null,
	options: ProjectStructureMapOptions = {},
): Promise<ProjectStructureMapProjection> {
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const targets = plannedTargets(session);
	const changed = changedArtifacts(session);
	const entries: ProjectStructureEntry[] = [];
	const gitignoreMatcher = await createGitignoreMatcher(root);
	const sanitizedTargets = sanitizeFocusValues(targets, gitignoreMatcher);
	const sanitizedChanged = sanitizeFocusValues(changed, gitignoreMatcher);
	let truncated = false;

	async function visit(directory: string, depth: number): Promise<void> {
		if (entries.length >= maxEntries) {
			truncated = true;
			return;
		}
		if (depth > maxDepth) {
			truncated = true;
			return;
		}

		let dirents: Dirent[];
		try {
			dirents = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}

		const sorted = dirents.sort((left, right) => {
			if (left.isDirectory() !== right.isDirectory()) {
				return left.isDirectory() ? -1 : 1;
			}
			return left.name.localeCompare(right.name);
		});

		for (const entry of sorted) {
			if (entries.length >= maxEntries) {
				truncated = true;
				return;
			}
			if (!entry.isDirectory() && !entry.isFile()) {
				continue;
			}
			const absolutePath = join(directory, entry.name);
			const path = normalizeContextPath(
				relative(root, absolutePath).split(sep).join("/"),
			);
			if (!path) {
				continue;
			}
			const kind = entry.isDirectory() ? "directory" : "file";
			if (kind === "directory" && shouldIgnoreDirectory(entry.name)) {
				continue;
			}
			if (isSensitivePath(path, kind)) {
				continue;
			}
			if (isIgnoredByGitignore(path, kind, gitignoreMatcher)) {
				continue;
			}
			const role = classifyRole(path, kind, targets, changed);
			entries.push({
				path,
				kind,
				depth,
				role,
				markers: markersForRole(role),
			});
			if (entry.isDirectory()) {
				await visit(absolutePath, depth + 1);
			}
		}
	}

	await visit(root, 1);

	return {
		rootName: basename(root) || root,
		entryCount: entries.length,
		truncated,
		maxDepth,
		maxEntries,
		ignoredDirectories: [...IGNORED_DIRECTORY_NAMES].sort(),
		ignoreSources: [
			"built-in-directories",
			"sensitive-names",
			...(gitignoreMatcher ? [".gitignore"] : []),
		],
		focus: {
			plannedTargets: sanitizedTargets.values,
			plannedTargetsRedacted: sanitizedTargets.redacted,
			changedArtifacts: sanitizedChanged.values,
			changedArtifactsRedacted: sanitizedChanged.redacted,
		},
		entries,
	};
}
