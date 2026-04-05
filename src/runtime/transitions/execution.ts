import { WorkerResultSchema, type Feature, type Session, type WorkerResult } from "../schema";
import {
  cloneSession,
  fail,
  formatValidationError,
  indexFeatures,
  succeed,
  type TransitionRecovery,
  type TransitionResult,
} from "./shared";

type RunnableFeatureResult =
  | { ok: true; value: Feature }
  | { ok: false; message: string; reason: "invalid_request" | "blocked" };

type CompletionRecoveryKind =
  | "missing_validation"
  | "failing_validation"
  | "missing_reviewer_decision"
  | "missing_validation_scope"
  | "failing_feature_review"
  | "missing_final_review"
  | "failing_final_review";

type StaticCompletionRecovery = Omit<
  TransitionRecovery,
  "nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs"
> & {
  nextCommand?: TransitionRecovery["nextCommand"];
  nextRuntimeTool?: TransitionRecovery["nextRuntimeTool"];
  nextRuntimeArgs?: TransitionRecovery["nextRuntimeArgs"];
};

type ResetFeatureRecoveryKind =
  | "failing_feature_review"
  | "failing_final_review"
  | "failing_validation";

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

function completionThresholdReached(features: Feature[], plan: NonNullable<Session["plan"]>): boolean {
  const completedCount = features.filter((feature) => feature.status === "completed").length;
  const minimum = plan.completionPolicy?.minCompletedFeatures;

  if (minimum !== undefined) {
    return completedCount >= minimum;
  }

  return completedCount === features.length;
}

function markSessionCompleted(session: Session, summary: string): Session {
  const next = cloneSession(session);
  next.status = "completed";
  next.execution.activeFeatureId = null;
  next.execution.lastSummary = summary;
  next.execution.lastOutcomeKind = "completed";
  next.timestamps.completedAt = new Date().toISOString();
  return next;
}

const REVIEW_DECISION_RECOVERY: Record<"feature" | "final", StaticCompletionRecovery> = {
  feature: {
    errorCode: "missing_feature_reviewer_decision",
    resolutionHint: "Record a feature reviewer approval, then rerun the current Flow feature to persist completion.",
    recoveryStage: "record_review",
    prerequisite: "reviewer_result_required",
    requiredArtifact: "feature_reviewer_decision",
    nextCommand: "/flow-status",
    retryable: true,
    autoResolvable: true,
  },
  final: {
    errorCode: "missing_final_reviewer_decision",
    resolutionHint: "Record a final reviewer approval, then rerun the current Flow feature to persist final completion.",
    recoveryStage: "record_review",
    prerequisite: "reviewer_result_required",
    requiredArtifact: "final_reviewer_decision",
    nextCommand: "/flow-status",
    retryable: true,
    autoResolvable: true,
  },
};

const VALIDATION_SCOPE_RECOVERY: Record<"targeted" | "broad", StaticCompletionRecovery> = {
  targeted: {
    errorCode: "missing_targeted_validation",
    resolutionHint: "Run targeted validation for the active feature and retry with validationScope set to 'targeted'.",
    recoveryStage: "rerun_validation",
    prerequisite: "validation_rerun_required",
    requiredArtifact: "targeted_validation_result",
    nextCommand: "/flow-status",
    retryable: true,
    autoResolvable: true,
  },
  broad: {
    errorCode: "missing_broad_validation",
    resolutionHint: "Run broad repo validation for the final completion path and retry with validationScope set to 'broad'.",
    recoveryStage: "rerun_validation",
    prerequisite: "validation_rerun_required",
    requiredArtifact: "broad_validation_result",
    nextCommand: "/flow-status",
    retryable: true,
    autoResolvable: true,
  },
};

const STATIC_COMPLETION_RECOVERY: Record<
  Exclude<CompletionRecoveryKind, "missing_reviewer_decision" | "missing_validation_scope" | "failing_feature_review" | "failing_final_review" | "failing_validation">,
  StaticCompletionRecovery
> = {
  missing_final_review: {
    errorCode: "missing_final_review_payload",
    resolutionHint: "Run the final cross-feature review, include a passing finalReview in the worker result, and rerun the current Flow feature.",
    recoveryStage: "retry_completion",
    prerequisite: "completion_payload_rebuild_required",
    requiredArtifact: "final_review_payload",
    nextCommand: "/flow-status",
    retryable: true,
    autoResolvable: true,
  },
  missing_validation: {
    errorCode: "missing_validation_evidence",
    resolutionHint: "Run the required validation for the current Flow feature and retry completion with recorded validation evidence.",
    recoveryStage: "rerun_validation",
    prerequisite: "validation_rerun_required",
    nextCommand: "/flow-status",
    retryable: true,
    autoResolvable: true,
  },
};

const RESET_FEATURE_COMPLETION_RECOVERY: Record<
  ResetFeatureRecoveryKind,
  Omit<StaticCompletionRecovery, "nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs">
> = {
  failing_final_review: {
    errorCode: "failing_final_review",
    resolutionHint: "Fix the final review findings, rerun broad validation, and rerun the current Flow feature with a passing finalReview.",
    recoveryStage: "reset_feature",
    prerequisite: "feature_reset_required",
    retryable: true,
    autoResolvable: true,
  },
  failing_feature_review: {
    errorCode: "failing_feature_review",
    resolutionHint: "Fix the feature review findings, rerun targeted validation, and rerun the current Flow feature.",
    recoveryStage: "reset_feature",
    prerequisite: "feature_reset_required",
    retryable: true,
    autoResolvable: true,
  },
  failing_validation: {
    errorCode: "failing_validation",
    resolutionHint: "Fix the failing validation, rerun the relevant checks, and rerun the current Flow feature.",
    recoveryStage: "reset_feature",
    prerequisite: "feature_reset_required",
    retryable: true,
    autoResolvable: true,
  },
};

function isFeatureRunnable(feature: Feature, completed: Set<string>): boolean {
  const dependsOn = feature.dependsOn ?? [];
  const blockedBy = feature.blockedBy ?? [];
  return dependsOn.every((id) => completed.has(id)) && blockedBy.every((id) => completed.has(id));
}

function buildStatusRecovery(recovery: StaticCompletionRecovery): TransitionRecovery {
  return {
    ...recovery,
    nextCommand: recovery.nextCommand ?? "/flow-status",
  };
}

function buildResetFeatureRecovery(
  featureId: string,
  recovery: Omit<StaticCompletionRecovery, "nextCommand" | "nextRuntimeTool" | "nextRuntimeArgs">,
): TransitionRecovery {
  return {
    ...recovery,
    nextCommand: `/flow-reset feature ${featureId}`,
    nextRuntimeTool: "flow_reset_feature",
    nextRuntimeArgs: { featureId },
  };
}

function buildCompletionRecovery(
  featureId: string,
  wasFinalFeature: boolean,
  kind: CompletionRecoveryKind,
): TransitionRecovery {
  if (kind === "missing_reviewer_decision") {
    return buildStatusRecovery(REVIEW_DECISION_RECOVERY[wasFinalFeature ? "final" : "feature"]);
  }

  if (kind === "missing_validation_scope") {
    return buildStatusRecovery(VALIDATION_SCOPE_RECOVERY[wasFinalFeature ? "broad" : "targeted"]);
  }

  if (kind === "failing_feature_review" || kind === "failing_final_review" || kind === "failing_validation") {
    return buildResetFeatureRecovery(featureId, RESET_FEATURE_COMPLETION_RECOVERY[kind]);
  }

  return buildStatusRecovery(STATIC_COMPLETION_RECOVERY[kind]);
}

function firstRunnableFeature(features: Feature[], requestedId?: string): RunnableFeatureResult {
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

function markFeatureInProgress(features: Feature[], featureId: string): Feature[] {
  return features.map((feature) => {
    if (feature.id !== featureId) {
      return feature.status === "in_progress" ? { ...feature, status: "pending" } : feature;
    }

    return { ...feature, status: "in_progress" };
  });
}

function blockRun(session: Session, message: string): { session: Session; feature: null; reason: string } {
  const blocked = cloneSession(session);
  blocked.status = "blocked";
  blocked.execution.activeFeatureId = null;
  blocked.execution.lastSummary = message;
  blocked.execution.lastOutcomeKind = "blocked";
  return { session: blocked, feature: null, reason: message };
}

function startFeatureRun(session: Session, featureId: string): { session: Session; feature: Feature | null } {
  const next = cloneSession(session);
  const plan = next.plan!;

  plan.features = markFeatureInProgress(plan.features, featureId);
  next.status = "running";
  next.execution.activeFeatureId = featureId;
  next.execution.lastFeatureId = featureId;
  next.execution.lastSummary = `Running feature '${featureId}'.`;
  next.execution.lastOutcomeKind = null;
  next.execution.lastReviewerDecision = null;

  return {
    session: next,
    feature: plan.features.find((feature) => feature.id === featureId) ?? null,
  };
}

function inferWorkerOutcomeKind(worker: WorkerResult): WorkerOutcomeKind | "completed" | "needs_input" {
  return worker.outcome?.kind ?? (worker.status === "ok" ? "completed" : "needs_input");
}

function projectCompletedFeatures(features: Feature[], featureId: string): Feature[] {
  return features.map((feature) => (feature.id === featureId ? { ...feature, status: "completed" } : feature));
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

  return succeed(startFeatureRun(session, targetResult.value.id));
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
