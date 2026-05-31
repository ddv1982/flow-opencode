import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	FLOW_TOOL_PAYLOAD_SCHEMA_OWNERS,
	FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY,
} from "../src/adapters/opencode/tool-surface/schemas";
import {
	type FlowSurfaceMutationClass,
	OPENCODE_TOOL_NAMES_FROM_REGISTRY,
	OPENCODE_TOOL_REGISTRY,
	type OpenCodeToolName,
} from "../src/adapters/opencode/tool-surface/tool-registry";
import { createTools } from "../src/adapters/opencode/tools";
import { CORE_ROLE_PROTOCOLS } from "../src/core/protocols";
import { CORE_ACTION_REGISTRY } from "../src/core/registry";
import { FLOW_MODE_CONTRACTS } from "../src/prompts/mode-contracts";
import {
	SESSION_MUTATION_ACTION_NAMES,
	SESSION_READ_ACTION_NAMES,
	SESSION_WORKSPACE_ACTION_NAMES,
} from "../src/runtime/application";

const PROJECT_ROOT = join(import.meta.dir, "..");

const PUBLIC_TOOL_NAMES = [
	"flow_status",
	"flow_doctor",
	"flow_history",
	"flow_history_show",
	"flow_session_activate",
	"flow_plan_start",
	"flow_auto_prepare",
	"flow_session_close",
	"flow_plan_context_record",
	"flow_plan_apply",
	"flow_plan_approve",
	"flow_plan_select_features",
	"flow_run_start",
	"flow_run_complete_feature",
	"flow_reset_feature",
	"flow_review_record_feature",
	"flow_review_record_final",
	"flow_review_render",
] as const;

const EXPECTED_MUTATION_CLASS_BY_TOOL_NAME = {
	flow_status: "none",
	flow_doctor: "none",
	flow_history: "none",
	flow_history_show: "none",
	flow_session_activate: "control",
	flow_plan_start: "planning",
	flow_auto_prepare: "none",
	flow_session_close: "control",
	flow_plan_context_record: "planning",
	flow_plan_apply: "planning",
	flow_plan_approve: "planning",
	flow_plan_select_features: "planning",
	flow_run_start: "execution",
	flow_run_complete_feature: "execution",
	flow_reset_feature: "execution",
	flow_review_record_feature: "review",
	flow_review_record_final: "review",
	flow_review_render: "none",
} as const satisfies Record<OpenCodeToolName, FlowSurfaceMutationClass>;

type ToolDefinition = {
	description: string;
	args: object;
};

function projectPathExists(reference: string): boolean {
	const path = reference.split("#")[0] ?? reference;
	return existsSync(join(PROJECT_ROOT, path));
}

function docsRowsFromRegistry() {
	return OPENCODE_TOOL_REGISTRY.flatMap((entry) =>
		entry.docsRowMetadata
			? [
					{
						toolName: entry.toolName,
						section: entry.docsRowMetadata.section,
						label: entry.docsRowMetadata.label,
						description: entry.hostDescription,
					},
				]
			: [],
	);
}

describe("workflow surface descriptor family", () => {
	test("keeps public OpenCode tool names stable and registry-ordered", () => {
		const registryToolNames = OPENCODE_TOOL_REGISTRY.map(
			(entry) => entry.toolName,
		);

		expect(registryToolNames).toEqual([...PUBLIC_TOOL_NAMES]);
		expect(OPENCODE_TOOL_NAMES_FROM_REGISTRY).toEqual([...PUBLIC_TOOL_NAMES]);
		expect(Object.keys(createTools({}))).toEqual([...PUBLIC_TOOL_NAMES]);
	});

	test("keeps runtime tool registration, descriptions, and schemas projected from the registry", () => {
		const tools = createTools({}) as Record<string, ToolDefinition>;
		const schemaRegistry = FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY as Record<
			string,
			{
				argsShape: object;
				argsSchema: object;
				payloadSchemaOwners: readonly string[];
			}
		>;

		expect(Object.keys(schemaRegistry).sort()).toEqual(
			[...OPENCODE_TOOL_NAMES_FROM_REGISTRY].sort(),
		);

		for (const entry of OPENCODE_TOOL_REGISTRY) {
			const tool = tools[entry.toolName];
			const schemaRegistration = schemaRegistry[entry.toolName];

			expect(tool?.description).toBe(entry.hostDescription);
			expect(tool?.args).toBe(schemaRegistration?.argsShape);
			expect(schemaRegistration?.argsSchema).toBeDefined();
			expect(schemaRegistration?.payloadSchemaOwners.length).toBeGreaterThan(0);
			expect(FLOW_TOOL_PAYLOAD_SCHEMA_OWNERS[entry.toolName]).toEqual(
				schemaRegistration?.payloadSchemaOwners,
			);
		}
	});

	test("references known core actions and correctly-typed runtime action catalogs", () => {
		const coreByName = new Map(
			CORE_ACTION_REGISTRY.map((action) => [action.name, action]),
		);
		const mutationActionNames = new Set(SESSION_MUTATION_ACTION_NAMES);
		const readActionNames = new Set(SESSION_READ_ACTION_NAMES);
		const workspaceActionNames = new Set(SESSION_WORKSPACE_ACTION_NAMES);

		for (const entry of OPENCODE_TOOL_REGISTRY) {
			if (entry.coreAction) {
				expect(coreByName.has(entry.coreAction)).toBe(true);
			}

			switch (entry.runtimeActionBinding.kind) {
				case "none":
					break;
				case "mutation":
					expect(mutationActionNames.has(entry.runtimeActionBinding.name)).toBe(
						true,
					);
					break;
				case "read":
					expect(readActionNames.has(entry.runtimeActionBinding.name)).toBe(
						true,
					);
					break;
				case "workspace":
					expect(
						workspaceActionNames.has(entry.runtimeActionBinding.name),
					).toBe(true);
					break;
				default:
					entry.runtimeActionBinding satisfies never;
			}
		}
	});

	test("keeps mutation class stable in the registry", () => {
		for (const entry of OPENCODE_TOOL_REGISTRY) {
			expect(entry.mutationClass).toBe(
				EXPECTED_MUTATION_CLASS_BY_TOOL_NAME[entry.toolName],
			);
			if (entry.surfaceKind === "mutation") {
				expect(entry.mutationClass).not.toBe("none");
			}
			if (entry.surfaceKind === "read" || entry.surfaceKind === "render") {
				expect(entry.mutationClass).toBe("none");
			}
		}
	});

	test("keeps prompt-mode tool visibility in sync with registry metadata", () => {
		for (const [mode, contract] of Object.entries(FLOW_MODE_CONTRACTS)) {
			const registryAllowedTools = OPENCODE_TOOL_REGISTRY.filter((entry) =>
				(entry.allowedModes as readonly string[]).includes(mode),
			).map((entry) => entry.toolName);

			expect([...registryAllowedTools].sort()).toEqual(
				[...contract.allowedFlowTools].sort(),
			);
		}
	});

	test("keeps docs rows projected directly from registry docs metadata", () => {
		const registryDocsRows = docsRowsFromRegistry();

		expect(registryDocsRows.map((row) => row.toolName)).toEqual(
			OPENCODE_TOOL_NAMES_FROM_REGISTRY,
		);
		expect([...new Set(registryDocsRows.map((row) => row.label))]).toEqual([
			"Default OpenCode tool surface",
		]);
		expect(new Set(registryDocsRows.map((row) => row.section))).toEqual(
			new Set(["docs/development.md#current-runtime-tools"]),
		);
	});

	test("keeps schema owner metadata file-backed without descriptor projections", () => {
		for (const [toolName, registration] of Object.entries(
			FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY,
		)) {
			expect(OPENCODE_TOOL_NAMES_FROM_REGISTRY as readonly string[]).toContain(
				toolName,
			);
			expect(registration.payloadSchemaOwners.length).toBeGreaterThan(0);

			for (const payloadOwner of registration.payloadSchemaOwners) {
				expect(projectPathExists(payloadOwner)).toBe(true);
				expect(payloadOwner).toMatch(
					/(schemas\.ts|schema\.ts|report-schema\.ts)$/,
				);
			}
		}
	});

	test("keeps role protocols inside the registry core-action subset", () => {
		const registryCoreActions = new Set(
			OPENCODE_TOOL_REGISTRY.map((entry) => entry.coreAction).filter(
				(action): action is NonNullable<typeof action> => action !== null,
			),
		);

		for (const protocol of CORE_ROLE_PROTOCOLS) {
			for (const actionName of protocol.ownedActions) {
				expect(registryCoreActions.has(actionName)).toBe(true);
			}
		}
	});
});
