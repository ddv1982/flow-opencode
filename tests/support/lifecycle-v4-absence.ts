import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const EXCLUDED_DIRECTORY_NAMES = new Set([
	".flow",
	".git",
	".release-artifacts",
	"coverage",
	"dist",
	"node_modules",
]);

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

const HISTORICAL_PROSE_FILES = new Set(["CHANGELOG.md"]);

const ALLOWED_NEGATIVE_REFERENCE_LINES = new Map<string, RegExp[]>([
	[
		"docs/plan/session-v4-lifecycle-hardening-plan.md",
		[
			/\b(?:remove|removes|does not treat|preventing)\s+session\s+v3(?:-specific)?\b/i,
			/\bno\s+session\s+v3(?:-specific)?\b/i,
		],
	],
]);

const SESSION_VERSION_THREE_PATTERNS = [
	new RegExp(String.raw`\bsession\s+v${3}\b`, "i"),
	new RegExp(String.raw`\bv${3}\s+sessions?\b`, "i"),
	new RegExp(String.raw`\bsession[-_ ]?v${3}\b`, "i"),
	new RegExp(String.raw`\bv${3}[-_ ]?session\b`, "i"),
	new RegExp(String.raw`\blegacy[-_ ]?v${3}\b`, "i"),
	new RegExp(String.raw`\bv2/v${3}\s+sessions?\b`, "i"),
	new RegExp(String.raw`\bversion\s+${3}\s+sessions?\b`, "i"),
	new RegExp(String.raw`"version"\s*:\s*${3}\b(?!\.)`),
	new RegExp(String.raw`\bversion\s*:\s*${3}\b(?!\.)`),
	new RegExp(
		String.raw`\b(?:raw|session|archive|fixture|legacy\w*)\.version\s*(?:={2,3}|!={1,2})\s*${3}\b`,
		"i",
	),
	new RegExp(
		String.raw`\b(?:sessionv${3}|v${3}session)(?:schema|reader|loader|parser|migrator|migration|adapter|fixture|archive|cleanup)\b`,
		"i",
	),
	new RegExp(
		String.raw`\b(?:migrate|upgrade|convert|read|load|parse)[a-z0-9_]*sessionv${3}\b`,
		"i",
	),
	new RegExp(
		String.raw`\b(?:session)?version\s*:\s*(?:z\.)?literal\(\s*${3}\s*\)`,
		"i",
	),
	new RegExp(
		String.raw`\b(?:raw|session|archive|fixture|legacy\w*)\.?(?:version)?\s*=\s*${3}\b`,
		"i",
	),
] as const;

const SESSION_VERSION_THREE_CONTEXT_PATTERNS = [
	new RegExp(
		String.raw`\bswitch\s*\(\s*[^)]*\b(?:raw|session|archive|fixture|legacy\w*)\s*(?:\.\s*version|\[\s*["']version["']\s*\])[^)]*\)\s*\{[\s\S]{0,4096}?\bcase\s+${3}\s*:`,
		"i",
	),
	new RegExp(
		String.raw`\b(?:(?:supported|accepted|recognized|readable|legacy)[-_]?)?session[-_]?(?:(?:supported|accepted|recognized|readable|legacy)[-_]?)?versions?\b\s*(?::\s*[^=\n]+)?=\s*\[[^\]\n]{0,512}\b${3}\b(?!\.)`,
		"i",
	),
] as const;

const LEGACY_FLAT_LIFECYCLE_EXAMPLE_PATTERNS = [
	/\bflow_status\b`?\s*(?:with\s+)?(?:\(\s*)?`?\{\s*(?!["']?request["']?\s*:)(?:["']?[A-Za-z_][A-Za-z0-9_]*["']?\s*:)/gi,
	/\bflow_review_start\b`?\s*(?:with\s+)?(?:\(\s*)?`?\{\s*(?!["']?request["']?\s*:)(?:["']?[A-Za-z_][A-Za-z0-9_]*["']?\s*:)/gi,
	/\bflow_feature_complete\b`?\s*(?:with\s+)?(?:\(\s*)?`?\{\s*(?!["']?request["']?\s*:)(?:["']?[A-Za-z_][A-Za-z0-9_]*["']?\s*:)/gi,
	/\bflow_session_close\b`?\s*(?:with\s+)?(?:\(\s*)?`?\{\s*(?!["']?request["']?\s*:)(?:["']?[A-Za-z_][A-Za-z0-9_]*["']?\s*:)/gi,
] as const;

export type SessionVersionAbsenceViolation = {
	path: string;
	line: number;
	text: string;
};

function normalizedRelative(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}

function isHistoricalProse(path: string): boolean {
	return HISTORICAL_PROSE_FILES.has(path);
}

function isAllowedNegativeReference(path: string, line: string): boolean {
	return (
		ALLOWED_NEGATIVE_REFERENCE_LINES.get(path)?.some((pattern) =>
			pattern.test(line),
		) ?? false
	);
}

async function filesBelow(path: string): Promise<string[]> {
	const entries = await readdir(path, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = resolve(path, entry.name);
			if (entry.isDirectory()) {
				return EXCLUDED_DIRECTORY_NAMES.has(entry.name)
					? []
					: filesBelow(entryPath);
			}
			return entry.isFile() ? [entryPath] : [];
		}),
	);
	return nested.flat();
}

export async function auditSessionV4OnlyState(
	repositoryRoot = process.cwd(),
): Promise<SessionVersionAbsenceViolation[]> {
	let files: string[];
	try {
		files = await filesBelow(repositoryRoot);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const violations: SessionVersionAbsenceViolation[] = [];
	for (const file of files) {
		const path = normalizedRelative(repositoryRoot, file);
		if (isHistoricalProse(path)) continue;
		if (SESSION_VERSION_THREE_PATTERNS.some((pattern) => pattern.test(path))) {
			violations.push({ path, line: 0, text: "Session-version-specific path" });
		}
		if ((await stat(file)).size > MAX_TEXT_FILE_BYTES) continue;
		const bytes = await readFile(file);
		if (bytes.includes(0)) continue;
		const contents = bytes.toString("utf8");
		const lines = contents.split(/\r?\n/);
		for (const pattern of SESSION_VERSION_THREE_CONTEXT_PATTERNS) {
			const match = pattern.exec(contents);
			if (!match || match.index === undefined) continue;
			const line = contents.slice(0, match.index).split(/\r?\n/).length;
			violations.push({
				path,
				line,
				text: (lines[line - 1] ?? "").trim().slice(0, 240),
			});
		}
		for (const pattern of LEGACY_FLAT_LIFECYCLE_EXAMPLE_PATTERNS) {
			for (const match of contents.matchAll(pattern)) {
				if (match.index === undefined) continue;
				const line = contents.slice(0, match.index).split(/\r?\n/).length;
				violations.push({
					path,
					line,
					text: (lines[line - 1] ?? "").trim().slice(0, 240),
				});
			}
		}
		for (const [index, line] of lines.entries()) {
			const hasSessionVersionThree = SESSION_VERSION_THREE_PATTERNS.some(
				(pattern) => pattern.test(line),
			);
			if (hasSessionVersionThree && !isAllowedNegativeReference(path, line)) {
				violations.push({
					path,
					line: index + 1,
					text: line.trim().slice(0, 240),
				});
			}
		}
	}
	return violations;
}
