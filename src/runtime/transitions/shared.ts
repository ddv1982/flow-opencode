import { ZodError } from "zod";
import type { Feature, Session } from "../schema";

export type TransitionResult<T> =
	| { ok: true; value: T }
	| {
			ok: false;
			message: string;
			recovery?: TransitionRecovery;
			session?: Session;
	  };

export type TransitionRecovery = {
	errorCode: string;
	resolutionHint: string;
	recoveryStage:
		| "record_review"
		| "rerun_validation"
		| "retry_completion"
		| "reset_feature";
	prerequisite:
		| "reviewer_result_required"
		| "validation_rerun_required"
		| "completion_payload_rebuild_required"
		| "feature_reset_required";
	requiredArtifact?:
		| "feature_reviewer_decision"
		| "final_reviewer_decision"
		| "feature_review_payload"
		| "final_review_payload"
		| "targeted_validation_result"
		| "broad_validation_result";
	nextCommand: string;
	nextRuntimeTool?:
		| "flow_review_record_feature"
		| "flow_review_record_final"
		| "flow_run_complete_feature"
		| "flow_reset_feature";
	nextRuntimeArgs?: Record<string, unknown>;
	retryable?: boolean;
	autoResolvable?: boolean;
};

export function fail<T>(
	message: string,
	recovery?: TransitionRecovery,
	session?: Session,
): TransitionResult<T> {
	return {
		ok: false,
		message,
		...(recovery ? { recovery } : {}),
		...(session ? { session } : {}),
	};
}

export function succeed<T>(value: T): TransitionResult<T> {
	return { ok: true, value };
}

export function formatValidationError(error: unknown): string {
	if (error instanceof ZodError) {
		return error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("; ");
	}

	return error instanceof Error ? error.message : "Unknown validation error";
}

export function cloneSession(session: Session): Session {
	return structuredClone(session);
}

export function clearExecution(session: Session): void {
	session.execution.activeFeatureId = null;
	session.execution.lastFeatureId = null;
	session.execution.lastSummary = null;
	session.execution.lastOutcomeKind = null;
	session.execution.lastOutcome = null;
	session.execution.lastNextStep = null;
	session.execution.lastFeatureResult = null;
	session.execution.lastReviewerDecision = null;
	session.execution.lastValidationRun = [];
}

export function indexFeatures(features: Feature[]): Map<string, Feature> {
	return new Map(features.map((feature) => [feature.id, feature]));
}
