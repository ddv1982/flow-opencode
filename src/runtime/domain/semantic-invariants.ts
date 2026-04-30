import { CANONICAL_RUNTIME_TOOL_NAMES } from "../constants";
import type { CompletionRecoveryKind } from "../transitions/recovery";

export type SemanticInvariantId =
	| "completion.gates.required_order"
	| "completion.policy.min_completed_features"
	| "decision_gate.planning_surface.binding"
	| "review.scope.payload_binding"
	| "recovery.next_action.binding"
	| "tools.canonical_surface.no_raw_wrappers";

export type SemanticInvariantOwnerReference = {
	file: string;
	symbols: readonly string[];
};

export type SemanticInvariantDescriptor = {
	id: SemanticInvariantId;
	ownerSummary: string;
	ownerReferences: readonly SemanticInvariantOwnerReference[];
	semanticClaim: string;
	assertionType: string;
	stabilityRule: string;
};

const SEMANTIC_INVARIANT_REGISTRY = {
	"completion.gates.required_order": {
		id: "completion.gates.required_order",
		ownerSummary:
			"src/runtime/transitions/execution-completion.ts::validateSuccessfulCompletion",
		ownerReferences: [
			{
				file: "src/runtime/transitions/execution-completion.ts",
				symbols: ["validateSuccessfulCompletion"],
			},
		],
		semanticClaim:
			"Completion path enforces validation, reviewer, review, and final-path gates in runtime-defined order.",
		assertionType: "transition outcome assertions",
		stabilityRule:
			"Stable across refactors; behavior changes require ADR updates and semantic-suite updates.",
	},
	"completion.policy.min_completed_features": {
		id: "completion.policy.min_completed_features",
		ownerSummary:
			"src/runtime/domain/completion.ts::summarizeCompletion + src/runtime/domain/workflow-policy.ts::targetCompletedFeatureCount",
		ownerReferences: [
			{
				file: "src/runtime/domain/completion.ts",
				symbols: ["summarizeCompletion"],
			},
			{
				file: "src/runtime/domain/workflow-policy.ts",
				symbols: ["targetCompletedFeatureCount"],
			},
		],
		semanticClaim:
			"Final completion respects completionPolicy.minCompletedFeatures and can finish with pending features when the target is lower than the total plan size.",
		assertionType: "summary and completion outcome assertions",
		stabilityRule:
			"Stable invariant ID; semantic threshold changes require migration notes.",
	},
	"decision_gate.planning_surface.binding": {
		id: "decision_gate.planning_surface.binding",
		ownerSummary:
			"src/runtime/domain/workflow-policy.ts::activeDecisionGate + src/runtime/summary.ts::explainSessionState",
		ownerReferences: [
			{
				file: "src/runtime/domain/workflow-policy.ts",
				symbols: ["activeDecisionGate"],
			},
			{
				file: "src/runtime/summary.ts",
				symbols: ["explainSessionState", "summarizeSession"],
			},
		],
		semanticClaim:
			"Planning decisions that require pause are surfaced into session summaries and guidance as decisionGate payloads.",
		assertionType: "summary and guidance assertions",
		stabilityRule:
			"Stable invariant ID; pause/surface contract changes are breaking behavior.",
	},
	"review.scope.payload_binding": {
		id: "review.scope.payload_binding",
		ownerSummary:
			"src/runtime/schema.ts::FlowReviewRecordFeatureArgsSchema/FlowReviewRecordFinalArgsSchema",
		ownerReferences: [
			{
				file: "src/runtime/schema.ts",
				symbols: [
					"FlowReviewRecordFeatureArgsSchema",
					"FlowReviewRecordFinalArgsSchema",
				],
			},
		],
		semanticClaim:
			"Feature and final review payload scopes stay distinct and invalid cross-scope payloads are rejected.",
		assertionType: "schema parse and runtime rejection assertions",
		stabilityRule:
			"Stable unless the review payload contract is intentionally changed.",
	},
	"recovery.next_action.binding": {
		id: "recovery.next_action.binding",
		ownerSummary:
			"src/runtime/transitions/recovery.ts::buildCompletionRecovery",
		ownerReferences: [
			{
				file: "src/runtime/transitions/recovery.ts",
				symbols: ["buildCompletionRecovery"],
			},
		],
		semanticClaim:
			"Recovery emits canonical recovery-stage, prerequisite, nextCommand, and nextRuntimeTool bindings.",
		assertionType: "structured recovery metadata assertions",
		stabilityRule:
			"Stable ID; human-readable prose may vary if structured metadata stays compatible.",
	},
	"tools.canonical_surface.no_raw_wrappers": {
		id: "tools.canonical_surface.no_raw_wrappers",
		ownerSummary:
			"src/tools.ts::createTools + src/runtime/constants.ts::CANONICAL_RUNTIME_TOOL_NAMES",
		ownerReferences: [
			{
				file: "src/tools.ts",
				symbols: ["createTools"],
			},
			{
				file: "src/runtime/constants.ts",
				symbols: ["CANONICAL_RUNTIME_TOOL_NAMES"],
			},
		],
		semanticClaim:
			"The public tool surface remains canonical-only and excludes deprecated raw-wrapper aliases.",
		assertionType: "tool registration assertions",
		stabilityRule:
			"Stable; tool additions require matrix updates and parity verification.",
	},
} as const satisfies Record<SemanticInvariantId, SemanticInvariantDescriptor>;

export const SEMANTIC_INVARIANTS = Object.values(
	SEMANTIC_INVARIANT_REGISTRY,
) as readonly SemanticInvariantDescriptor[];

export const SEMANTIC_INVARIANT_IDS = Object.keys(
	SEMANTIC_INVARIANT_REGISTRY,
) as SemanticInvariantId[];

export const SEMANTIC_COMPLETION_GATE_ORDER = {
	feature: [
		"missing_validation",
		"failing_validation",
		"missing_reviewer_decision",
		"missing_validation_scope",
		"failing_feature_review",
		"failing_final_review",
	],
	final: [
		"missing_validation",
		"failing_validation",
		"missing_validation_scope",
		"failing_feature_review",
		"failing_final_review",
		"missing_final_review",
		"missing_reviewer_decision",
	],
} as const satisfies {
	feature: readonly CompletionRecoveryKind[];
	final: readonly CompletionRecoveryKind[];
};

export const SEMANTIC_COMPLETION_POLICY_EXPECTATIONS = {
	pendingAllowedWhenTargetLessThanTotal: true,
	activeFeatureCanTriggerCompletion: true,
	thresholdStopRule: "ship_when_threshold_met",
} as const;

export const SEMANTIC_DECISION_GATE_EXPECTATIONS = {
	surfaceKeys: [
		"status",
		"domain",
		"question",
		"recommendation",
		"rationale",
	] as const,
	pauseModes: ["recommend_confirm", "human_required"] as const,
	nonPauseModes: ["autonomous_choice"] as const,
	guidanceCategory: "decision_gate",
} as const;

export const SEMANTIC_REVIEW_SCOPE_EXPECTATIONS = {
	featureScope: "feature",
	finalScope: "final",
	featureRequiresFeatureId: true,
	finalRejectsFeatureId: true,
} as const;

export const SEMANTIC_RECOVERY_EXPECTATIONS = {
	resetFeatureKinds: [
		"failing_validation",
		"failing_feature_review",
		"failing_final_review",
	] as const satisfies readonly CompletionRecoveryKind[],
	statusOnlyKinds: [
		"missing_validation",
		"missing_reviewer_decision",
		"missing_validation_scope",
		"missing_final_review",
	] as const satisfies readonly CompletionRecoveryKind[],
	statusCommand: "/flow-status",
	resetCommandPrefix: "/flow-reset feature ",
	resetRuntimeTool: "flow_reset_feature",
} as const;

export const SEMANTIC_TOOL_SURFACE_EXPECTATIONS = {
	canonicalRuntimeToolNames: CANONICAL_RUNTIME_TOOL_NAMES,
	forbiddenSubstring: "_from_raw",
} as const;

export function semanticInvariantById(id: SemanticInvariantId) {
	return SEMANTIC_INVARIANT_REGISTRY[id] ?? null;
}
