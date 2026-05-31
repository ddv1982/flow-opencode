import type { FinalReviewSurface } from "./final-review-coverage-evidence";

export type DetailedFinalReviewRequirementFailure =
	| "too_few_surfaces"
	| "missing_validation_evidence"
	| "missing_cross_feature_surface"
	| "missing_integration_checks"
	| "missing_regression_checks";

type DetailedFinalReviewTarget = {
	reviewDepth: string;
	reviewedSurfaces: string[];
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
};

const DETAILED_FINAL_REVIEW_CROSS_FEATURE_SURFACES: readonly FinalReviewSurface[] =
	[
		"integration_points",
		"shared_surfaces",
		"tooling_and_config",
		"release_surface",
	] as const;

const DETAILED_FINAL_REVIEW_FAILURE_MESSAGES: Record<
	DetailedFinalReviewRequirementFailure,
	string
> = {
	too_few_surfaces: "must cover at least two reviewedSurfaces",
	missing_validation_evidence: "must include validation_evidence",
	missing_cross_feature_surface:
		"must include at least one cross-feature surface",
	missing_integration_checks: "must include integrationChecks",
	missing_regression_checks: "must include regressionChecks",
};

function hasMeaningfulEntry(values: readonly string[] | undefined): boolean {
	return values?.some((value) => value.trim().length > 0) ?? false;
}

export function detailedFinalReviewRequirementFailures(
	review: DetailedFinalReviewTarget,
): DetailedFinalReviewRequirementFailure[] {
	if (review.reviewDepth !== "detailed") {
		return [];
	}

	const failures: DetailedFinalReviewRequirementFailure[] = [];
	const reviewedSurfaceSet = new Set(review.reviewedSurfaces);

	if (review.reviewedSurfaces.length < 2) {
		failures.push("too_few_surfaces");
	}
	if (!reviewedSurfaceSet.has("validation_evidence")) {
		failures.push("missing_validation_evidence");
	}
	if (
		!DETAILED_FINAL_REVIEW_CROSS_FEATURE_SURFACES.some((surface) =>
			reviewedSurfaceSet.has(surface),
		)
	) {
		failures.push("missing_cross_feature_surface");
	}
	if (!hasMeaningfulEntry(review.integrationChecks)) {
		failures.push("missing_integration_checks");
	}
	if (!hasMeaningfulEntry(review.regressionChecks)) {
		failures.push("missing_regression_checks");
	}

	return failures;
}

export function detailedFinalReviewRequirementFailureMessages(
	review: DetailedFinalReviewTarget,
): string[] {
	return detailedFinalReviewRequirementFailures(review).map(
		(failure) => DETAILED_FINAL_REVIEW_FAILURE_MESSAGES[failure],
	);
}
