import type { DetailedFinalReviewRequirementFailure } from "../domain";

const DETAILED_FINAL_REVIEW_DECISION_FAILURE_MESSAGES: Record<
	DetailedFinalReviewRequirementFailure,
	string
> = {
	too_few_surfaces:
		"Reviewer decision validation failed: reviewedSurfaces: Detailed final reviewer decisions must cover at least two reviewedSurfaces.",
	missing_validation_evidence:
		"Reviewer decision validation failed: reviewedSurfaces: Detailed final reviewer decisions must include validation_evidence.",
	missing_cross_feature_surface:
		"Reviewer decision validation failed: reviewedSurfaces: Detailed final reviewer decisions must include a cross-feature surface.",
	missing_integration_checks:
		"Reviewer decision validation failed: integrationChecks: Detailed final reviewer decisions must include integrationChecks.",
	missing_regression_checks:
		"Reviewer decision validation failed: regressionChecks: Detailed final reviewer decisions must include regressionChecks.",
};

export function detailedFinalReviewDecisionFailureMessage(
	failure: DetailedFinalReviewRequirementFailure,
): string {
	return DETAILED_FINAL_REVIEW_DECISION_FAILURE_MESSAGES[failure];
}
