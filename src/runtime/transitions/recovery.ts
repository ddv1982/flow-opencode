import { FLOW_STATUS_COMMAND, flowResetFeatureCommand } from "../constants";
import type { TransitionRecovery } from "./shared";

export type CompletionRecoveryKind =
	| "missing_validation"
	| "failing_validation"
	| "missing_reviewer_decision"
	| "missing_validation_scope"
	| "failing_feature_review"
	| "missing_final_review"
	| "failing_final_review";

function buildStatusRecovery(
	recovery: Omit<
		TransitionRecovery,
		"nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs"
	> & {
		nextCommand?: TransitionRecovery["nextCommand"];
		nextRuntimeTool?: TransitionRecovery["nextRuntimeTool"];
		nextRuntimeArgs?: TransitionRecovery["nextRuntimeArgs"];
	},
): TransitionRecovery {
	return {
		errorCode: recovery.errorCode,
		resolutionHint: recovery.resolutionHint,
		recoveryStage: recovery.recoveryStage,
		prerequisite: recovery.prerequisite,
		...(recovery.requiredArtifact
			? { requiredArtifact: recovery.requiredArtifact }
			: {}),
		nextCommand: recovery.nextCommand ?? FLOW_STATUS_COMMAND,
		...(recovery.nextRuntimeTool
			? {
					nextRuntimeTool: recovery.nextRuntimeTool,
					...(recovery.nextRuntimeArgs
						? { nextRuntimeArgs: recovery.nextRuntimeArgs }
						: {}),
				}
			: {}),
		...(recovery.retryable !== undefined
			? { retryable: recovery.retryable }
			: {}),
		...(recovery.autoResolvable !== undefined
			? { autoResolvable: recovery.autoResolvable }
			: {}),
	};
}

function buildResetFeatureRecovery(
	featureId: string,
	recovery: Omit<
		TransitionRecovery,
		"requiredArtifact" | "nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs"
	>,
): TransitionRecovery {
	return {
		errorCode: recovery.errorCode,
		resolutionHint: recovery.resolutionHint,
		recoveryStage: recovery.recoveryStage,
		prerequisite: recovery.prerequisite,
		nextCommand: flowResetFeatureCommand(featureId),
		nextRuntimeTool: "flow_reset_feature",
		nextRuntimeArgs: { featureId },
		...(recovery.retryable !== undefined
			? { retryable: recovery.retryable }
			: {}),
		...(recovery.autoResolvable !== undefined
			? { autoResolvable: recovery.autoResolvable }
			: {}),
	};
}

export function buildCompletionRecovery(
	featureId: string,
	wasFinalFeature: boolean,
	kind: CompletionRecoveryKind,
): TransitionRecovery {
	switch (kind) {
		case "missing_validation":
			return buildStatusRecovery({
				errorCode: "missing_validation_evidence",
				resolutionHint:
					"Run the required validation for the current Flow feature and retry completion with recorded validation evidence.",
				recoveryStage: "rerun_validation",
				prerequisite: "validation_rerun_required",
				nextCommand: FLOW_STATUS_COMMAND,
				retryable: true,
				autoResolvable: true,
			});
		case "failing_validation":
			return buildResetFeatureRecovery(featureId, {
				errorCode: "failing_validation",
				resolutionHint:
					"Fix the failing validation, rerun the relevant checks, and rerun the current Flow feature.",
				recoveryStage: "reset_feature",
				prerequisite: "feature_reset_required",
				retryable: true,
				autoResolvable: true,
			});
		case "missing_reviewer_decision":
			return buildStatusRecovery(
				wasFinalFeature
					? {
							errorCode: "missing_final_reviewer_decision",
							resolutionHint:
								"The active feature is on the session's final completion path. Record a final reviewer approval, then rerun the current Flow feature to persist final completion.",
							recoveryStage: "record_review",
							prerequisite: "reviewer_result_required",
							requiredArtifact: "final_reviewer_decision",
							nextCommand: FLOW_STATUS_COMMAND,
							retryable: true,
							autoResolvable: true,
						}
					: {
							errorCode: "missing_feature_reviewer_decision",
							resolutionHint:
								"Record a feature reviewer approval, then rerun the current Flow feature to persist completion.",
							recoveryStage: "record_review",
							prerequisite: "reviewer_result_required",
							requiredArtifact: "feature_reviewer_decision",
							nextCommand: FLOW_STATUS_COMMAND,
							retryable: true,
							autoResolvable: true,
						},
			);
		case "missing_validation_scope":
			return buildStatusRecovery(
				wasFinalFeature
					? {
							errorCode: "missing_broad_validation",
							resolutionHint:
								"The active feature is on the session's final completion path. Run broad repo validation and retry with validationScope set to 'broad'.",
							recoveryStage: "rerun_validation",
							prerequisite: "validation_rerun_required",
							requiredArtifact: "broad_validation_result",
							nextCommand: FLOW_STATUS_COMMAND,
							retryable: true,
							autoResolvable: true,
						}
					: {
							errorCode: "missing_targeted_validation",
							resolutionHint:
								"Run targeted validation for the active feature and retry with validationScope set to 'targeted'.",
							recoveryStage: "rerun_validation",
							prerequisite: "validation_rerun_required",
							requiredArtifact: "targeted_validation_result",
							nextCommand: FLOW_STATUS_COMMAND,
							retryable: true,
							autoResolvable: true,
						},
			);
		case "failing_feature_review":
			return buildResetFeatureRecovery(featureId, {
				errorCode: "failing_feature_review",
				resolutionHint:
					"Fix the feature review findings, rerun targeted validation, and rerun the current Flow feature.",
				recoveryStage: "reset_feature",
				prerequisite: "feature_reset_required",
				retryable: true,
				autoResolvable: true,
			});
		case "missing_final_review":
			return buildStatusRecovery({
				errorCode: "missing_final_review_payload",
				resolutionHint:
					"The active feature is on the session's final completion path. Run the final cross-feature review, include a passing finalReview in the worker result, and rerun the current Flow feature.",
				recoveryStage: "retry_completion",
				prerequisite: "completion_payload_rebuild_required",
				requiredArtifact: "final_review_payload",
				nextCommand: FLOW_STATUS_COMMAND,
				retryable: true,
				autoResolvable: true,
			});
		case "failing_final_review":
			return buildResetFeatureRecovery(featureId, {
				errorCode: "failing_final_review",
				resolutionHint:
					"Fix the final review findings, rerun broad validation, and rerun the current Flow feature with a passing finalReview.",
				recoveryStage: "reset_feature",
				prerequisite: "feature_reset_required",
				retryable: true,
				autoResolvable: true,
			});
		default: {
			const exhaustiveKind: never = kind;
			throw new Error(
				`Unhandled completion recovery kind: ${exhaustiveKind satisfies string}`,
			);
		}
	}
}
