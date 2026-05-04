import type { Plan } from "../schema";

type FeatureSubsetResult =
	| { ok: true; value: Plan["features"] }
	| { ok: false; error: string };

function ensureRequestedFeatureIdsExist(
	features: Plan["features"],
	requestedIds: string[],
): string | null {
	const knownIds = new Set(features.map((feature) => feature.id));
	const unknownIds = requestedIds.filter((id) => !knownIds.has(id));
	return unknownIds.length > 0
		? `Unknown feature ids: ${unknownIds.join(", ")}.`
		: null;
}

export function selectProjectedFeatureSubset(
	features: Plan["features"],
	featureIds: string[],
	dependencyErrorMessage: (featureId: string) => string,
	preserveCompleted: boolean,
): FeatureSubsetResult {
	const unknownIdsError = ensureRequestedFeatureIdsExist(features, featureIds);
	if (unknownIdsError) {
		return { ok: false, error: unknownIdsError };
	}

	const selectedIds = new Set(featureIds);
	const filtered = features.filter((feature) => selectedIds.has(feature.id));
	if (filtered.length === 0) {
		return {
			ok: false,
			error: "None of the requested feature ids matched the draft plan.",
		};
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
			return { ok: false, error: dependencyErrorMessage(feature.id) };
		}
	}

	return {
		ok: true,
		value: filtered.map((feature) => ({
			...feature,
			status:
				preserveCompleted && feature.status === "completed"
					? "completed"
					: "pending",
		})),
	};
}
