import type { RecordReviewerDecisionInput } from "../domain";
import type {
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
} from "../schema";

export function normalizeFeatureReviewDecision(
	decision: FlowReviewRecordFeatureArgs,
): RecordReviewerDecisionInput {
	return {
		scope: "feature" as const,
		featureId: decision.featureId,
		status: decision.status,
		summary: decision.summary,
		blockingFindings: decision.blockingFindings ?? [],
		followUps: decision.followUps ?? [],
		suggestedValidation: decision.suggestedValidation ?? [],
		...(decision.reviewPurpose
			? { reviewPurpose: decision.reviewPurpose }
			: {}),
	};
}

export function normalizeFinalReviewDecision(
	decision: FlowReviewRecordFinalArgs,
): RecordReviewerDecisionInput {
	return {
		scope: "final" as const,
		status: decision.status,
		summary: decision.summary,
		reviewDepth: decision.reviewDepth,
		reviewedSurfaces: decision.reviewedSurfaces ?? [],
		...(decision.evidenceSummary
			? { evidenceSummary: decision.evidenceSummary }
			: {}),
		...(decision.validationAssessment
			? { validationAssessment: decision.validationAssessment }
			: {}),
		evidenceRefs: {
			changedArtifacts: decision.evidenceRefs?.changedArtifacts ?? [],
			validationCommands: decision.evidenceRefs?.validationCommands ?? [],
		},
		remainingGaps: decision.remainingGaps ?? [],
		blockingFindings: decision.blockingFindings ?? [],
		followUps: decision.followUps ?? [],
		suggestedValidation: decision.suggestedValidation ?? [],
		...(decision.reviewPurpose
			? { reviewPurpose: decision.reviewPurpose }
			: {}),
	};
}
