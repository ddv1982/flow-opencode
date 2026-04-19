// Flow runtime policy owner: workflow completion targets and decision-gate semantics remain normative here.

import type { Feature, Plan, ReviewerDecision, Session } from "../schema";

export function reviewerPurposeForScope(
	scope: ReviewerDecision["scope"],
): NonNullable<ReviewerDecision["reviewPurpose"]> {
	return scope === "final" ? "completion_gate" : "execution_gate";
}

function thresholdTarget(plan: Plan): number {
	return plan.completionPolicy?.minCompletedFeatures ?? plan.features.length;
}

function coreFeatureTarget(plan: Plan): number {
	const coreFeatures = plan.features.filter(
		(feature) => feature.priority !== "nice_to_have" && !feature.deferCandidate,
	);
	return coreFeatures.length > 0 ? coreFeatures.length : thresholdTarget(plan);
}

export function targetCompletedFeatureCount(plan: Plan): number {
	const stopRule =
		plan.deliveryPolicy?.stopRule ??
		(plan.completionPolicy?.minCompletedFeatures !== undefined
			? "ship_when_threshold_met"
			: "ship_when_clean");
	if (stopRule === "ship_when_clean") {
		return plan.features.length;
	}
	if (stopRule === "ship_when_core_done" && plan.deliveryPolicy?.deferAllowed) {
		return coreFeatureTarget(plan);
	}
	return thresholdTarget(plan);
}

export function completedFeatureCount(features: Feature[]): number {
	return features.filter((feature) => feature.status === "completed").length;
}

export function sessionCompletionReached(
	plan: Plan,
	features: Feature[],
): boolean {
	return completedFeatureCount(features) >= targetCompletedFeatureCount(plan);
}

export function decisionRequiresPause(
	mode: Session["planning"]["decisionLog"][number]["decisionMode"],
): boolean {
	return mode !== "autonomous_choice";
}

export function activeDecisionGate(session: Session): {
	status: "recommend_confirm" | "human_required";
	domain: Session["planning"]["decisionLog"][number]["decisionDomain"];
	question: string;
	recommendation: string;
	rationale: string[];
} | null {
	for (
		let index = session.planning.decisionLog.length - 1;
		index >= 0;
		index -= 1
	) {
		const decision = session.planning.decisionLog[index];
		if (!decision) {
			continue;
		}
		if (decision.decisionMode === "recommend_confirm") {
			return {
				status: "recommend_confirm",
				domain: decision.decisionDomain,
				question: decision.question,
				recommendation: decision.recommendation,
				rationale: decision.rationale,
			};
		}
		if (decision.decisionMode === "human_required") {
			return {
				status: "human_required",
				domain: decision.decisionDomain,
				question: decision.question,
				recommendation: decision.recommendation,
				rationale: decision.rationale,
			};
		}
	}

	return null;
}
