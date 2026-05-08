import type { CompletionRecoveryKind } from "./recovery";

export type CompletionGateId =
	| "validation_evidence"
	| "validation_passed"
	| "review_finding_closure"
	| "review_scope_accounting"
	| "reviewer_decision"
	| "validation_scope"
	| "feature_review"
	| "final_review_payload"
	| "final_review_passed";

export type CompletionGatePath = "feature" | "final";

export type CompletionGateApplicability =
	| CompletionGatePath
	| "review"
	| "review_and_fix";

export type CompletionGateRequiredArtifact =
	| null
	| string
	| {
			feature?: string;
			final?: string;
	  };

export type CompletionGateDescriptor = {
	id: CompletionGateId;
	recoveryKind: CompletionRecoveryKind;
	appliesTo: readonly CompletionGateApplicability[];
	predicateOwner:
		| "validateNormalizedSuccessfulCompletion"
		| "reviewFindingClosureFailureMessage"
		| "reviewScopeLedgerFailureMessage"
		| "finalReviewerDecisionFailureMessage"
		| "finalReviewFailureMessage";
	requiredArtifact: CompletionGateRequiredArtifact;
	invariantIds: readonly (
		| "completion.gates.required_order"
		| "recovery.next_action.binding"
		| "review.scope.payload_binding"
	)[];
	operatorHint: string;
	renderableText: string;
};

export const COMPLETION_GATE_DESCRIPTORS = {
	validation_evidence: {
		id: "validation_evidence",
		recoveryKind: "missing_validation",
		appliesTo: ["feature", "final"],
		predicateOwner: "validateNormalizedSuccessfulCompletion",
		requiredArtifact: null,
		invariantIds: [
			"completion.gates.required_order",
			"recovery.next_action.binding",
		],
		operatorHint:
			"Completion requires recorded validationRun evidence before any review or scope gates are evaluated.",
		renderableText:
			"Record validation evidence before completing the active Flow feature.",
	},
	validation_passed: {
		id: "validation_passed",
		recoveryKind: "failing_validation",
		appliesTo: ["feature", "final"],
		predicateOwner: "validateNormalizedSuccessfulCompletion",
		requiredArtifact: null,
		invariantIds: [
			"completion.gates.required_order",
			"recovery.next_action.binding",
		],
		operatorHint:
			"Validation failures reset the active feature before reviewer, scope, or review payload gates can pass.",
		renderableText:
			"Fix failing validation and rerun the current Flow feature.",
	},
	review_finding_closure: {
		id: "review_finding_closure",
		recoveryKind: "missing_review_closure",
		appliesTo: ["review_and_fix"],
		predicateOwner: "reviewFindingClosureFailureMessage",
		requiredArtifact: "review_finding_closure_ledger",
		invariantIds: [
			"completion.gates.required_order",
			"recovery.next_action.binding",
		],
		operatorHint:
			"Review-and-fix completion must include closure evidence for every remediated review finding.",
		renderableText:
			"Attach reviewFindingClosures with fix, test, and validation references before completion.",
	},
	review_scope_accounting: {
		id: "review_scope_accounting",
		recoveryKind: "missing_review_scope_accounting",
		appliesTo: ["review", "review_and_fix"],
		predicateOwner: "reviewScopeLedgerFailureMessage",
		requiredArtifact: "review_scope_ledger",
		invariantIds: [
			"completion.gates.required_order",
			"review.scope.payload_binding",
			"recovery.next_action.binding",
		],
		operatorHint:
			"Review and review-and-fix completion must account each declared review scope with evidence-grounded entries; recovery examples are scaffold-only.",
		renderableText:
			"Attach evidence-grounded reviewScopeLedger entries for each declared review target/domain before completing.",
	},
	reviewer_decision: {
		id: "reviewer_decision",
		recoveryKind: "missing_reviewer_decision",
		appliesTo: ["feature", "final"],
		predicateOwner: "finalReviewerDecisionFailureMessage",
		requiredArtifact: {
			feature: "feature_reviewer_decision",
			final: "final_reviewer_decision",
		},
		invariantIds: [
			"completion.gates.required_order",
			"review.scope.payload_binding",
			"recovery.next_action.binding",
		],
		operatorHint:
			"Completion requires an approved reviewer decision with feature or final scope matching the completion path.",
		renderableText:
			"Record the required reviewer approval before retrying completion.",
	},
	validation_scope: {
		id: "validation_scope",
		recoveryKind: "missing_validation_scope",
		appliesTo: ["feature", "final"],
		predicateOwner: "validateNormalizedSuccessfulCompletion",
		requiredArtifact: {
			feature: "targeted_validation_result",
			final: "broad_validation_result",
		},
		invariantIds: [
			"completion.gates.required_order",
			"recovery.next_action.binding",
		],
		operatorHint:
			"Feature completion requires targeted validation; final completion requires broad validation.",
		renderableText:
			"Retry completion with validationScope matching the active completion path.",
	},
	feature_review: {
		id: "feature_review",
		recoveryKind: "failing_feature_review",
		appliesTo: ["feature", "final"],
		predicateOwner: "validateNormalizedSuccessfulCompletion",
		requiredArtifact: null,
		invariantIds: [
			"completion.gates.required_order",
			"recovery.next_action.binding",
		],
		operatorHint:
			"The featureReview payload must be passing before feature or final completion can persist.",
		renderableText:
			"Fix blocking feature review findings before retrying completion.",
	},
	final_review_payload: {
		id: "final_review_payload",
		recoveryKind: "missing_final_review",
		appliesTo: ["final"],
		predicateOwner: "validateNormalizedSuccessfulCompletion",
		requiredArtifact: "final_review_payload",
		invariantIds: [
			"completion.gates.required_order",
			"recovery.next_action.binding",
		],
		operatorHint:
			"Final completion requires a finalReview payload before the final reviewer decision is accepted.",
		renderableText:
			"Attach a finalReview payload that satisfies deliveryPolicy.finalReviewPolicy.",
	},
	final_review_passed: {
		id: "final_review_passed",
		recoveryKind: "failing_final_review",
		appliesTo: ["feature", "final"],
		predicateOwner: "finalReviewFailureMessage",
		requiredArtifact: null,
		invariantIds: [
			"completion.gates.required_order",
			"recovery.next_action.binding",
		],
		operatorHint:
			"If a finalReview payload is present, it must pass and match deliveryPolicy.finalReviewPolicy before completion continues.",
		renderableText:
			"Fix final review findings and rerun broad validation before retrying completion.",
	},
} as const satisfies Record<CompletionGateId, CompletionGateDescriptor>;

export const COMPLETION_GATE_IDS = Object.keys(
	COMPLETION_GATE_DESCRIPTORS,
) as CompletionGateId[];

export const COMPLETION_GATES = Object.values(
	COMPLETION_GATE_DESCRIPTORS,
) as readonly CompletionGateDescriptor[];

export const COMPLETION_GATE_ORDER = {
	feature: [
		"validation_evidence",
		"validation_passed",
		"reviewer_decision",
		"validation_scope",
		"feature_review",
		"final_review_passed",
	],
	final: [
		"validation_evidence",
		"validation_passed",
		"validation_scope",
		"feature_review",
		"final_review_passed",
		"final_review_payload",
		"reviewer_decision",
	],
} as const satisfies Record<CompletionGatePath, readonly CompletionGateId[]>;

export const REVIEW_COMPLETION_GATE_ORDER = {
	feature: [
		"validation_evidence",
		"validation_passed",
		"review_scope_accounting",
		"reviewer_decision",
		"validation_scope",
		"feature_review",
		"final_review_passed",
	],
	final: [
		"validation_evidence",
		"validation_passed",
		"review_scope_accounting",
		"validation_scope",
		"feature_review",
		"final_review_passed",
		"final_review_payload",
		"reviewer_decision",
	],
} as const satisfies Record<CompletionGatePath, readonly CompletionGateId[]>;

export const REVIEW_AND_FIX_COMPLETION_GATE_ORDER = {
	feature: [
		"validation_evidence",
		"validation_passed",
		"review_finding_closure",
		"review_scope_accounting",
		"reviewer_decision",
		"validation_scope",
		"feature_review",
		"final_review_passed",
	],
	final: [
		"validation_evidence",
		"validation_passed",
		"review_finding_closure",
		"review_scope_accounting",
		"validation_scope",
		"feature_review",
		"final_review_passed",
		"final_review_payload",
		"reviewer_decision",
	],
} as const satisfies Record<CompletionGatePath, readonly CompletionGateId[]>;

export const CONDITIONAL_COMPLETION_GATE_ORDER = {
	review: REVIEW_COMPLETION_GATE_ORDER,
	reviewAndFix: REVIEW_AND_FIX_COMPLETION_GATE_ORDER,
} as const satisfies Record<
	"review" | "reviewAndFix",
	Record<CompletionGatePath, readonly CompletionGateId[]>
>;

export function completionGateOrderFor(
	path: CompletionGatePath,
	options?: { review?: boolean; reviewAndFix?: boolean },
): readonly CompletionGateId[] {
	if (options?.reviewAndFix) {
		return REVIEW_AND_FIX_COMPLETION_GATE_ORDER[path];
	}
	return options?.review
		? REVIEW_COMPLETION_GATE_ORDER[path]
		: COMPLETION_GATE_ORDER[path];
}

export function completionRecoveryKindOrderFor(
	path: CompletionGatePath,
	options?: { review?: boolean; reviewAndFix?: boolean },
): readonly CompletionRecoveryKind[] {
	return completionGateOrderFor(path, options).map(
		(gateId) => COMPLETION_GATE_DESCRIPTORS[gateId].recoveryKind,
	);
}

export function requiredArtifactForCompletionGate(
	gate: CompletionGateDescriptor,
	path: CompletionGatePath,
): string | undefined {
	const artifact = gate.requiredArtifact;
	if (!artifact) {
		return undefined;
	}
	return typeof artifact === "string" ? artifact : artifact[path];
}
