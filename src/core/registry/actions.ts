import type { SemanticInvariantId } from "../../runtime/domain";
import type { WorkflowCommandType } from "../workflow/commands";
import type { WorkflowEventType } from "../workflow/events";

export type CoreActionDescriptor = {
	name: WorkflowCommandType;
	emits: readonly WorkflowEventType[];
	invariantIds: readonly SemanticInvariantId[];
	policyOwners: readonly string[];
	description: string;
};

export const CORE_ACTION_REGISTRY = [
	{
		name: "start_workflow",
		emits: ["workflow_started"],
		invariantIds: ["decision_gate.planning_surface.binding"],
		policyOwners: ["src/core/workflow/state.ts"],
		description: "Create the deterministic workflow state root.",
	},
	{
		name: "record_planning_context",
		emits: ["planning_context_recorded"],
		invariantIds: ["decision_gate.planning_surface.binding"],
		policyOwners: ["src/core/workflow/reducer.ts"],
		description: "Attach planning facts and decision-gate context.",
	},
	{
		name: "apply_plan",
		emits: ["plan_applied"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/core/workflow/commands.ts",
			"src/core/workflow/policies.ts",
		],
		description: "Validate and record a draft plan.",
	},
	{
		name: "approve_plan",
		emits: ["plan_approved"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/core/workflow/commands.ts",
			"src/core/workflow/reducer.ts",
		],
		description:
			"Approve a draft plan, optionally narrowed to selected features.",
	},
	{
		name: "select_plan_features",
		emits: ["plan_features_selected"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: ["src/core/workflow/commands.ts"],
		description:
			"Narrow a draft plan before approval while preserving graph validity.",
	},
	{
		name: "start_run",
		emits: ["run_started", "workflow_completed"],
		invariantIds: ["completion.policy.min_completed_features"],
		policyOwners: [
			"src/core/workflow/commands.ts",
			"src/core/workflow/reducer.ts",
		],
		description: "Select the next runnable feature and mark it in progress.",
	},
	{
		name: "record_reviewer_decision",
		emits: ["reviewer_decision_recorded"],
		invariantIds: ["review.scope.payload_binding"],
		policyOwners: [
			"src/core/workflow/commands.ts",
			"src/core/workflow/reducer.ts",
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
			"src/core/workflow/commands.ts",
			"src/core/workflow/reducer.ts",
			"src/core/workflow/rejections.ts",
		],
		description: "Validate worker evidence and reduce an accepted run outcome.",
	},
	{
		name: "reset_feature",
		emits: ["feature_reset"],
		invariantIds: ["recovery.next_action.binding"],
		policyOwners: ["src/core/workflow/reducer.ts"],
		description:
			"Reset a feature and dependent feature statuses after recovery.",
	},
] as const satisfies readonly CoreActionDescriptor[];

export type CoreActionName = (typeof CORE_ACTION_REGISTRY)[number]["name"];

export function coreActionByName(
	name: WorkflowCommandType,
): CoreActionDescriptor | null {
	return CORE_ACTION_REGISTRY.find((action) => action.name === name) ?? null;
}
