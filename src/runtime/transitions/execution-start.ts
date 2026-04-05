import type { Feature, Session } from "../schema";
import { cloneSession, fail, succeed, type TransitionResult } from "./shared";
import { firstRunnableFeature, markFeatureInProgress, markSessionCompleted } from "./execution-state";

function blockRun(session: Session, message: string): { session: Session; feature: null; reason: string } {
  const blocked = cloneSession(session);
  blocked.status = "blocked";
  blocked.execution.activeFeatureId = null;
  blocked.execution.lastSummary = message;
  blocked.execution.lastOutcomeKind = "blocked";
  return { session: blocked, feature: null, reason: message };
}

function startFeatureRun(
  session: Session,
  featureId: string,
): TransitionResult<{ session: Session; feature: Feature | null; reason?: string }> {
  const next = cloneSession(session);
  const plan = next.plan;
  if (!plan) {
    return fail("There is no approved plan to run.");
  }

  plan.features = markFeatureInProgress(plan.features, featureId);
  next.status = "running";
  next.execution.activeFeatureId = featureId;
  next.execution.lastFeatureId = featureId;
  next.execution.lastSummary = `Running feature '${featureId}'.`;
  next.execution.lastOutcomeKind = null;
  next.execution.lastReviewerDecision = null;

  return succeed({
    session: next,
    feature: plan.features.find((feature) => feature.id === featureId) ?? null,
  });
}

export function startRun(session: Session, requestedId?: string): TransitionResult<{ session: Session; feature: Feature | null; reason?: string }> {
  if (session.status === "completed") {
    return fail("This Flow session is already completed. Start a new plan to continue.");
  }
  if (!session.plan || session.approval !== "approved") {
    return fail("There is no approved plan to run.");
  }
  if (session.execution.activeFeatureId) {
    return fail(`Feature '${session.execution.activeFeatureId}' is already in progress.`);
  }

  if (session.plan.features.every((feature) => feature.status === "completed")) {
    return succeed({
      session: markSessionCompleted(session, "All planned features are complete."),
      feature: null,
      reason: "complete",
    });
  }

  const targetResult = firstRunnableFeature(session.plan.features, requestedId);
  if (!targetResult.ok) {
    if (targetResult.reason === "invalid_request") {
      return fail(targetResult.message);
    }

    return succeed(blockRun(session, targetResult.message));
  }

  return startFeatureRun(session, targetResult.value.id);
}
