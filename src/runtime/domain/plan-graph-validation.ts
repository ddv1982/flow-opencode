import type { Plan, PlanningContext } from "../schema";

export const REVIEW_AND_FIX_FINDINGS_REQUIRED_MESSAGE =
	"review_and_fix plans require concrete existing findings in planning.reviewFindings. For broad review/codebase-review goals without findings, apply a review-first plan with goalMode: review, run discovery/audit, then replan remediation after findings exist.";

export function validateReviewAndFixFindingPrerequisite(
	plan: Plan,
	planning: PlanningContext,
): string | null {
	if (plan.goalMode !== "review_and_fix") {
		return null;
	}
	if (planning.reviewFindings.length > 0) {
		return null;
	}
	return REVIEW_AND_FIX_FINDINGS_REQUIRED_MESSAGE;
}

export function validatePlanGraph(plan: Plan): string | null {
	const ids = new Set<string>();

	for (const feature of plan.features) {
		if (ids.has(feature.id)) {
			return `Plan validation failed: duplicate feature id '${feature.id}'.`;
		}
		ids.add(feature.id);
	}

	const byId = new Map(plan.features.map((feature) => [feature.id, feature]));
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
	const visit = (featureId: string): boolean => {
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

		for (const edge of [
			...(feature.dependsOn ?? []),
			...(feature.blockedBy ?? []),
		]) {
			if (visit(edge)) {
				return true;
			}
		}

		visitState.set(featureId, "visited");
		return false;
	};

	for (const feature of plan.features) {
		if (visit(feature.id)) {
			return "Plan validation failed: the feature dependency graph contains a cycle.";
		}
	}

	return null;
}
