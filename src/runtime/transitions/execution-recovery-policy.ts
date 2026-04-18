import type { TransitionRecovery } from "./shared";

export type CompletionRecoveryKind =
	| "missing_validation"
	| "failing_validation"
	| "missing_reviewer_decision"
	| "missing_validation_scope"
	| "failing_feature_review"
	| "missing_final_review"
	| "failing_final_review";

export type StatusRecoveryTemplate = Omit<
	TransitionRecovery,
	"nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs"
> & {
	nextCommand?: TransitionRecovery["nextCommand"];
	nextRuntimeTool?: TransitionRecovery["nextRuntimeTool"];
	nextRuntimeArgs?: TransitionRecovery["nextRuntimeArgs"];
};

type ResetFeatureRecoveryKind =
	| "failing_feature_review"
	| "failing_final_review"
	| "failing_validation";
type DynamicRecoveryKind =
	| "missing_reviewer_decision"
	| "missing_validation_scope";

const REVIEW_DECISION_RECOVERY: Record<
	"feature" | "final",
	StatusRecoveryTemplate
> = {
	feature: {
		errorCode: "missing_feature_reviewer_decision",
		resolutionHint:
			"Record a feature reviewer approval, then rerun the current Flow feature to persist completion.",
		recoveryStage: "record_review",
		prerequisite: "reviewer_result_required",
		requiredArtifact: "feature_reviewer_decision",
		nextCommand: "/flow-status",
		retryable: true,
		autoResolvable: true,
	},
	final: {
		errorCode: "missing_final_reviewer_decision",
		resolutionHint:
			"The active feature is on the session's final completion path. Record a final reviewer approval, then rerun the current Flow feature to persist final completion.",
		recoveryStage: "record_review",
		prerequisite: "reviewer_result_required",
		requiredArtifact: "final_reviewer_decision",
		nextCommand: "/flow-status",
		retryable: true,
		autoResolvable: true,
	},
};

const VALIDATION_SCOPE_RECOVERY: Record<
	"targeted" | "broad",
	StatusRecoveryTemplate
> = {
	targeted: {
		errorCode: "missing_targeted_validation",
		resolutionHint:
			"Run targeted validation for the active feature and retry with validationScope set to 'targeted'.",
		recoveryStage: "rerun_validation",
		prerequisite: "validation_rerun_required",
		requiredArtifact: "targeted_validation_result",
		nextCommand: "/flow-status",
		retryable: true,
		autoResolvable: true,
	},
	broad: {
		errorCode: "missing_broad_validation",
		resolutionHint:
			"The active feature is on the session's final completion path. Run broad repo validation and retry with validationScope set to 'broad'.",
		recoveryStage: "rerun_validation",
		prerequisite: "validation_rerun_required",
		requiredArtifact: "broad_validation_result",
		nextCommand: "/flow-status",
		retryable: true,
		autoResolvable: true,
	},
};

const STATIC_COMPLETION_RECOVERY: Record<
	Exclude<
		CompletionRecoveryKind,
		| "missing_reviewer_decision"
		| "missing_validation_scope"
		| ResetFeatureRecoveryKind
	>,
	StatusRecoveryTemplate
> = {
	missing_final_review: {
		errorCode: "missing_final_review_payload",
		resolutionHint:
			"The active feature is on the session's final completion path. Run the final cross-feature review, include a passing finalReview in the worker result, and rerun the current Flow feature.",
		recoveryStage: "retry_completion",
		prerequisite: "completion_payload_rebuild_required",
		requiredArtifact: "final_review_payload",
		nextCommand: "/flow-status",
		retryable: true,
		autoResolvable: true,
	},
	missing_validation: {
		errorCode: "missing_validation_evidence",
		resolutionHint:
			"Run the required validation for the current Flow feature and retry completion with recorded validation evidence.",
		recoveryStage: "rerun_validation",
		prerequisite: "validation_rerun_required",
		nextCommand: "/flow-status",
		retryable: true,
		autoResolvable: true,
	},
};

const RESET_FEATURE_COMPLETION_RECOVERY: Record<
	ResetFeatureRecoveryKind,
	Omit<
		StatusRecoveryTemplate,
		"nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs"
	>
> = {
	failing_final_review: {
		errorCode: "failing_final_review",
		resolutionHint:
			"Fix the final review findings, rerun broad validation, and rerun the current Flow feature with a passing finalReview.",
		recoveryStage: "reset_feature",
		prerequisite: "feature_reset_required",
		retryable: true,
		autoResolvable: true,
	},
	failing_feature_review: {
		errorCode: "failing_feature_review",
		resolutionHint:
			"Fix the feature review findings, rerun targeted validation, and rerun the current Flow feature.",
		recoveryStage: "reset_feature",
		prerequisite: "feature_reset_required",
		retryable: true,
		autoResolvable: true,
	},
	failing_validation: {
		errorCode: "failing_validation",
		resolutionHint:
			"Fix the failing validation, rerun the relevant checks, and rerun the current Flow feature.",
		recoveryStage: "reset_feature",
		prerequisite: "feature_reset_required",
		retryable: true,
		autoResolvable: true,
	},
};

const DYNAMIC_STATUS_RECOVERY: Record<
	DynamicRecoveryKind,
	(wasFinalFeature: boolean) => StatusRecoveryTemplate
> = {
	missing_reviewer_decision: (wasFinalFeature) =>
		REVIEW_DECISION_RECOVERY[wasFinalFeature ? "final" : "feature"],
	missing_validation_scope: (wasFinalFeature) =>
		VALIDATION_SCOPE_RECOVERY[wasFinalFeature ? "broad" : "targeted"],
};

function isDynamicRecoveryKind(
	kind: CompletionRecoveryKind,
): kind is DynamicRecoveryKind {
	return kind in DYNAMIC_STATUS_RECOVERY;
}

function isResetFeatureRecoveryKind(
	kind: CompletionRecoveryKind,
): kind is ResetFeatureRecoveryKind {
	return kind in RESET_FEATURE_COMPLETION_RECOVERY;
}

export function resolveStatusRecovery(
	kind: CompletionRecoveryKind,
	wasFinalFeature: boolean,
): StatusRecoveryTemplate | null {
	if (isDynamicRecoveryKind(kind)) {
		return DYNAMIC_STATUS_RECOVERY[kind](wasFinalFeature);
	}

	if (isResetFeatureRecoveryKind(kind)) {
		return null;
	}

	return STATIC_COMPLETION_RECOVERY[kind];
}

export function resolveResetFeatureRecovery(
	kind: CompletionRecoveryKind,
): Omit<
	StatusRecoveryTemplate,
	"nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs"
> | null {
	if (!isResetFeatureRecoveryKind(kind)) {
		return null;
	}

	return RESET_FEATURE_COMPLETION_RECOVERY[kind];
}
