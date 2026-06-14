import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import {
	FLOW_CORE_AGENTS,
	FLOW_CORE_COMMANDS,
	type FlowAgentConfig,
	type FlowCommandConfig,
	RETIRED_FLOW_COMMANDS,
} from "../config-shared";
import {
	type FlowManagedMarkdownKind,
	type FlowManagedMarkdownMarker,
	parseFlowManagedMarkdownMarker,
	renderFlowManagedMarkdownMarker,
	sha256,
} from "./skill-markers";
import {
	resolveFlowAgentsRoot,
	resolveFlowCommandsRoot,
	resolveFlowHomeDir,
} from "./sync-paths";
import type {
	FlowManagedMarkdownSyncResult,
	FlowManagedMarkdownSyncStateEntry,
	FlowSkillSyncOptions,
} from "./sync-types";
import { readOptionalFile } from "./sync-utils";

export function renderFlowCommandMarkdown(command: FlowCommandConfig): string {
	const frontmatter = [
		"---",
		`description: ${JSON.stringify(command.description)}`,
		...(command.agent ? [`agent: ${JSON.stringify(command.agent)}`] : []),
		...(command.subtask === undefined ? [] : [`subtask: ${command.subtask}`]),
		"---",
	];
	return `${frontmatter.join("\n")}\n\n${command.template}\n`;
}

export function renderFlowAgentMarkdown(agent: FlowAgentConfig): string {
	const frontmatter = [
		"---",
		`description: ${JSON.stringify(agent.description)}`,
		`mode: ${agent.mode}`,
		...(agent.reasoningEffort
			? [`reasoningEffort: ${agent.reasoningEffort}`]
			: []),
		...(agent.permission ? renderPermissionFrontmatter(agent.permission) : []),
		"---",
	];
	return `${frontmatter.join("\n")}\n\n${agent.prompt}\n`;
}

export function flowCommandDefinitions(): Map<string, string> {
	return new Map(
		Object.entries(FLOW_CORE_COMMANDS).map(([name, command]) => [
			name,
			renderFlowCommandMarkdown(command),
		]),
	);
}

export function flowAgentDefinitions(): Map<string, string> {
	return new Map(
		Object.entries(FLOW_CORE_AGENTS).map(([name, agent]) => [
			name,
			renderFlowAgentMarkdown(agent),
		]),
	);
}

export async function syncFlowCommandsAndAgents({
	homeDir = resolveFlowHomeDir(),
	version,
}: FlowSkillSyncOptions): Promise<FlowManagedMarkdownSyncResult[]> {
	const retired = await cleanupRetiredManagedMarkdownFiles({
		kind: "command",
		root: resolveFlowCommandsRoot(homeDir),
		names: RETIRED_FLOW_COMMANDS,
	});
	return [
		...retired.removed.map((path) => ({
			name: retiredNameFromPath(path),
			kind: "command" as const,
			action: "removed_retired" as const,
			path,
		})),
		...(await syncManagedMarkdownFiles({
			version,
			kind: "command",
			root: resolveFlowCommandsRoot(homeDir),
			files: flowCommandDefinitions(),
		})),
		...(await syncManagedMarkdownFiles({
			version,
			kind: "agent",
			root: resolveFlowAgentsRoot(homeDir),
			files: flowAgentDefinitions(),
		})),
	];
}

function retiredNameFromPath(path: string): string {
	const file = path.split(sep).at(-1) ?? path;
	return file.endsWith(".md") ? file.slice(0, -".md".length) : file;
}

/**
 * Removes files a previous release synced for since-retired names. Only
 * marker-owned files whose content still matches the recorded hash are
 * deleted; user-edited or foreign files stay untouched.
 */
export async function cleanupRetiredManagedMarkdownFiles(input: {
	kind: FlowManagedMarkdownKind;
	root: string;
	names: readonly string[];
	dryRun?: boolean;
}): Promise<{ removed: string[]; keptUserEdited: string[] }> {
	const removed: string[] = [];
	const keptUserEdited: string[] = [];
	for (const name of input.names) {
		const path = join(input.root, `${name}.md`);
		const markerPath = join(input.root, `.${name}.flow-version`);
		const markerContent = await readOptionalFile(markerPath);
		const marker =
			markerContent === null
				? null
				: parseFlowManagedMarkdownMarker(markerContent, input.kind, name);
		if (marker === null) {
			continue;
		}
		const content = await readOptionalFile(path);
		if (content !== null && sha256(content) !== marker.hash) {
			keptUserEdited.push(path);
			continue;
		}
		if (!input.dryRun) {
			await rm(path, { force: true });
			await rm(markerPath, { force: true });
			await rm(`${path}.backup`, { force: true });
		}
		removed.push(path);
	}
	return { removed, keptUserEdited };
}

export async function inspectFlowCommandAgentSyncState(
	homeDir = resolveFlowHomeDir(),
): Promise<FlowManagedMarkdownSyncStateEntry[]> {
	return [
		...(await inspectManagedMarkdownSyncState({
			kind: "command",
			root: resolveFlowCommandsRoot(homeDir),
			files: flowCommandDefinitions(),
		})),
		...(await inspectManagedMarkdownSyncState({
			kind: "agent",
			root: resolveFlowAgentsRoot(homeDir),
			files: flowAgentDefinitions(),
		})),
	];
}

function renderPermissionFrontmatter(
	permission: FlowAgentConfig["permission"],
) {
	if (!permission) {
		return [];
	}
	const lines = ["permission:"];
	for (const [key, value] of Object.entries(permission)) {
		if (typeof value === "string") {
			lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
			continue;
		}
		if (value && typeof value === "object") {
			lines.push(`  ${JSON.stringify(key)}:`);
			for (const [nestedKey, nestedValue] of Object.entries(value)) {
				lines.push(
					`    ${JSON.stringify(nestedKey)}: ${JSON.stringify(nestedValue)}`,
				);
			}
		}
	}
	return lines;
}

type SyncManagedMarkdownFilesInput = {
	version: string;
	kind: FlowManagedMarkdownKind;
	root: string;
	files: ReadonlyMap<string, string>;
};

async function syncManagedMarkdownFiles({
	version,
	kind,
	root,
	files,
}: SyncManagedMarkdownFilesInput): Promise<FlowManagedMarkdownSyncResult[]> {
	const results: FlowManagedMarkdownSyncResult[] = [];
	for (const [name, content] of files) {
		const path = join(root, `${name}.md`);
		const markerPath = join(root, `.${name}.flow-version`);
		const marker = await readManagedMarkdownMarker(markerPath, kind, name);
		const existing = await readOptionalFile(path);
		const desiredMarker = renderFlowManagedMarkdownMarker({
			kind,
			name,
			version,
			hash: sha256(content),
		});

		if (existing === null && marker === null) {
			await mkdir(root, { recursive: true });
			await writeFile(path, content, "utf8");
			await writeFile(markerPath, desiredMarker, "utf8");
			results.push({ name, kind, action: "installed", path });
			continue;
		}

		const owned = marker !== null || existing === content;
		if (!owned) {
			results.push({ name, kind, action: "skipped_foreign", path });
			continue;
		}

		if (existing === content) {
			if ((await readOptionalFile(markerPath)) !== desiredMarker) {
				await mkdir(root, { recursive: true });
				await writeFile(markerPath, desiredMarker, "utf8");
			}
			results.push({ name, kind, action: "unchanged", path });
			continue;
		}

		let backedUp = false;
		if (
			existing !== null &&
			marker !== null &&
			sha256(existing) !== marker.hash
		) {
			await writeFile(`${path}.backup`, existing, "utf8");
			backedUp = true;
		}
		await mkdir(root, { recursive: true });
		await writeFile(path, content, "utf8");
		await writeFile(markerPath, desiredMarker, "utf8");
		results.push({
			name,
			kind,
			action: backedUp ? "updated_with_backup" : "updated",
			path,
		});
	}
	return results;
}

async function inspectManagedMarkdownSyncState(input: {
	kind: FlowManagedMarkdownKind;
	root: string;
	files: ReadonlyMap<string, string>;
}): Promise<FlowManagedMarkdownSyncStateEntry[]> {
	const entries: FlowManagedMarkdownSyncStateEntry[] = [];
	for (const [name, content] of input.files) {
		const path = join(input.root, `${name}.md`);
		const markerPath = join(input.root, `.${name}.flow-version`);
		const existing = await readOptionalFile(path);
		const marker = await readManagedMarkdownMarker(
			markerPath,
			input.kind,
			name,
		);
		if (existing === null) {
			entries.push({ name, kind: input.kind, state: "missing", path });
			continue;
		}
		if (marker === null && existing !== content) {
			entries.push({ name, kind: input.kind, state: "foreign", path });
			continue;
		}
		entries.push({
			name,
			kind: input.kind,
			state: existing === content ? "synced" : "stale",
			path,
		});
	}
	return entries;
}

async function readManagedMarkdownMarker(
	path: string,
	kind: FlowManagedMarkdownKind,
	name: string,
): Promise<FlowManagedMarkdownMarker | null> {
	const content = await readOptionalFile(path);
	return content === null
		? null
		: parseFlowManagedMarkdownMarker(content, kind, name);
}
