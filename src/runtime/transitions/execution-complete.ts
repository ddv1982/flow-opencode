import { WorkerResultSchema, type Session, type WorkerResult } from "../schema";
import { featureWouldReachCompletion } from "../domain";
import { nowIso } from "../time";
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
  const completionChecks: Array<{
    kind: Parameters<typeof buildCompletionRecovery>[2];
    message: string;
    failing: () => boolean;
  }> = [
    {
      kind: "missing_validation",
      message: "Worker result cannot complete the feature without recorded validation evidence.",
      failing: () => worker.validationRun.length === 0,
    },
    {
      kind: "failing_validation",
      message: "Worker result cannot complete the feature because validation did not fully pass.",
      failing: () => !isValidationPassing(worker.validationRun),
    },
    {
      kind: "missing_reviewer_decision",
      message: "Worker result cannot complete without a recorded approved reviewer decision.",
      failing: () => !hasApprovedReviewerDecision(session, featureId, wasFinalFeature),
    },
    {
      kind: "missing_validation_scope",
      message: "Worker result cannot complete the feature without targeted validation.",
      failing: () => !wasFinalFeature && worker.validationScope !== "targeted",
    },
    {
      kind: "failing_feature_review",
      message: "Worker result cannot complete the feature because featureReview is not passing.",
      failing: () => !isReviewPassing(worker.featureReview),
    },
    {
      kind: "failing_final_review",
      message: "Worker result cannot complete the feature because finalReview is not passing.",
      failing: () => Boolean(worker.finalReview && !isReviewPassing(worker.finalReview)),
    },
    {
      kind: "missing_validation_scope",
      message: "Worker result cannot complete the session without broad final validation.",
      failing: () => wasFinalFeature && worker.validationScope !== "broad",
    },
    {
      kind: "missing_final_review",
      message: "Worker result cannot complete the session without a finalReview.",
      failing: () => wasFinalFeature && !worker.finalReview,
    },
    {
      kind: "failing_final_review",
      message: "Worker result cannot complete the session because a passing finalReview is required.",
      failing: () => requireFinalReview && !isReviewPassing(worker.finalReview),
    },
  ];

  for (const check of completionChecks) {
    if (check.failing()) {
      return fail(check.message, buildCompletionRecovery(featureId, wasFinalFeature, check.kind));
    }
  }

  return succeed(undefined);
}

function finalizeSuccessfulCompletion(next: Session, featureId: string, summary: string): TransitionResult<Session> {
  const plan = next.plan;
  if (!plan) {
    return fail("There is no active plan to complete.");
  }
  plan.features = projectCompletedFeatures(plan.features, featureId);
  next.execution.activeFeatureId = null;

  if (completionThresholdReached(plan.features, plan)) {
    return succeed(markSessionCompleted(next, summary));
  }

  next.status = "ready";
  return succeed(next);
}

function finalizeIncompleteCompletion(next: Session, featureId: string, outcomeKind: WorkerOutcomeKind): Session {
  const plan = next.plan;
  if (!plan) {
    return next;
  }
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
  const plan = next.plan;
  if (!plan) {
    return fail("There is no active plan to apply the worker result to.");
  }
  const featureId = session.execution.activeFeatureId;
  const recordedAt = nowIso();
  const wasFinalFeature = featureWouldReachCompletion(plan, featureId);

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
      return fail(validation.message, validation.recovery, next);
    }

    return finalizeSuccessfulCompletion(next, featureId, worker.summary);
  }

  return succeed(finalizeIncompleteCompletion(next, featureId, worker.outcome.kind));
}
