import { WorkerResultSchema, type Session, type WorkerResult } from "../schema";
import { buildCompletionRecovery } from "./execution-recovery";
import { cloneSession, fail, formatValidationError, succeed, type TransitionResult } from "./shared";
import { completionThresholdReached, markSessionCompleted, projectCompletedFeatures } from "./execution-state";

type WorkerOutcomeKind = NonNullable<WorkerResult["outcome"]>["kind"];

function hasApprovedReviewerDecision(session: Session, featureId: string, wasFinalFeature: boolean): boolean {
  const decision = session.execution.lastReviewerDecision;
  if (!decision || decision.status !== "approved") {
    return false;
  }

  if (wasFinalFeature) {
    return decision.scope === "final";
  }

  return decision.scope === "feature" && decision.featureId === featureId;
}

function isReviewPassing(review: WorkerResult["featureReview"] | WorkerResult["finalReview"] | undefined): boolean {
  if (!review) {
    return false;
  }

  return review.status === "passed" && review.blockingFindings.length === 0;
}

function isValidationPassing(validationRun: Session["execution"]["lastValidationRun"]): boolean {
  return validationRun.length > 0 && validationRun.every((item) => item.status === "passed");
}

function inferWorkerOutcomeKind(worker: WorkerResult): WorkerOutcomeKind | "completed" | "needs_input" {
  return worker.outcome?.kind ?? (worker.status === "ok" ? "completed" : "needs_input");
}

function recordWorkerResult(session: Session, featureId: string, worker: WorkerResult, recordedAt: string): void {
  const outcomeKind = inferWorkerOutcomeKind(worker);

  session.artifacts = worker.artifactsChanged;
  session.execution.lastValidationRun = worker.validationRun;
  session.execution.lastFeatureId = featureId;
  session.execution.lastSummary = worker.summary;
  session.execution.lastOutcomeKind = outcomeKind;
  session.execution.lastOutcome = worker.outcome ?? null;
  session.execution.lastNextStep = worker.nextStep;
  session.execution.lastFeatureResult = worker.featureResult;
  session.execution.history.push({
    featureId,
    status: worker.status,
    summary: worker.summary,
    recordedAt,
    outcomeKind,
    outcome: worker.outcome ?? null,
    nextStep: worker.nextStep,
    validationRun: worker.validationRun,
    artifactsChanged: worker.artifactsChanged,
    decisions: worker.decisions,
    featureResult: worker.featureResult,
    reviewerDecision: session.execution.lastReviewerDecision,
    featureReview: worker.featureReview,
    finalReview: worker.finalReview,
  });
  session.notes = worker.decisions.map((decision) => decision.summary);
}

function validateSuccessfulCompletion(
  session: Session,
  worker: WorkerResult,
  featureId: string,
  wasFinalFeature: boolean,
  requireFinalReview: boolean,
): TransitionResult<void> {
  if (worker.validationRun.length === 0) {
    return fail(
      "Worker result cannot complete the feature without recorded validation evidence.",
      buildCompletionRecovery(featureId, wasFinalFeature, "missing_validation"),
    );
  }
  if (!isValidationPassing(worker.validationRun)) {
    return fail(
      "Worker result cannot complete the feature because validation did not fully pass.",
      buildCompletionRecovery(featureId, wasFinalFeature, "failing_validation"),
    );
  }
  if (!hasApprovedReviewerDecision(session, featureId, wasFinalFeature)) {
    return fail(
      "Worker result cannot complete without a recorded approved reviewer decision.",
      buildCompletionRecovery(featureId, wasFinalFeature, "missing_reviewer_decision"),
    );
  }
  if (!wasFinalFeature && worker.validationScope !== "targeted") {
    return fail(
      "Worker result cannot complete the feature without targeted validation.",
      buildCompletionRecovery(featureId, wasFinalFeature, "missing_validation_scope"),
    );
  }
  if (!isReviewPassing(worker.featureReview)) {
    return fail(
      "Worker result cannot complete the feature because featureReview is not passing.",
      buildCompletionRecovery(featureId, wasFinalFeature, "failing_feature_review"),
    );
  }
  if (worker.finalReview && !isReviewPassing(worker.finalReview)) {
    return fail(
      "Worker result cannot complete the feature because finalReview is not passing.",
      buildCompletionRecovery(featureId, wasFinalFeature, "failing_final_review"),
    );
  }
  if (wasFinalFeature && worker.validationScope !== "broad") {
    return fail(
      "Worker result cannot complete the session without broad final validation.",
      buildCompletionRecovery(featureId, wasFinalFeature, "missing_validation_scope"),
    );
  }
  if (wasFinalFeature && !worker.finalReview) {
    return fail(
      "Worker result cannot complete the session without a finalReview.",
      buildCompletionRecovery(featureId, wasFinalFeature, "missing_final_review"),
    );
  }
  if (requireFinalReview && !isReviewPassing(worker.finalReview)) {
    return fail(
      "Worker result cannot complete the session because a passing finalReview is required.",
      buildCompletionRecovery(featureId, wasFinalFeature, "failing_final_review"),
    );
  }

  return succeed(undefined);
}

function finalizeSuccessfulCompletion(next: Session, featureId: string, summary: string): TransitionResult<Session> {
  const plan = next.plan!;
  plan.features = projectCompletedFeatures(plan.features, featureId);
  next.execution.activeFeatureId = null;

  if (completionThresholdReached(plan.features, plan)) {
    return succeed(markSessionCompleted(next, summary));
  }

  next.status = "ready";
  return succeed(next);
}

function finalizeIncompleteCompletion(next: Session, featureId: string, outcomeKind: WorkerOutcomeKind): Session {
  const plan = next.plan!;
  next.execution.activeFeatureId = null;

  if (outcomeKind === "replan_required") {
    next.plan = null;
    next.status = "planning";
    next.approval = "pending";
    next.timestamps.approvedAt = null;
    return next;
  }

  plan.features = plan.features.map((feature) =>
    feature.id === featureId ? { ...feature, status: "blocked" } : feature,
  );
  next.status = "blocked";
  return next;
}

export function completeRun(session: Session, workerInput: unknown): TransitionResult<Session> {
  let worker: WorkerResult;
  try {
    worker = WorkerResultSchema.parse(workerInput);
  } catch (error) {
    return fail(`Worker result validation failed: ${formatValidationError(error)}`);
  }

  if (!session.plan) {
    return fail("There is no active plan to apply the worker result to.");
  }
  if (!session.execution.activeFeatureId) {
    return fail("There is no active feature to complete.");
  }
  if (worker.featureResult.featureId !== session.execution.activeFeatureId) {
    return fail(
      `Worker result feature '${worker.featureResult.featureId}' does not match active feature '${session.execution.activeFeatureId}'.`,
    );
  }

  const next = cloneSession(session);
  const plan = next.plan!;
  const featureId = session.execution.activeFeatureId;
  const recordedAt = new Date().toISOString();
  const wasFinalFeature = completionThresholdReached(projectCompletedFeatures(plan.features, featureId), plan);

  recordWorkerResult(next, featureId, worker, recordedAt);

  if (worker.status === "ok") {
    const validation = validateSuccessfulCompletion(
      session,
      worker,
      featureId,
      wasFinalFeature,
      Boolean(plan.completionPolicy?.requireFinalReview && wasFinalFeature),
    );
    if (!validation.ok) {
      return validation;
    }

    return finalizeSuccessfulCompletion(next, featureId, worker.summary);
  }

  return succeed(finalizeIncompleteCompletion(next, featureId, worker.outcome.kind));
}
