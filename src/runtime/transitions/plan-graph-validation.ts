import type { Plan } from "../schema";
import { indexFeatures } from "./shared";

export function validatePlanGraph(plan: Plan): string | null {
	const ids = new Set<string>();

	for (const feature of plan.features) {
		if (ids.has(feature.id)) {
			return `Plan validation failed: duplicate feature id '${feature.id}'.`;
		}
		ids.add(feature.id);
	}

	for (const feature of plan.features) {
		for (const dependencyId of feature.dependsOn ?? []) {
			if (!ids.has(dependencyId)) {
				return `Plan validation failed: feature '${feature.id}' depends on unknown feature '${dependencyId}'.`;
			}
			if (dependencyId === feature.id) {
				return `Plan validation failed: feature '${feature.id}' cannot depend on itself.`;
			}
		}

		for (const blockerId of feature.blockedBy ?? []) {
			if (!ids.has(blockerId)) {
				return `Plan validation failed: feature '${feature.id}' is blocked by unknown feature '${blockerId}'.`;
			}
			if (blockerId === feature.id) {
				return `Plan validation failed: feature '${feature.id}' cannot block itself.`;
			}
		}
	}

	const visitState = new Map<string, "visiting" | "visited">();
	const byId = indexFeatures(plan.features);

	function visit(featureId: string): boolean {
		const current = visitState.get(featureId);
		if (current === "visiting") {
			return true;
		}
		if (current === "visited") {
			return false;
		}

		visitState.set(featureId, "visiting");
		const feature = byId.get(featureId);
		if (!feature) {
			visitState.set(featureId, "visited");
			return false;
		}

		const edges = [...(feature.dependsOn ?? []), ...(feature.blockedBy ?? [])];
		for (const edge of edges) {
			if (visit(edge)) {
				return true;
			}
		}

		visitState.set(featureId, "visited");
		return false;
	}

	for (const feature of plan.features) {
		if (visit(feature.id)) {
			return "Plan validation failed: the feature dependency graph contains a cycle.";
		}
	}

	return null;
}
