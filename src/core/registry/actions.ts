import type { SemanticInvariantId } from "../protocols/semantic-invariants";

export type CoreActionName =
	| "start_workflow"
	| "record_planning_context"
	| "apply_plan"
	| "approve_plan"
	| "select_plan_features"
	| "start_run"
	| "record_reviewer_decision"
	| "complete_run"
	| "reset_feature";

export type CoreWorkflowEventType =
	| "workflow_started"
	| "planning_context_recorded"
	| "plan_applied"
	| "plan_approved"
	| "plan_features_selected"
	| "run_started"
	| "reviewer_decision_recorded"
	| "run_completed"
	| "feature_reset"
	| "workflow_completed";

export type CoreActionDescriptor = {
	name: CoreActionName;
	emits: readonly CoreWorkflowEventType[];
	invariantIds: readonly SemanticInvariantId[];
	policyOwners: readonly string[];
	description: string;
};

export const CORE_ACTION_REGISTRY = [
	{
		name: "start_workflow",
		emits: ["workflow_started"],
		invariantIds: ["decision_gate.planning_surface.binding"],
		policyOwners: ["src/runtime/application/session-workspace-actions.ts"],
		description: "Create the deterministic workflow state root.",
	},
	{
		name: "record_planning_context",
		emits: ["planning_context_recorded"],
		invariantIds: ["decision_gate.planning_surface.binding"],
		policyOwners: ["src/runtime/application/session-actions.ts"],
		description: "Attach planning facts and decision-gate context.",
	},
	{
		name: "apply_plan",
		emits: ["plan_applied"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/plan.ts",
		],
		description: "Validate and record a draft plan.",
	},
	{
		name: "approve_plan",
		emits: ["plan_approved"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/plan.ts",
		],
		description:
			"Approve a draft plan, optionally narrowed to selected features.",
	},
	{
		name: "select_plan_features",
		emits: ["plan_features_selected"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/plan.ts",
		],
		description:
			"Narrow a draft plan before approval while preserving graph validity.",
	},
	{
		name: "start_run",
		emits: ["run_started", "workflow_completed"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/execution.ts",
		],
		description: "Select the next runnable feature and mark it in progress.",
	},
	{
		name: "record_reviewer_decision",
		emits: ["reviewer_decision_recorded"],
		invariantIds: ["review.scope.payload_binding"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/review.ts",
		],
		description: "Record feature-scope or final-scope reviewer approval data.",
	},
	{
		name: "complete_run",
		emits: ["run_completed"],
		invariantIds: [
			"completion.gates.required_order",
			"completion.policy.min_completed_features",
			"recovery.next_action.binding",
		],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/execution-completion.ts",
			"src/runtime/transitions/execution-completion-validation.ts",
		],
		description: "Validate worker evidence and reduce an accepted run outcome.",
	},
	{
		name: "reset_feature",
		emits: ["feature_reset"],
		invariantIds: ["recovery.next_action.binding"],
		policyOwners: [
			"src/runtime/application/session-actions.ts",
			"src/runtime/transitions/recovery.ts",
		],
		description:
			"Reset a feature and dependent feature statuses after recovery.",
	},
] as const satisfies readonly CoreActionDescriptor[];

export function coreActionByName(
	name: CoreActionName,
): CoreActionDescriptor | null {
	return CORE_ACTION_REGISTRY.find((action) => action.name === name) ?? null;
}
