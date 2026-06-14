import type { FlowManagedMarkdownKind } from "./skill-markers";

export const SKILL_DOCUMENT_FILENAME = "SKILL.md";

export type FlowSkillFile = {
	/** Path inside the installed skill folder, `/`-separated. */
	relativePath: string;
	content: string;
};

export type FlowSkillDefinition = {
	name: string;
	files: readonly FlowSkillFile[];
};

export type FlowSkillSyncAction =
	| "installed"
	| "updated"
	| "updated_with_backup"
	| "unchanged"
	| "skipped_foreign";

export type FlowSkillSyncResult = {
	name: string;
	action: FlowSkillSyncAction;
	skillPath: string;
};

export type FlowManagedMarkdownSyncResult = {
	name: string;
	kind: FlowManagedMarkdownKind;
	action: FlowSkillSyncAction | "removed_retired";
	path: string;
};

export type FlowSkillSyncOptions = {
	homeDir?: string;
	version: string;
};

export type FlowSkillSyncStateEntry = {
	name: string;
	state: "synced" | "stale" | "missing" | "foreign";
	skillPath: string;
};

export type FlowManagedMarkdownSyncStateEntry = {
	name: string;
	kind: FlowManagedMarkdownKind;
	state: "synced" | "stale" | "missing" | "foreign";
	path: string;
};

export type PreNpmFlowPluginCopy = {
	path: string;
	flowOwned: boolean;
};
