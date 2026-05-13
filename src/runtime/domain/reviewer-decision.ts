import type { ReviewerDecision, Session } from "../schema";
import { describeFinalReviewCoverageFailure } from "./final-review-coverage";
import { describeFinalReviewerReviewScopeFailure } from "./review-scope-accounting";
import {
	buildNormalizedReviewContextPack,
	finalReviewedSurfacesForInput,
	normalizeBehaviorChecksForCoverage,
	normalizeFinalReviewEvidenceRefs,
	normalizeReviewScopeLedgerForDecision,
	normalizeValidationCoverageForCoverage,
	type RecordReviewerDecisionInput,
} from "./reviewer-decision-normalization";
import { describeReviewerDecisionShapeFailure } from "./reviewer-decision-shape-validation";
import { reviewerPurposeForScope } from "./workflow-policy";

export type { RecordReviewerDecisionInput } from "./reviewer-decision-normalization";

type FinalScopeReviewerDecision = Extract<ReviewerDecision, { scope: "final" }>;

export type ReviewerDecisionValidationFailureKind =
	| "shape"
	| "final_review_coverage"
	| "final_review_scope_accounting";

export type ReviewerDecisionValidationFailure = {
	kind: ReviewerDecisionValidationFailureKind;
	message: string;
};

function reviewerDecisionValidationFailure(
	kind: ReviewerDecisionValidationFailureKind,
	message: string,
): ReviewerDecisionValidationFailure {
	return { kind, message };
}

export function validateReviewerDecisionInputDetailed(
	session: Session,
	input: RecordReviewerDecisionInput,
): ReviewerDecisionValidationFailure | null {
	const shapeFailure = describeReviewerDecisionShapeFailure(session, input);
	if (shapeFailure) {
		return reviewerDecisionValidationFailure("shape", shapeFailure);
	}

	if (input.scope === "final" && input.status === "approved") {
		const finalReviewedSurfaces = finalReviewedSurfacesForInput(input);
		const evidenceRefs = normalizeFinalReviewEvidenceRefs(input);
		const reviewContextPack = buildNormalizedReviewContextPack(input);
		const coverageFailure = describeFinalReviewCoverageFailure(
			session,
			{
				artifactsChanged: evidenceRefs.changedArtifacts.map((path) => ({
					path,
				})),
				validationRun: evidenceRefs.validationCommands.map((command) => ({
					command,
				})),
			},
			{
				reviewDepth: input.reviewDepth ?? "",
				reviewedSurfaces: finalReviewedSurfaces,
				evidenceSummary: input.evidenceSummary,
				validationAssessment: input.validationAssessment,
				evidenceRefs,
				integrationChecks: input.integrationChecks,
				regressionChecks: input.regressionChecks,
				remainingGaps: input.remainingGaps,
				suggestedValidation: input.suggestedValidation,
				behaviorChecks: normalizeBehaviorChecksForCoverage(
					input.behaviorChecks,
				),
				validationCoverage: normalizeValidationCoverageForCoverage(
					input.validationCoverage,
				),
				...(reviewContextPack ? { reviewContextPack } : {}),
			},
		);
		if (coverageFailure) {
			return reviewerDecisionValidationFailure(
				"final_review_coverage",
				`Reviewer decision validation failed: finalReviewCoverage: ${coverageFailure}`,
			);
		}
		const reviewScopeFailure = describeFinalReviewerReviewScopeFailure(
			session,
			{
				status: "approved",
				evidenceRefs,
				reviewScopeLedger: normalizeReviewScopeLedgerForDecision(
					input.reviewScopeLedger,
				),
				...(reviewContextPack ? { reviewContextPack } : {}),
			},
		);
		if (reviewScopeFailure) {
			return reviewerDecisionValidationFailure(
				"final_review_scope_accounting",
				`Reviewer decision validation failed: reviewScopeLedger: ${reviewScopeFailure}`,
			);
		}
	}

	return null;
}

export function validateReviewerDecisionInput(
	session: Session,
	input: RecordReviewerDecisionInput,
): string | null {
	return validateReviewerDecisionInputDetailed(session, input)?.message ?? null;
}

export function buildReviewerDecision(
	input: RecordReviewerDecisionInput,
): ReviewerDecision {
	const finalReviewedSurfaces = finalReviewedSurfacesForInput(input);
	const finalEvidenceRefs = normalizeFinalReviewEvidenceRefs(input);
	const finalReviewDepth = input.reviewDepth as
		| FinalScopeReviewerDecision["reviewDepth"]
		| undefined;
	const featureReviewerId = input.featureId ?? "";
	const reviewerStatus = input.status as ReviewerDecision["status"];
	const reviewScopeLedger = normalizeReviewScopeLedgerForDecision(
		input.reviewScopeLedger,
	);
	const reviewContextPack = buildNormalizedReviewContextPack(input);

	return input.scope === "final"
		? {
				scope: "final",
				reviewPurpose: reviewerPurposeForScope("final"),
				reviewDepth:
					finalReviewDepth as FinalScopeReviewerDecision["reviewDepth"],
				status: reviewerStatus,
				summary: input.summary,
				blockingFindings: input.blockingFindings ?? [],
				followUps: input.followUps ?? [],
				suggestedValidation: input.suggestedValidation ?? [],
				reviewedSurfaces:
					finalReviewedSurfaces as FinalScopeReviewerDecision["reviewedSurfaces"],
				...(input.evidenceSummary
					? { evidenceSummary: input.evidenceSummary }
					: {}),
				...(input.validationAssessment
					? { validationAssessment: input.validationAssessment }
					: {}),
				evidenceRefs: {
					changedArtifacts: finalEvidenceRefs.changedArtifacts,
					validationCommands: finalEvidenceRefs.validationCommands,
				},
				...(input.evidencePackets
					? { evidencePackets: input.evidencePackets }
					: {}),
				...(reviewScopeLedger ? { reviewScopeLedger } : {}),
				...(reviewContextPack ? { reviewContextPack } : {}),
				integrationChecks: (input.integrationChecks ??
					[]) as FinalScopeReviewerDecision["integrationChecks"],
				regressionChecks: (input.regressionChecks ??
					[]) as FinalScopeReviewerDecision["regressionChecks"],
				remainingGaps: (input.remainingGaps ??
					[]) as FinalScopeReviewerDecision["remainingGaps"],
				behaviorChecks: normalizeBehaviorChecksForCoverage(
					input.behaviorChecks,
				) as FinalScopeReviewerDecision["behaviorChecks"],
				validationCoverage: normalizeValidationCoverageForCoverage(
					input.validationCoverage,
				) as FinalScopeReviewerDecision["validationCoverage"],
			}
		: {
				scope: "feature",
				featureId: featureReviewerId,
				reviewPurpose: reviewerPurposeForScope("feature"),
				status: reviewerStatus,
				summary: input.summary,
				blockingFindings: input.blockingFindings ?? [],
				followUps: input.followUps ?? [],
				suggestedValidation: input.suggestedValidation ?? [],
			};
}
