import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	OPENCODE_TOOL_NAMES,
	OPENCODE_TOOL_PROJECTIONS,
} from "../src/adapters/opencode/tool-projections.generated";
import {
	FLOW_HOST_TOOL_SURFACE_DESCRIPTORS,
	FLOW_SURFACE_DESCRIPTORS,
	type RuntimeActionBinding,
} from "../src/adapters/opencode/tool-surface/descriptors";
import { FLOW_TOOL_DOCS_ROWS } from "../src/adapters/opencode/tool-surface/docs-rows.generated";
import { FLOW_EXECUTION_TOOL_RUNTIME_BINDINGS } from "../src/adapters/opencode/tool-surface/runtime-tools/execution-tools";
import { FLOW_PLANNING_RUNTIME_TOOL_RUNTIME_BINDINGS } from "../src/adapters/opencode/tool-surface/runtime-tools/planning-tools";
import { FLOW_REVIEW_TOOL_RUNTIME_BINDINGS } from "../src/adapters/opencode/tool-surface/runtime-tools/review-tools";
import {
	FLOW_TOOL_PAYLOAD_SCHEMA_OWNERS,
	FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY,
} from "../src/adapters/opencode/tool-surface/schemas";
import { FLOW_HISTORY_TOOL_RUNTIME_BINDINGS } from "../src/adapters/opencode/tool-surface/session-tools/history-tools";
import { FLOW_LIFECYCLE_TOOL_RUNTIME_BINDINGS } from "../src/adapters/opencode/tool-surface/session-tools/lifecycle-tools";
import { FLOW_PLANNING_SESSION_TOOL_RUNTIME_BINDINGS } from "../src/adapters/opencode/tool-surface/session-tools/planning-tools";
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

const IMPLEMENTATION_RUNTIME_ACTION_BINDINGS_BY_TOOL_NAME: Record<
	string,
	RuntimeActionBinding
> = {
	...FLOW_HISTORY_TOOL_RUNTIME_BINDINGS,
	...FLOW_PLANNING_SESSION_TOOL_RUNTIME_BINDINGS,
	...FLOW_LIFECYCLE_TOOL_RUNTIME_BINDINGS,
	...FLOW_PLANNING_RUNTIME_TOOL_RUNTIME_BINDINGS,
	...FLOW_EXECUTION_TOOL_RUNTIME_BINDINGS,
	...FLOW_REVIEW_TOOL_RUNTIME_BINDINGS,
};

const PAYLOAD_SCHEMA_OWNERS_BY_TOOL_NAME: Record<string, readonly string[]> =
	FLOW_TOOL_PAYLOAD_SCHEMA_OWNERS;

const PAYLOAD_SCHEMA_REGISTRY_BY_TOOL_NAME: Record<
	string,
	{
		argsShape: object;
		argsSchema: object;
		payloadSchemaOwners: readonly string[];
	}
> = FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY;

function projectPathExists(reference: string): boolean {
	const path = reference.split("#")[0] ?? reference;
	return existsSync(join(PROJECT_ROOT, path));
}

describe("workflow surface descriptor family", () => {
	test("keeps the OpenCode projection ordered from host tool descriptors", () => {
		const descriptorToolNames = FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.map(
			(descriptor) => descriptor.hostToolName,
		);

		expect(descriptorToolNames).toEqual(OPENCODE_TOOL_NAMES);
		expect(
			OPENCODE_TOOL_PROJECTIONS.map((projection) => projection.toolName),
		).toEqual(OPENCODE_TOOL_NAMES);
		expect(Object.keys(createTools({}))).toEqual(OPENCODE_TOOL_NAMES);
	});

	test("models runtime binding and core-action facets intentionally", () => {
		const byToolName = new Map(
			FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.map((descriptor) => [
				descriptor.hostToolName,
				descriptor,
			]),
		);

		for (const toolName of ["flow_doctor", "flow_review_render"] as const) {
			expect(byToolName.get(toolName)?.runtimeActionBinding).toEqual({
				kind: "none",
			});
			expect(byToolName.get(toolName)?.coreAction).toBeNull();
		}

		expect(byToolName.get("flow_status")?.runtimeActionBinding).toEqual({
			kind: "read",
			name: "load_status_session",
		});
		expect(byToolName.get("flow_history")?.runtimeActionBinding).toEqual({
			kind: "read",
			name: "list_session_history",
		});
		expect(byToolName.get("flow_history_show")?.runtimeActionBinding).toEqual({
			kind: "read",
			name: "load_history_session",
		});
		expect(byToolName.get("flow_auto_prepare")?.runtimeActionBinding).toEqual({
			kind: "read",
			name: "load_resumable_session",
		});
		expect(
			byToolName.get("flow_session_activate")?.runtimeActionBinding,
		).toEqual({
			kind: "workspace",
			name: "activate_session",
		});
		expect(byToolName.get("flow_session_activate")?.coreAction).toBeNull();
		expect(byToolName.get("flow_session_close")?.runtimeActionBinding).toEqual({
			kind: "workspace",
			name: "close_session",
		});
		expect(byToolName.get("flow_session_close")?.coreAction).toBeNull();
		expect(byToolName.get("flow_review_record_feature")?.coreAction).toBe(
			"record_reviewer_decision",
		);
		expect(byToolName.get("flow_review_record_final")?.coreAction).toBe(
			"record_reviewer_decision",
		);
	});

	test("references known core actions and correctly-typed runtime action catalogs", () => {
		const coreByName = new Map(
			CORE_ACTION_REGISTRY.map((action) => [action.name, action]),
		);
		const mutationActionNames = new Set(SESSION_MUTATION_ACTION_NAMES);
		const readActionNames = new Set(SESSION_READ_ACTION_NAMES);
		const workspaceActionNames = new Set(SESSION_WORKSPACE_ACTION_NAMES);
		const runtimeOwnerByBindingKind = {
			mutation: "src/runtime/application/session-actions.ts",
			read: "src/runtime/application/session-read-actions.ts",
			workspace: "src/runtime/application/session-workspace-actions.ts",
		} as const;

		for (const descriptor of FLOW_SURFACE_DESCRIPTORS) {
			if (descriptor.coreAction) {
				const coreAction = coreByName.get(descriptor.coreAction);
				expect(coreAction).toBeDefined();
				expect(descriptor.emittedEvents).toEqual(coreAction?.emits ?? []);
				expect(descriptor.invariantIds).toEqual(coreAction?.invariantIds ?? []);
			}

			switch (descriptor.runtimeActionBinding.kind) {
				case "none":
					break;
				case "mutation":
					expect(
						mutationActionNames.has(descriptor.runtimeActionBinding.name),
					).toBe(true);
					expect(descriptor.policyOwners).toContain(
						runtimeOwnerByBindingKind.mutation,
					);
					break;
				case "read":
					expect(
						readActionNames.has(descriptor.runtimeActionBinding.name),
					).toBe(true);
					expect(descriptor.policyOwners).toContain(
						runtimeOwnerByBindingKind.read,
					);
					break;
				case "workspace":
					expect(
						workspaceActionNames.has(descriptor.runtimeActionBinding.name),
					).toBe(true);
					expect(descriptor.policyOwners).toContain(
						runtimeOwnerByBindingKind.workspace,
					);
					break;
				default:
					descriptor.runtimeActionBinding satisfies never;
			}
		}
	});

	test("keeps descriptor runtime bindings aligned with implementation dispatch bindings", () => {
		const expectedRuntimeBoundTools = new Set(
			FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.filter(
				(descriptor) => descriptor.runtimeActionBinding.kind !== "none",
			).map((descriptor) => descriptor.hostToolName),
		);

		expect(
			Object.keys(IMPLEMENTATION_RUNTIME_ACTION_BINDINGS_BY_TOOL_NAME).sort(),
		).toEqual([...expectedRuntimeBoundTools].sort());

		for (const descriptor of FLOW_HOST_TOOL_SURFACE_DESCRIPTORS) {
			const implementationBinding =
				IMPLEMENTATION_RUNTIME_ACTION_BINDINGS_BY_TOOL_NAME[
					descriptor.hostToolName
				];
			if (descriptor.runtimeActionBinding.kind === "none") {
				expect(implementationBinding).toBeUndefined();
				continue;
			}
			expect(implementationBinding).toEqual(descriptor.runtimeActionBinding);
		}
	});

	test("keeps prompt-mode tool visibility in sync with descriptor metadata", () => {
		for (const [mode, contract] of Object.entries(FLOW_MODE_CONTRACTS)) {
			const descriptorAllowedTools = FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.filter(
				(descriptor) =>
					descriptor.allowedModes.includes(
						mode as (typeof descriptor.allowedModes)[number],
					),
			).map((descriptor) => descriptor.hostToolName);

			expect([...descriptorAllowedTools].sort()).toEqual(
				[...contract.allowedFlowTools].sort(),
			);
		}
	});

	test("keeps descriptor docs rows projected from docs metadata", () => {
		const expectedRows = FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.flatMap(
			(descriptor) =>
				descriptor.docsRowMetadata
					? [
							{
								toolName: descriptor.hostToolName,
								section: descriptor.docsRowMetadata.section,
								label: descriptor.docsRowMetadata.label,
								description: descriptor.hostDescription,
							},
						]
					: [],
		);

		expect(FLOW_TOOL_DOCS_ROWS).toEqual(expectedRows);
	});

	test("keeps descriptor ownership and verification anchors file-backed", () => {
		for (const descriptor of FLOW_SURFACE_DESCRIPTORS) {
			expect(descriptor.payloadSchemaOwners.length).toBeGreaterThan(0);
			expect(descriptor.policyOwners.length).toBeGreaterThan(0);
			expect(descriptor.verificationAnchors.length).toBeGreaterThan(0);

			expect(descriptor.registrationOwner).toMatch(
				/^src\/adapters\/opencode\/tool-surface\/.+-tools\.ts$/,
			);

			for (const reference of [
				descriptor.registrationOwner,
				...descriptor.payloadSchemaOwners,
				...descriptor.policyOwners,
				...descriptor.verificationAnchors,
			]) {
				expect(projectPathExists(reference)).toBe(true);
			}

			for (const payloadOwner of descriptor.payloadSchemaOwners) {
				expect(payloadOwner).toMatch(
					/(schemas\.ts|schema\.ts|report-schema\.ts)$/,
				);
			}
		}
	});

	test("keeps descriptor payload schema owners aligned with schema boundary metadata", () => {
		expect(Object.keys(PAYLOAD_SCHEMA_OWNERS_BY_TOOL_NAME).sort()).toEqual(
			FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.map(
				(descriptor) => descriptor.hostToolName,
			).sort(),
		);

		for (const descriptor of FLOW_HOST_TOOL_SURFACE_DESCRIPTORS) {
			const schemaRegistration =
				PAYLOAD_SCHEMA_REGISTRY_BY_TOOL_NAME[descriptor.hostToolName];
			expect(schemaRegistration?.argsShape).toBeDefined();
			expect(schemaRegistration?.argsSchema).toBeDefined();
			expect(
				PAYLOAD_SCHEMA_OWNERS_BY_TOOL_NAME[descriptor.hostToolName],
			).toEqual(descriptor.payloadSchemaOwners);
		}
	});

	test("keeps descriptor projections aligned with host projections", () => {
		for (const projection of OPENCODE_TOOL_PROJECTIONS) {
			const descriptor = FLOW_HOST_TOOL_SURFACE_DESCRIPTORS.find(
				(entry) => entry.hostToolName === projection.toolName,
			);
			expect(descriptor).toBeDefined();
			expect(projection.hostDescription === descriptor?.hostDescription).toBe(
				true,
			);
			expect(projection.definitionGuidance === descriptor?.promptGuidance).toBe(
				true,
			);
			expect(
				projection.coreAction === (descriptor?.coreAction ?? undefined),
			).toBe(true);
			expect(
				projection.runtimeAction ===
					(descriptor?.runtimeActionBinding.kind === "none"
						? undefined
						: descriptor?.runtimeActionBinding.name),
			).toBe(true);
		}
	});

	test("keeps role protocols inside the core-action subset", () => {
		const descriptorCoreActions = new Set(
			FLOW_SURFACE_DESCRIPTORS.map(
				(descriptor) => descriptor.coreAction,
			).filter(
				(action): action is NonNullable<typeof action> => action !== null,
			),
		);

		for (const protocol of CORE_ROLE_PROTOCOLS) {
			for (const actionName of protocol.ownedActions) {
				expect(descriptorCoreActions.has(actionName)).toBe(true);
			}
		}
	});
});
