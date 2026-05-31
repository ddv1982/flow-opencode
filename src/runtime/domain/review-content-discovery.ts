import { FINAL_REVIEW_SURFACES } from "../constants";
import { normalizeSafeReviewArtifactPath } from "./final-review-coverage-paths";
import { deriveReviewContextPackSurfaces } from "./review-context-grounding";
import {
	normalizeIncludedContext,
	normalizeNonEmptyString,
	normalizeRelationships,
	normalizeValidationEvidence,
	type ReviewContextPack,
	type ReviewContextPackInput,
	type ReviewDiscoverySurface,
	uniqueNormalizedStrings,
} from "./review-context-normalization";

export {
	describeReviewContextPackGroundingFailure,
	reviewContextPackHasSurfaceEvidence,
} from "./review-context-grounding";
export type {
	ReviewContextPack,
	ReviewContextPackInput,
} from "./review-context-normalization";
export { REVIEW_DISCOVERY_REASONS } from "./review-context-normalization";

export function buildReviewContextPack(
	input: ReviewContextPackInput,
): ReviewContextPack {
	const changedFiles = uniqueNormalizedStrings(
		input.changedFiles,
		normalizeSafeReviewArtifactPath,
	);
	const includedContext = normalizeIncludedContext(
		input.includedContext,
		changedFiles,
	);
	const validationEvidence = normalizeValidationEvidence(
		input.validationEvidence,
	);
	const derivedSurfaces = deriveReviewContextPackSurfaces({
		changedFiles,
		includedContext,
		validationEvidence,
	});
	const reviewedSurfaceSet = new Set<ReviewDiscoverySurface>([
		...derivedSurfaces,
		...(input.reviewedSurfaces ?? []),
	]);

	return {
		task: input.task.trim(),
		...(input.compareBase?.trim()
			? { compareBase: input.compareBase.trim() }
			: {}),
		changedFiles,
		includedContext,
		relationships: normalizeRelationships(input.relationships),
		validationEvidence,
		suggestedValidation: uniqueNormalizedStrings(
			input.suggestedValidation,
			normalizeNonEmptyString,
		),
		coverageGaps: uniqueNormalizedStrings(
			input.coverageGaps,
			normalizeNonEmptyString,
		),
		reviewedSurfaces: FINAL_REVIEW_SURFACES.filter((surface) =>
			reviewedSurfaceSet.has(surface),
		),
	};
}
