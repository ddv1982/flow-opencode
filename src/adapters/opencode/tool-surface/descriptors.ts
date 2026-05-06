import type { CoreActionName } from "../../../core/registry";
import type {
	SessionMutationActionName,
	SessionReadActionName,
	SessionWorkspaceActionName,
} from "../../../runtime/application";
import type { SemanticInvariantId } from "../../../runtime/domain";
import {
	FLOW_DEFAULT_TOOL_DOCS_ROW,
	FLOW_PROMPT_GUIDANCE_BY_ID,
} from "./descriptor-guidance";

export type FlowSurfaceKind =
	| "mutation"
	| "read"
	| "workspace"
	| "render"
	| "audit"
	| "prompt-only"
	| "docs-only";

export type FlowSurfaceMutationClass =
	| "none"
	| "planning"
	| "execution"
	| "review"
	| "control";

export type FlowSurfaceMode =
	| "flow-plan"
	| "flow-auto"
	| "flow-run"
	| "flow-planning-researcher"
	| "flow-worker"
	| "flow-reviewer"
	| "flow-control"
	| "flow-review";

export type RuntimeActionBinding =
	| { kind: "none" }
	| { kind: "read"; name: SessionReadActionName }
	| { kind: "workspace"; name: SessionWorkspaceActionName }
	| { kind: "mutation"; name: SessionMutationActionName };

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

export const FLOW_SURFACE_DESCRIPTORS: readonly FlowSurfaceDescriptor[] = [
	{
		id: "flow_status",
		hostToolName: "flow_status",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "load_status_session" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "none",
		allowedModes: ["flow-control"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		hostDescription: "Show the active Flow session summary",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/docs-tool-parity.test.ts",
		],
	},
	{
		id: "flow_doctor",
		hostToolName: "flow_doctor",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "none" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "none",
		allowedModes: ["flow-control"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: ["src/runtime/application/doctor-checks.ts"],
		hostDescription:
			"Run non-destructive readiness checks for Flow in the current workspace",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_history",
		hostToolName: "flow_history",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "list_session_history" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "none",
		allowedModes: ["flow-control"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		hostDescription: "Show active, stored, and completed Flow session history",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_history_show",
		hostToolName: "flow_history_show",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "load_history_session" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "none",
		allowedModes: ["flow-control"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		hostDescription:
			"Show a specific active, stored, or completed Flow session by id",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_session_activate",
		hostToolName: "flow_session_activate",
		surfaceKind: "workspace",
		runtimeActionBinding: { kind: "workspace", name: "activate_session" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/history-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "control",
		allowedModes: ["flow-control"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: ["src/runtime/application/session-workspace-actions.ts"],
		hostDescription: "Activate a stored Flow session by id",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_plan_start",
		hostToolName: "flow_plan_start",
		surfaceKind: "workspace",
		runtimeActionBinding: { kind: "workspace", name: "plan_start" },
		coreAction: "start_workflow",
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/planning-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		emittedEvents: ["workflow_started"],
		invariantIds: ["decision_gate.planning_surface.binding"],
		policyOwners: [
			"src/runtime/application/session-workspace-actions.ts",
			"src/core/workflow/reducer.ts",
		],
		hostDescription: "Create or refresh the active Flow planning session",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_plan_start,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/protocol-parity.test.ts",
		],
	},
	{
		id: "flow_auto_prepare",
		hostToolName: "flow_auto_prepare",
		surfaceKind: "read",
		runtimeActionBinding: { kind: "read", name: "load_resumable_session" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/planning-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "none",
		allowedModes: ["flow-auto"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: ["src/runtime/application/session-read-actions.ts"],
		hostDescription: "Classify a flow-auto invocation",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_session_close",
		hostToolName: "flow_session_close",
		surfaceKind: "workspace",
		runtimeActionBinding: { kind: "workspace", name: "close_session" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/session-tools/lifecycle-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "control",
		allowedModes: ["flow-control"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: ["src/runtime/application/session-workspace-actions.ts"],
		hostDescription:
			"Close the active Flow session as completed, deferred, or abandoned",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_plan_context_record",
		hostToolName: "flow_plan_context_record",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "record_planning_context" },
		coreAction: "record_planning_context",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		emittedEvents: ["planning_context_recorded"],
		invariantIds: ["decision_gate.planning_surface.binding"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/core/workflow/reducer.ts",
		],
		hostDescription:
			"Persist repo profile, research, implementation approach, and optional planning decisions into the active Flow session from a JSON payload",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_plan_context_record,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/config/prompt-contracts.test.ts",
		],
	},
	{
		id: "flow_plan_apply",
		hostToolName: "flow_plan_apply",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "apply_plan" },
		coreAction: "apply_plan",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		emittedEvents: ["plan_applied"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/core/workflow/commands.ts",
			"src/core/workflow/policies.ts",
		],
		hostDescription:
			"Persist a Flow draft plan into the active session from a JSON payload",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_plan_apply,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/protocol-parity.test.ts",
		],
	},
	{
		id: "flow_plan_approve",
		hostToolName: "flow_plan_approve",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "approve_plan" },
		coreAction: "approve_plan",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "planning",
		allowedModes: ["flow-plan", "flow-auto"],
		emittedEvents: ["plan_approved"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/core/workflow/reducer.ts",
		],
		hostDescription: "Approve the active Flow draft plan",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_plan_select_features",
		hostToolName: "flow_plan_select_features",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "select_plan_features" },
		coreAction: "select_plan_features",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/planning-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "planning",
		allowedModes: ["flow-plan"],
		emittedEvents: ["plan_features_selected"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/core/workflow/commands.ts",
		],
		hostDescription:
			"Keep only selected features in the active Flow draft plan",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: ["tests/config/tool-schemas.test.ts"],
	},
	{
		id: "flow_run_start",
		hostToolName: "flow_run_start",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "start_run" },
		coreAction: "start_run",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "execution",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		emittedEvents: ["run_started", "workflow_completed"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/core/workflow/reducer.ts",
		],
		hostDescription: "Start the next runnable Flow feature",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_run_start,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/protocol-parity.test.ts",
		],
	},
	{
		id: "flow_run_complete_feature",
		hostToolName: "flow_run_complete_feature",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "complete_run" },
		coreAction: "complete_run",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts",
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
		mutationClass: "execution",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		emittedEvents: ["run_completed"],
		invariantIds: [
			"completion.gates.required_order",
			"completion.policy.min_completed_features",
			"recovery.next_action.binding",
		],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/domain/review-scope-accounting.ts",
			"src/runtime/transitions/execution-completion-validation.ts",
			"src/core/workflow/rejections.ts",
		],
		hostDescription:
			"Persist an already-validated Flow feature execution result from a JSON payload",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_run_complete_feature,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/runtime/final-completion-gates.test.ts",
			"tests/runtime/worker-result-contracts.test.ts",
		],
	},
	{
		id: "flow_reset_feature",
		hostToolName: "flow_reset_feature",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "reset_feature" },
		coreAction: "reset_feature",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/execution-tools.ts",
		payloadSchemaOwners: ["src/adapters/opencode/tool-surface/schemas.ts"],
		mutationClass: "execution",
		allowedModes: ["flow-auto", "flow-control"],
		emittedEvents: ["feature_reset"],
		invariantIds: ["recovery.next_action.binding"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/core/workflow/reducer.ts",
		],
		hostDescription: "Reset a Flow feature to pending",
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/recovery-hint-parity.test.ts",
		],
	},
	{
		id: "flow_review_record_feature",
		hostToolName: "flow_review_record_feature",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "record_feature_review" },
		coreAction: "record_reviewer_decision",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts",
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
		mutationClass: "review",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		emittedEvents: ["reviewer_decision_recorded"],
		invariantIds: ["review.scope.payload_binding"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/core/workflow/reducer.ts",
		],
		hostDescription:
			"Record an already-validated reviewer decision for the active feature from a JSON payload",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_review_record_feature,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/runtime/final-review-contracts.test.ts",
		],
	},
	{
		id: "flow_review_record_final",
		hostToolName: "flow_review_record_final",
		surfaceKind: "mutation",
		runtimeActionBinding: { kind: "mutation", name: "record_final_review" },
		coreAction: "record_reviewer_decision",
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts",
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		],
		mutationClass: "review",
		allowedModes: ["flow-auto", "flow-run", "flow-worker"],
		emittedEvents: ["reviewer_decision_recorded"],
		invariantIds: ["review.scope.payload_binding"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/domain/review-scope-accounting.ts",
			"src/runtime/transitions/execution-completion-validation.ts",
			"src/core/workflow/reducer.ts",
		],
		hostDescription:
			"Record an already-validated reviewer decision for final cross-feature validation from a JSON payload",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_review_record_final,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/runtime/final-review-contracts.test.ts",
		],
	},
	{
		id: "flow_review_render",
		hostToolName: "flow_review_render",
		surfaceKind: "render",
		runtimeActionBinding: { kind: "none" },
		coreAction: null,
		registrationOwner:
			"src/adapters/opencode/tool-surface/runtime-tools/review-tools.ts",
		payloadSchemaOwners: [
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/audit/report-schema.ts",
		],
		mutationClass: "none",
		allowedModes: ["flow-control", "flow-review"],
		emittedEvents: [],
		invariantIds: [],
		policyOwners: [
			"src/audit/report-presenter.ts",
			"src/audit/report-schema.ts",
		],
		hostDescription:
			"Render a structured Flow review ledger into a human-readable report, structured JSON, or both",
		promptGuidance: FLOW_PROMPT_GUIDANCE_BY_ID.flow_review_render,
		docsRowMetadata: FLOW_DEFAULT_TOOL_DOCS_ROW,
		verificationAnchors: [
			"tests/config/tool-schemas.test.ts",
			"tests/config/prompt-contracts.test.ts",
		],
	},
] as const;

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
