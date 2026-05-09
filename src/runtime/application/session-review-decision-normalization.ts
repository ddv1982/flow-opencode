import { buildReviewContextPack } from "../domain";
import type { ReviewContextPackInput } from "../domain/review-content-discovery";
import type { RecordReviewerDecisionInput } from "../domain/reviewer-decision";
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
			changedArtifacts: decision.evidenceRefs.changedArtifacts,
			validationCommands: decision.evidenceRefs.validationCommands,
		},
		...(decision.evidencePackets
			? { evidencePackets: decision.evidencePackets }
			: {}),
		...(decision.reviewScopeLedger
			? { reviewScopeLedger: decision.reviewScopeLedger }
			: {}),
		...(decision.reviewContextPack
			? {
					reviewContextPack: buildReviewContextPack(
						decision.reviewContextPack as ReviewContextPackInput,
					),
				}
			: {}),
		integrationChecks: decision.integrationChecks ?? [],
		regressionChecks: decision.regressionChecks ?? [],
		remainingGaps: decision.remainingGaps ?? [],
		behaviorChecks:
			(decision.behaviorChecks as RecordReviewerDecisionInput["behaviorChecks"]) ??
			[],
		validationCoverage:
			(decision.validationCoverage as RecordReviewerDecisionInput["validationCoverage"]) ??
			[],
		blockingFindings: decision.blockingFindings ?? [],
		followUps: decision.followUps ?? [],
		suggestedValidation: decision.suggestedValidation ?? [],
		...(decision.reviewPurpose
			? { reviewPurpose: decision.reviewPurpose }
			: {}),
	};
}
