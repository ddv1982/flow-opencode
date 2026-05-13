import type { CoreActionName } from "../../../core/registry";
import type { SemanticInvariantId } from "../../../runtime/domain";
import { optionalCoreActionProjectionMetadata } from "./core-action-projection";
import { FLOW_TOOL_PAYLOAD_SCHEMA_OWNERS } from "./schemas";
import {
	type FlowSurfaceKind,
	type FlowSurfaceMode,
	type FlowSurfaceMutationClass,
	OPENCODE_TOOL_REGISTRY,
	type OpenCodeToolName,
	type RuntimeActionBinding,
} from "./tool-registry";

export type {
	FlowSurfaceKind,
	FlowSurfaceMode,
	FlowSurfaceMutationClass,
	RuntimeActionBinding,
} from "./tool-registry";

export type FlowSurfaceDescriptor = {
	id: string;
	hostToolName: string | null;
	surfaceKind: FlowSurfaceKind;
	/** Exact runtime action catalog binding for this surface, when any. */
	runtimeActionBinding: RuntimeActionBinding;
	/** Host-neutral workflow-core action, when this surface projects one. */
	coreAction: CoreActionName | null;
	registrationOwner: string;
	payloadSchemaOwners: readonly string[];
	mutationClass: FlowSurfaceMutationClass;
	allowedModes: readonly FlowSurfaceMode[];
	emittedEvents: readonly string[];
	invariantIds: readonly SemanticInvariantId[];
	policyOwners: readonly string[];
	hostDescription: string;
	promptGuidance?: string;
	docsRowMetadata?: {
		section: string;
		label: string;
	};
	verificationAnchors: readonly string[];
};

type FlowDescriptorGovernance = {
	registrationOwner: string;
	policyOwners: readonly string[];
	verificationAnchors: readonly string[];
};

const FLOW_DESCRIPTOR_GOVERNANCE_BY_TOOL_NAME = {
	flow_status: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/docs-tool-parity.test.ts",
		],
	},
	flow_doctor: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		policyOwners: ["src/runtime/application/doctor-checks.ts"],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_history: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_history_show: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_session_activate: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		policyOwners: ["src/runtime/application/session-workspace-actions.ts"],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_plan_start: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/planning-tools.ts",
		policyOwners: ["src/runtime/application/session-workspace-actions.ts"],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/protocol-parity.test.ts",
		],
	},
	flow_auto_prepare: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/planning-tools.ts",
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_attachments_materialize: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/attachment-tools.ts",
		policyOwners: [
			"src/adapters/opencode/attachment-policy.ts",
			"src/adapters/opencode/attachment-store.ts",
			"src/adapters/opencode/attachment-materialization.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/attachment-materialization.test.ts",
		],
	},
	flow_session_close: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/lifecycle-tools.ts",
		policyOwners: ["src/runtime/application/session-workspace-actions.ts"],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_plan_context_record: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		policyOwners: ["src/runtime/application/session-actions.ts"],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/config/prompt-contracts.test.ts",
		],
	},
	flow_plan_apply: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/plan.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/protocol-parity.test.ts",
		],
	},
	flow_plan_approve: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/plan.ts",
		],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_plan_select_features: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/plan.ts",
		],
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	flow_run_start: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/execution.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/protocol-parity.test.ts",
		],
	},
	flow_run_complete_feature: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/domain/review-scope-accounting.ts",
			"src/runtime/transitions/execution-completion-validation.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/runtime/final-completion-gates.test.ts",
			"tests/runtime/worker-result-contracts.test.ts",
		],
	},
	flow_reset_feature: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/recovery.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/recovery-hint-parity.test.ts",
		],
	},
	flow_review_record_feature: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/review.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/runtime/final-review-contracts.test.ts",
		],
	},
	flow_review_record_final: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts",
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/domain/review-scope-accounting.ts",
			"src/runtime/transitions/execution-completion-validation.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/runtime/final-review-contracts.test.ts",
		],
	},
	flow_review_render: {
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts",
		policyOwners: [
			"src/audit/report-presenter.ts",
			"src/audit/report-schema.ts",
		],
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/config/prompt-contracts.test.ts",
		],
	},
} as const satisfies Record<OpenCodeToolName, FlowDescriptorGovernance>;

function payloadSchemaOwnersFor(toolName: OpenCodeToolName): readonly string[] {
	const payloadSchemaOwners = FLOW_TOOL_PAYLOAD_SCHEMA_OWNERS[toolName];
	if (!payloadSchemaOwners) {
		throw new Error(`Missing payload schema owners for '${toolName}'.`);
	}
	return payloadSchemaOwners;
}

function coreActionMetadata(
	coreActionName: CoreActionName | null,
): Pick<FlowSurfaceDescriptor, "emittedEvents" | "invariantIds"> {
	const coreAction = optionalCoreActionProjectionMetadata(coreActionName);
	return {
		emittedEvents: coreAction?.emits ?? [],
		invariantIds: coreAction?.invariantIds ?? [],
	};
}

export const FLOW_SURFACE_DESCRIPTORS: readonly FlowSurfaceDescriptor[] =
	OPENCODE_TOOL_REGISTRY.map((entry) => {
		const governance = FLOW_DESCRIPTOR_GOVERNANCE_BY_TOOL_NAME[entry.toolName];
		const { emittedEvents, invariantIds } = coreActionMetadata(
			entry.coreAction,
		);

		return {
			id: entry.toolName,
			hostToolName: entry.toolName,
			surfaceKind: entry.surfaceKind,
			runtimeActionBinding: entry.runtimeActionBinding,
			coreAction: entry.coreAction,
			registrationOwner: governance.registrationOwner,
			payloadSchemaOwners: payloadSchemaOwnersFor(entry.toolName),
			mutationClass: entry.mutationClass,
			allowedModes: entry.allowedModes,
			emittedEvents,
			invariantIds,
			policyOwners: governance.policyOwners,
			hostDescription: entry.hostDescription,
			...("definitionGuidance" in entry && entry.definitionGuidance
				? { promptGuidance: entry.definitionGuidance }
				: {}),
			...(entry.docsRowMetadata
				? { docsRowMetadata: entry.docsRowMetadata }
				: {}),
			verificationAnchors: governance.verificationAnchors,
		};
	});

export type FlowHostToolSurfaceDescriptor = FlowSurfaceDescriptor & {
	hostToolName: string;
};

export const FLOW_HOST_TOOL_SURFACE_DESCRIPTORS =
	FLOW_SURFACE_DESCRIPTORS.filter(
		(descriptor): descriptor is FlowHostToolSurfaceDescriptor =>
			descriptor.hostToolName !== null,
	);

export function getFlowSurfaceDescriptor(
	id: string,
): FlowSurfaceDescriptor | null {
	return (
		FLOW_SURFACE_DESCRIPTORS.find((descriptor) => descriptor.id === id) ?? null
	);
}
