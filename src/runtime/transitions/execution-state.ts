import type { Feature, Session } from "../schema";
import { nowIso } from "../time";
import { cloneSession, indexFeatures } from "./shared";

export type RunnableFeatureResult =
  | { ok: true; value: Feature }
  | { ok: false; message: string; reason: "invalid_request" | "blocked" };

export function completionThresholdReached(features: Feature[], plan: NonNullable<Session["plan"]>): boolean {
  const completedCount = features.filter((feature) => feature.status === "completed").length;
  const minimum = plan.completionPolicy?.minCompletedFeatures;

  if (minimum !== undefined) {
    return completedCount >= minimum;
  }

  return completedCount === features.length;
}

export function markSessionCompleted(session: Session, summary: string): Session {
  const next = cloneSession(session);
  next.status = "completed";
  next.execution.activeFeatureId = null;
  next.execution.lastSummary = summary;
  next.execution.lastOutcomeKind = "completed";
  next.timestamps.completedAt = nowIso();
  return next;
}

function isFeatureRunnable(feature: Feature, completed: Set<string>): boolean {
  const dependsOn = feature.dependsOn ?? [];
  const blockedBy = feature.blockedBy ?? [];
  return dependsOn.every((id) => completed.has(id)) && blockedBy.every((id) => completed.has(id));
}

export function firstRunnableFeature(features: Feature[], requestedId?: string): RunnableFeatureResult {
  const byId = indexFeatures(features);
  const completed = new Set(features.filter((feature) => feature.status === "completed").map((feature) => feature.id));

  if (requestedId) {
    const feature = byId.get(requestedId);
    if (!feature) {
      return { ok: false, message: `Feature '${requestedId}' was not found in the approved plan.`, reason: "invalid_request" };
    }
    if (feature.status === "completed") {
      return { ok: false, message: `Feature '${requestedId}' is already completed.`, reason: "invalid_request" };
    }
    if (!isFeatureRunnable(feature, completed)) {
      return {
        ok: false,
        message: `Feature '${requestedId}' is not runnable because its prerequisites are not complete.`,
        reason: "invalid_request",
      };
    }

    return { ok: true, value: feature };
  }

  const runnable = features.find((feature) => feature.status !== "completed" && isFeatureRunnable(feature, completed));
  if (!runnable) {
    return { ok: false, message: "No runnable feature is available in the approved plan.", reason: "blocked" };
  }

  return { ok: true, value: runnable };
}

export function markFeatureInProgress(features: Feature[], featureId: string): Feature[] {
  return features.map((feature) => {
    if (feature.id !== featureId) {
      return feature.status === "in_progress" ? { ...feature, status: "pending" } : feature;
    }

    return { ...feature, status: "in_progress" };
  });
}

export function projectCompletedFeatures(features: Feature[], featureId: string): Feature[] {
  return features.map((feature) => (feature.id === featureId ? { ...feature, status: "completed" } : feature));
}
