import type { Feature } from "../schema";
import { fail, succeed, type TransitionResult } from "./shared";

function ensureRequestedFeatureIdsExist(
	features: Feature[],
	requestedIds: string[],
): string | null {
	const knownIds = new Set(features.map((feature) => feature.id));
	const unknownIds = requestedIds.filter((id) => !knownIds.has(id));
	if (unknownIds.length > 0) {
		return `Unknown feature ids: ${unknownIds.join(", ")}.`;
	}

	return null;
}

function selectDependencyConsistentFeatureSubset(
	features: Feature[],
	featureIds: string[],
	dependencyErrorMessage: (featureId: string) => string,
): TransitionResult<Feature[]> {
	const unknownIdsError = ensureRequestedFeatureIdsExist(features, featureIds);
	if (unknownIdsError) {
		return fail(unknownIdsError);
	}

	const selectedIds = new Set(featureIds);
	const filtered = features.filter((feature) => selectedIds.has(feature.id));
	if (filtered.length === 0) {
		return fail("None of the requested feature ids matched the draft plan.");
	}

	const filteredIds = new Set(filtered.map((feature) => feature.id));
	for (const feature of filtered) {
		const unresolvedDependsOn = (feature.dependsOn ?? []).filter(
			(id) => !filteredIds.has(id),
		);
		const unresolvedBlockedBy = (feature.blockedBy ?? []).filter(
			(id) => !filteredIds.has(id),
		);
		if (unresolvedDependsOn.length > 0 || unresolvedBlockedBy.length > 0) {
			return fail(dependencyErrorMessage(feature.id));
		}
	}

	return succeed(filtered);
}

function projectSelectedFeatures(
	features: Feature[],
	preserveCompleted: boolean,
): Feature[] {
	return features.map((feature) => ({
		...feature,
		status:
			preserveCompleted && feature.status === "completed"
				? "completed"
				: "pending",
	}));
}

export function selectProjectedFeatureSubset(
	features: Feature[],
	featureIds: string[],
	dependencyErrorMessage: (featureId: string) => string,
	preserveCompleted: boolean,
): TransitionResult<Feature[]> {
	const subset = selectDependencyConsistentFeatureSubset(
		features,
		featureIds,
		dependencyErrorMessage,
	);
	if (!subset.ok) {
		return subset;
	}

	return succeed(projectSelectedFeatures(subset.value, preserveCompleted));
}
