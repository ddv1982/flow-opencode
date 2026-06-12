import { createHash } from "node:crypto";
import { join } from "node:path";

export const FLOW_SKILLS_DIRECTORY = join(".config", "opencode", "skills");

export const FLOW_SKILL_MARKER_FILENAME = ".flow-skill-version";

export const FLOW_SKILL_BACKUP_FILENAME = "SKILL.md.backup";

export const FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH = join(
	".config",
	"opencode",
	"plugins",
	"flow.js",
);

export const FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER =
	"// Managed by flow-opencode install/uninstall\n";

export const FLOW_SKILL_GENERATED_MARKER = "flow-opencode-generated-skill";
export const FLOW_SKILL_GENERATED_VERSION = "1";

type FlowSkillGeneratedMarker = {
	name: string;
	version: string;
	hash: string;
};

type FlowSkillDocumentInspection =
	| { kind: "not_generated" }
	| { kind: "valid_generated"; marker: FlowSkillGeneratedMarker }
	| { kind: "invalid_generated"; reason: string };

const FLOW_SKILL_GENERATED_MARKER_PREFIX = `<!-- ${FLOW_SKILL_GENERATED_MARKER} `;
const FLOW_SKILL_GENERATED_MARKER_PATTERN = new RegExp(
	`^<!-- ${FLOW_SKILL_GENERATED_MARKER} name=([a-z0-9]+(?:-[a-z0-9]+)*) version=([0-9]+) hash=sha256:([a-f0-9]{64}) -->$`,
	"u",
);

export function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

export function inspectFlowSkillDocument(
	document: string,
): FlowSkillDocumentInspection {
	const lines = document.split("\n");
	const markerIndexes = lines.flatMap((line, index) =>
		line.startsWith(FLOW_SKILL_GENERATED_MARKER_PREFIX) ? [index] : [],
	);
	if (markerIndexes.length === 0) {
		return { kind: "not_generated" };
	}
	if (markerIndexes.length > 1) {
		return { kind: "invalid_generated", reason: "duplicate_marker" };
	}

	const markerIndex = markerIndexes[0];
	if (markerIndex === undefined) {
		return { kind: "not_generated" };
	}
	const markerLine = lines[markerIndex];
	if (markerLine === undefined) {
		return { kind: "invalid_generated", reason: "malformed_marker" };
	}
	const match = markerLine.match(FLOW_SKILL_GENERATED_MARKER_PATTERN);
	if (!match) {
		return { kind: "invalid_generated", reason: "malformed_marker" };
	}

	const [, name, version, hash] = match;
	if (name === undefined || version === undefined || hash === undefined) {
		return { kind: "invalid_generated", reason: "malformed_marker" };
	}
	const managedPayload = [
		...lines.slice(0, markerIndex),
		...lines.slice(markerIndex + 1),
	].join("\n");
	if (sha256(managedPayload) !== hash) {
		return { kind: "invalid_generated", reason: "hash_mismatch" };
	}

	return {
		kind: "valid_generated",
		marker: { name, version, hash },
	};
}

type FlowSkillFolderMarker = {
	plugin: string;
	version: string;
	hash: string | null;
};

const FLOW_SKILL_MARKER_PLUGIN = "opencode-plugin-flow";
const FLOW_SKILL_MARKER_FILE_PREFIX = "file=";
const FLOW_SKILL_MARKER_FILE_HASH_SEPARATOR = "=sha256:";

/**
 * Renders the plugin-owned `.flow-skill-version` marker. The top-level `hash`
 * stays the SKILL.md content hash (compatible with pre-existing markers and
 * `parseFlowSkillFolderMarker`); each shipped file additionally gets a
 * `file=<relative-path>=sha256:<hash>` line so sync and uninstall can detect
 * user edits per file and know exactly which files the plugin owns.
 */
export function renderFlowSkillFolderMarker(marker: {
	version: string;
	hash: string;
	files?: ReadonlyArray<{ relativePath: string; hash: string }>;
}): string {
	return [
		`plugin=${FLOW_SKILL_MARKER_PLUGIN}`,
		`version=${marker.version}`,
		`hash=sha256:${marker.hash}`,
		...(marker.files ?? []).map(
			(file) =>
				`${FLOW_SKILL_MARKER_FILE_PREFIX}${file.relativePath}${FLOW_SKILL_MARKER_FILE_HASH_SEPARATOR}${file.hash}`,
		),
		"",
	].join("\n");
}

/**
 * Extracts the per-file hash entries from a folder marker. Markers written
 * before per-file tracking simply yield an empty map.
 */
export function parseFlowSkillFileHashes(content: string): Map<string, string> {
	const hashes = new Map<string, string>();
	for (const line of content.split("\n")) {
		if (!line.startsWith(FLOW_SKILL_MARKER_FILE_PREFIX)) {
			continue;
		}
		const entry = line.slice(FLOW_SKILL_MARKER_FILE_PREFIX.length);
		const separator = entry.lastIndexOf(FLOW_SKILL_MARKER_FILE_HASH_SEPARATOR);
		if (separator === -1) {
			continue;
		}
		const relativePath = entry.slice(0, separator);
		const hash = entry.slice(
			separator + FLOW_SKILL_MARKER_FILE_HASH_SEPARATOR.length,
		);
		if (relativePath.length > 0 && /^[a-f0-9]{64}$/.test(hash)) {
			hashes.set(relativePath, hash);
		}
	}
	return hashes;
}

export function parseFlowSkillFolderMarker(
	content: string,
): FlowSkillFolderMarker | null {
	const entries = new Map<string, string>();
	for (const line of content.split("\n")) {
		const separator = line.indexOf("=");
		if (separator === -1) {
			continue;
		}
		entries.set(line.slice(0, separator), line.slice(separator + 1));
	}
	const plugin = entries.get("plugin");
	const version = entries.get("version");
	if (plugin !== FLOW_SKILL_MARKER_PLUGIN || !version) {
		return null;
	}
	const hash = entries.get("hash");
	return {
		plugin,
		version,
		hash: hash?.startsWith("sha256:") ? hash.slice("sha256:".length) : null,
	};
}
