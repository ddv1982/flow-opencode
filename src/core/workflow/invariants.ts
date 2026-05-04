import type { SemanticInvariantId } from "../../workflow/domain";
import {
	SEMANTIC_INVARIANT_IDS,
	SEMANTIC_INVARIANTS,
	semanticInvariantById,
} from "../../workflow/domain";

export type CoreInvariantMapping = {
	id: SemanticInvariantId;
	coreOwners: readonly string[];
	supportingOwners: readonly string[];
	coreMappingSummary: string;
};

export const CORE_INVARIANT_MAPPINGS = [
	{
		id: "completion.gates.required_order",
		coreOwners: [
			"src/core/workflow/commands.ts::decideWorkflowCommand",
			"src/core/workflow/reducer.ts::applyWorkflowEvent",
		],
		supportingOwners: ["src/runtime/transitions/execution-completion.ts"],
		coreMappingSummary:
			"Completion commands validate against the existing gate policy before emitting run_completed; the reducer only applies accepted completion events.",
	},
	{
		id: "completion.policy.min_completed_features",
		coreOwners: [
			"src/core/workflow/policies.ts::targetCompletedFeatureCount",
			"src/core/workflow/reducer.ts::reduceRunCompleted",
		],
		supportingOwners: [
			"src/runtime/domain/completion.ts",
			"src/runtime/domain/workflow-policy.ts",
		],
		coreMappingSummary:
			"The core reducer uses the workflow policy target when deciding whether a completed feature closes the workflow.",
	},
	{
		id: "decision_gate.planning_surface.binding",
		coreOwners: [
			"src/core/workflow/policies.ts::activeDecisionGate",
			"src/core/registry/actions.ts::CORE_ACTION_REGISTRY",
		],
		supportingOwners: [
			"src/runtime/domain/workflow-policy.ts",
			"src/runtime/summary.ts",
		],
		coreMappingSummary:
			"Decision-gate semantics remain policy data exposed through the core policy facade and action metadata.",
	},
	{
		id: "review.scope.payload_binding",
		coreOwners: [
			"src/core/workflow/commands.ts::decideWorkflowCommand",
			"src/core/workflow/reducer.ts::reduceReviewerDecisionRecorded",
		],
		supportingOwners: ["src/runtime/schema.ts"],
		coreMappingSummary:
			"Review commands validate feature/final scope boundaries before accepted reviewer_decision_recorded events update workflow state.",
	},
	{
		id: "recovery.next_action.binding",
		coreOwners: ["src/core/workflow/rejections.ts::WorkflowRejection"],
		supportingOwners: ["src/runtime/transitions/recovery.ts"],
		coreMappingSummary:
			"Rejected commands preserve structured recovery metadata so command callers can surface canonical next actions without host coupling.",
	},
	{
		id: "tools.canonical_surface.no_raw_wrappers",
		coreOwners: ["src/core/registry/actions.ts::CORE_ACTION_REGISTRY"],
		supportingOwners: [
			"src/runtime/constants.ts::CANONICAL_RUNTIME_TOOL_NAMES",
		],
		coreMappingSummary:
			"Core action names are host-neutral; OpenCode tool object-shape policy remains an adapter projection concern.",
	},
] as const satisfies readonly CoreInvariantMapping[];

export { SEMANTIC_INVARIANT_IDS, SEMANTIC_INVARIANTS, semanticInvariantById };
