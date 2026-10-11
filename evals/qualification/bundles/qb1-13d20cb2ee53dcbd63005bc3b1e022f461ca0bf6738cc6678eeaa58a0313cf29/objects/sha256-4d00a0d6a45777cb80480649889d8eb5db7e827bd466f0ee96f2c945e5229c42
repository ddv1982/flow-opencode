import type {
	FeatureId,
	FeatureRun,
	Session,
	SessionStatus,
} from "./session.js";
import { currentRun } from "./session.js";

export function activeRun(session: Session): FeatureRun | null {
	return session.runs.find((run) => run.state === "active") ?? null;
}

export function isFeatureComplete(
	session: Session,
	featureId: string,
): boolean {
	return currentRun(session, featureId)?.state === "completed";
}

export function sessionStatus(session: Session): SessionStatus {
	if (session.closure) return "closed";
	if (!session.plan || session.approval === "pending") return "planning";
	if (activeRun(session)) return "running";
	if (
		session.plan.features.some(
			(feature) => currentRun(session, feature.id)?.state === "blocked",
		)
	) {
		return "blocked";
	}
	if (
		session.plan.features.every((feature) =>
			isFeatureComplete(session, feature.id),
		)
	) {
		return "completed";
	}
	return "ready";
}

/** True when the feature's latest reviewed run failed, so it needs an explicit retry. */
function requiresExplicitRetry(
	session: Session,
	featureId: FeatureId,
): boolean {
	const reviewed = session.runs.findLast(
		(run) => run.featureId === featureId && run.reviews.at(-1)?.result,
	);
	return reviewed?.reviews.at(-1)?.result?.verdict === "failed";
}

export function nextRunnableFeature(session: Session): FeatureId | null {
	if (!session.plan) return null;
	for (const feature of session.plan.features) {
		const state = currentRun(session, feature.id)?.state;
		if (state === "completed") continue;
		if (state === "blocked") continue;
		if (requiresExplicitRetry(session, feature.id)) continue;
		if (feature.dependsOn.every((id) => isFeatureComplete(session, id))) {
			return feature.id;
		}
	}
	return null;
}

/** True when every other planned feature is already complete. */
export function isFinalFeatureRun(session: Session, run: FeatureRun): boolean {
	if (!session.plan) return false;
	return session.plan.features.every(
		(feature) =>
			feature.id === run.featureId || isFeatureComplete(session, feature.id),
	);
}
