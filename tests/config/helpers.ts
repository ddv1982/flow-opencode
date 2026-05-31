import { expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tool } from "../../src/adapters/opencode/sdk";
import { createTools } from "../../src/adapters/opencode/tools";

type AgentTools = {
	edit?: boolean;
	write?: boolean;
	bash?: boolean;
};

type AgentPermission = {
	edit?: string;
	bash?: string;
	external_directory?: string;
	task?: Record<string, string>;
};

export type AgentConfigShape = {
	mode?: string;
	description?: string;
	prompt?: string;
	tools?: AgentTools;
	permission?: AgentPermission;
	[key: string]: unknown;
};

export type CommandConfigShape = {
	description?: string;
	agent?: string;
	template?: string;
	[key: string]: unknown;
};

export type MutableConfig = {
	agent?: Record<string, AgentConfigShape>;
	command?: Record<string, CommandConfigShape>;
};

type ToolDefinition = {
	args: Record<string, unknown>;
};

export type FlowPluginHooks = {
	hooks?: Record<string, unknown>;
};

type ToolSchemaName =
	| "flow_status"
	| "flow_doctor"
	| "flow_history"
	| "flow_history_show"
	| "flow_session_activate"
	| "flow_session_close"
	| "flow_plan_start"
	| "flow_auto_prepare"
	| "flow_plan_context_record"
	| "flow_plan_apply"
	| "flow_plan_approve"
	| "flow_plan_select_features"
	| "flow_run_start"
	| "flow_run_complete_feature"
	| "flow_reset_feature"
	| "flow_review_record_feature"
	| "flow_review_record_final"
	| "flow_review_render";

type ToolSchemas = Record<
	ToolSchemaName,
	ReturnType<typeof tool.schema.object>
>;

export function getToolSchemas() {
	const tools = createTools({}) as unknown as Record<string, ToolDefinition>;

	return {
		tools,
		schemas: Object.fromEntries(
			Object.entries(tools).map(([name, definition]) => [
				name,
				tool.schema.object(definition.args),
			]),
		) as ToolSchemas,
	};
}

export function expectNoFlowManagedCompaction(content: string) {
	const normalized = content.toLowerCase();

	expect(normalized).not.toContain("compaction");
	expect(normalized).not.toContain("token accounting");
	expect(normalized).not.toContain("token measurement");
}

export function expectStructuredSections(content: string, sections: string[]) {
	for (const section of sections) {
		expect(content).toContain(`## ${section}`);
	}
}

export function projectPath(relativePath: string) {
	return join(import.meta.dir, "..", "..", relativePath);
}

export async function readJson(relativePath: string) {
	return JSON.parse(
		await readFile(projectPath(relativePath), "utf8"),
	) as Record<string, unknown>;
}

export function asJson(value: unknown) {
	return JSON.stringify(value);
}
