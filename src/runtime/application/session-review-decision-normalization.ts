import { buildReviewContextPack } from "../domain";
import type {
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
} from "../schema";

export function normalizeFeatureReviewDecision(
	decision: FlowReviewRecordFeatureArgs,
) {
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
) {
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
		...(decision.evidencePackets
			? { evidencePackets: decision.evidencePackets }
			: {}),
		...(decision.reviewContextPack
			? {
					reviewContextPack: buildReviewContextPack(decision.reviewContextPack),
				}
			: {}),
		integrationChecks: decision.integrationChecks ?? [],
		regressionChecks: decision.regressionChecks ?? [],
		remainingGaps: decision.remainingGaps ?? [],
		blockingFindings: decision.blockingFindings ?? [],
		followUps: decision.followUps ?? [],
		suggestedValidation: decision.suggestedValidation ?? [],
		...(decision.reviewPurpose
			? { reviewPurpose: decision.reviewPurpose }
			: {}),
	};
}
