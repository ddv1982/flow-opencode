import type { Plan, Session } from "../schema";
import {
	completedFeatureCount,
	targetCompletedFeatureCount,
} from "./workflow-policy";

export function featureWouldReachCompletion(
	plan: Plan,
	featureId: string,
): boolean {
	const target = targetCompletedFeatureCount(plan);
	const projectedCompleted = plan.features.filter(
		(feature) => feature.status === "completed" || feature.id === featureId,
	).length;
	return projectedCompleted >= target;
}

export function summarizeCompletion(session: Session): {
	completedFeatures: number;
	targetCompletedFeatures: number;
	totalFeatures: number;
	canCompleteWithPendingFeatures: boolean;
	activeFeatureTriggersSessionCompletion: boolean;
	remainingBeyondTarget: number;
} | null {
	const plan = session.plan;
	if (!plan) {
		return null;
	}

	const completedFeatures = completedFeatureCount(plan.features);
	const targetCompletedFeatures = targetCompletedFeatureCount(plan);
	const totalFeatures = plan.features.length;
	const activeFeatureId = session.execution.activeFeatureId;

	return {
		completedFeatures,
		targetCompletedFeatures,
		totalFeatures,
		canCompleteWithPendingFeatures: targetCompletedFeatures < totalFeatures,
		activeFeatureTriggersSessionCompletion: activeFeatureId
			? featureWouldReachCompletion(plan, activeFeatureId)
			: false,
		remainingBeyondTarget: Math.max(totalFeatures - targetCompletedFeatures, 0),
	};
}
