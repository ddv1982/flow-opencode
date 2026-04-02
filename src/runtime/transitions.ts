import { ZodError } from "zod";
import {
  PlanSchema,
  ReviewerDecisionSchema,
  WorkerResultSchema,
  type Feature,
  type PlanningContext,
  type Plan,
  type Session,
  type WorkerResult,
} from "./schema";

export type TransitionResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; recovery?: TransitionRecovery };

export type TransitionRecovery = {
  errorCode: string;
  resolutionHint: string;
  recoveryStage: "record_review" | "rerun_validation" | "retry_completion" | "reset_feature";
  prerequisite:
    | "reviewer_result_required"
    | "validation_rerun_required"
    | "completion_payload_rebuild_required"
    | "feature_reset_required";
  requiredArtifact?:
    | "feature_reviewer_decision"
    | "final_reviewer_decision"
    | "feature_review_payload"
    | "final_review_payload"
    | "targeted_validation_result"
    | "broad_validation_result";
  nextCommand: string;
  nextRuntimeTool?: "flow_review_record_feature" | "flow_review_record_final" | "flow_run_complete_feature" | "flow_reset_feature";
  nextRuntimeArgs?: Record<string, unknown>;
  retryable?: boolean;
  autoResolvable?: boolean;
};

export function fail<T>(message: string, recovery?: TransitionRecovery): TransitionResult<T> {
  return { ok: false, message, recovery };
}

export function succeed<T>(value: T): TransitionResult<T> {
  return { ok: true, value };
}

function formatValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "Unknown validation error";
}

function cloneSession(session: Session): Session {
  return structuredClone(session);
}

function ensureRequestedFeatureIdsExist(features: Feature[], requestedIds: string[]): string | null {
  const knownIds = new Set(features.map((feature) => feature.id));
  const unknownIds = requestedIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    return `Unknown feature ids: ${unknownIds.join(", ")}.`;
  }

  return null;
}

function selectDependencyConsistentFeatureSubset(
  features: Feature[],
  featureIds: string[],
  dependencyErrorMessage: (featureId: string) => string,
): TransitionResult<Feature[]> {
  const unknownIdsError = ensureRequestedFeatureIdsExist(features, featureIds);
  if (unknownIdsError) {
    return fail(unknownIdsError);
  }

  const selectedIds = new Set(featureIds);
  const filtered = features.filter((feature) => selectedIds.has(feature.id));
  if (filtered.length === 0) {
    return fail("None of the requested feature ids matched the draft plan.");
  }

  const filteredIds = new Set(filtered.map((feature) => feature.id));
  for (const feature of filtered) {
    const unresolvedDependsOn = (feature.dependsOn ?? []).filter((id) => !filteredIds.has(id));
    const unresolvedBlockedBy = (feature.blockedBy ?? []).filter((id) => !filteredIds.has(id));
    if (unresolvedDependsOn.length > 0 || unresolvedBlockedBy.length > 0) {
      return fail(dependencyErrorMessage(feature.id));
    }
  }

  return succeed(filtered);
}

function clearExecution(session: Session): void {
  session.execution.activeFeatureId = null;
  session.execution.lastFeatureId = null;
  session.execution.lastSummary = null;
  session.execution.lastOutcomeKind = null;
  session.execution.lastOutcome = null;
  session.execution.lastNextStep = null;
  session.execution.lastFeatureResult = null;
  session.execution.lastReviewerDecision = null;
  session.execution.lastValidationRun = [];
}

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

function normalizePlan(planInput: unknown): Plan {
  const parsed = PlanSchema.parse(planInput);
  return {
    ...parsed,
    features: parsed.features.map((feature) => ({
      ...feature,
      status: "pending",
    })),
  };
}

function indexFeatures(features: Feature[]): Map<string, Feature> {
  return new Map(features.map((feature) => [feature.id, feature]));
}

function isFeatureRunnable(feature: Feature, completed: Set<string>): boolean {
  const dependsOn = feature.dependsOn ?? [];
  const blockedBy = feature.blockedBy ?? [];
  return dependsOn.every((id) => completed.has(id)) && blockedBy.every((id) => completed.has(id));
}

type RunnableFeatureResult =
  | { ok: true; value: Feature }
  | { ok: false; message: string; reason: "invalid_request" | "blocked" };

function validatePlanGraph(plan: Plan): string | null {
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
    const feature = byId.get(featureId)!;
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

function isReviewPassing(review: WorkerResult["featureReview"] | WorkerResult["finalReview"] | undefined): boolean {
  if (!review) {
    return false;
  }

  return review.status === "passed" && review.blockingFindings.length === 0;
}

function isValidationPassing(validationRun: Session["execution"]["lastValidationRun"]): boolean {
  return validationRun.length > 0 && validationRun.every((item) => item.status === "passed");
}

function completionThresholdReached(features: Feature[], plan: Plan): boolean {
  const completedCount = features.filter((feature) => feature.status === "completed").length;
  const minimum = plan.completionPolicy?.minCompletedFeatures;

  if (minimum !== undefined) {
    return completedCount >= minimum;
  }

  return completedCount === features.length;
}

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

  if (kind === "failing_final_review") {
    return buildResetFeatureRecovery(featureId, {
      errorCode: "failing_final_review",
      resolutionHint: "Fix the final review findings, rerun broad validation, and rerun the current Flow feature with a passing finalReview.",
      recoveryStage: "reset_feature",
      prerequisite: "feature_reset_required",
      retryable: true,
      autoResolvable: true,
    });
  }

  if (kind === "failing_feature_review") {
    return buildResetFeatureRecovery(featureId, {
      errorCode: "failing_feature_review",
      resolutionHint: "Fix the feature review findings, rerun targeted validation, and rerun the current Flow feature.",
      recoveryStage: "reset_feature",
      prerequisite: "feature_reset_required",
      retryable: true,
      autoResolvable: true,
    });
  }

  if (kind === "failing_validation") {
    return buildResetFeatureRecovery(featureId, {
      errorCode: "failing_validation",
      resolutionHint: "Fix the failing validation, rerun the relevant checks, and rerun the current Flow feature.",
      recoveryStage: "reset_feature",
      prerequisite: "feature_reset_required",
      retryable: true,
      autoResolvable: true,
    });
  }

  return buildStatusRecovery(STATIC_COMPLETION_RECOVERY[kind]);
}

function collectDependents(features: Feature[], featureId: string): Set<string> {
  const dependents = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const feature of features) {
      if (feature.id === featureId || dependents.has(feature.id)) {
        continue;
      }

      const dependencies = new Set([...(feature.dependsOn ?? []), ...(feature.blockedBy ?? [])]);
      if (dependencies.has(featureId) || [...dependents].some((id) => dependencies.has(id))) {
        dependents.add(feature.id);
        changed = true;
      }
    }
  }

  return dependents;
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

function markSessionCompleted(session: Session, summary: string): Session {
  const next = cloneSession(session);
  next.status = "completed";
  next.execution.activeFeatureId = null;
  next.execution.lastSummary = summary;
  next.execution.lastOutcomeKind = "completed";
  next.timestamps.completedAt = new Date().toISOString();
  return next;
}

export function applyPlan(
  session: Session,
  planInput: unknown,
  planning?: Partial<PlanningContext>,
): TransitionResult<Session> {
  try {
    const plan = normalizePlan(planInput);
    const planGraphError = validatePlanGraph(plan);
    if (planGraphError) {
      return fail(planGraphError);
    }

    const next = cloneSession(session);
    next.plan = plan;
    next.status = "planning";
    next.approval = "pending";
    next.timestamps.approvedAt = null;
    next.timestamps.completedAt = null;
    clearExecution(next);
    next.notes = [];
    next.planning = {
      repoProfile: planning?.repoProfile ?? next.planning.repoProfile,
      research: planning?.research ?? next.planning.research,
      implementationApproach: planning?.implementationApproach ?? next.planning.implementationApproach,
    };
    return succeed(next);
  } catch (error) {
    return fail(`Plan validation failed: ${formatValidationError(error)}`);
  }
}

export function approvePlan(session: Session, featureIds?: string[]): TransitionResult<Session> {
  const next = cloneSession(session);
  if (!next.plan) {
    return fail("There is no draft plan to approve.");
  }
  if (next.status !== "planning" || next.execution.activeFeatureId) {
    return fail("The active session is already executing work. Replanning or approval is only allowed while reviewing a draft plan.");
  }

  if (featureIds && featureIds.length > 0) {
    const subset = selectDependencyConsistentFeatureSubset(
      next.plan.features,
      featureIds,
      (featureId) => `Feature '${featureId}' depends on omitted features. Select a dependency-consistent set before approval.`,
    );
    if (!subset.ok) {
      return subset;
    }

    next.plan.features = subset.value.map((feature) => ({ ...feature, status: "pending" }));
  }

  next.approval = "approved";
  next.status = "ready";
  next.timestamps.approvedAt = new Date().toISOString();
  return succeed(next);
}

export function selectPlanFeatures(session: Session, featureIds: string[]): TransitionResult<Session> {
  const next = cloneSession(session);
  if (!next.plan) {
    return fail("There is no draft plan to narrow.");
  }
  if (next.status !== "planning" || next.execution.activeFeatureId) {
    return fail("The active session is already executing work. Narrow the plan only while it is still a draft.");
  }
  if (featureIds.length === 0) {
    return fail("Provide at least one feature id to keep in the draft plan.");
  }

  const subset = selectDependencyConsistentFeatureSubset(
    next.plan.features,
    featureIds,
    (featureId) => `Feature '${featureId}' depends on omitted features. Keep a dependency-consistent set.`,
  );
  if (!subset.ok) {
    return subset;
  }

  next.plan.features = subset.value.map((feature) => ({ ...feature, status: feature.status === "completed" ? "completed" : "pending" }));
  next.approval = "pending";
  next.status = "planning";
  clearExecution(next);
  return succeed(next);
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

  const next = cloneSession(session);
  const plan = next.plan!;
  const targetResult = firstRunnableFeature(plan.features, requestedId);
  if (!targetResult.ok) {
    if (targetResult.reason === "invalid_request") {
      return fail(targetResult.message);
    }

    const blocked = cloneSession(next);
    blocked.status = "blocked";
    blocked.execution.activeFeatureId = null;
    blocked.execution.lastSummary = targetResult.message;
    blocked.execution.lastOutcomeKind = "blocked";
    return succeed({ session: blocked, feature: null, reason: targetResult.message });
  }

  plan.features = plan.features.map((feature) => {
    if (feature.id !== targetResult.value.id) {
      return feature.status === "in_progress" ? { ...feature, status: "pending" } : feature;
    }

    return { ...feature, status: "in_progress" };
  });
  next.status = "running";
  next.execution.activeFeatureId = targetResult.value.id;
  next.execution.lastFeatureId = targetResult.value.id;
  next.execution.lastSummary = `Running feature '${targetResult.value.id}'.`;
  next.execution.lastOutcomeKind = null;
  next.execution.lastReviewerDecision = null;
  return succeed({
    session: next,
    feature: plan.features.find((feature) => feature.id === targetResult.value.id) ?? null,
  });
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
  const wasFinalFeature = completionThresholdReached(
    plan.features.map((feature) => (feature.id === featureId ? { ...feature, status: "completed" } : feature)),
    plan,
  );

  next.artifacts = worker.artifactsChanged;
  next.execution.lastValidationRun = worker.validationRun;
  next.execution.lastFeatureId = featureId;
  next.execution.lastSummary = worker.summary;
  next.execution.lastOutcomeKind = worker.outcome?.kind ?? (worker.status === "ok" ? "completed" : "needs_input");
  next.execution.lastOutcome = worker.outcome ?? null;
  next.execution.lastNextStep = worker.nextStep;
  next.execution.lastFeatureResult = worker.featureResult;
  next.execution.history.push({
    featureId,
    status: worker.status,
    summary: worker.summary,
    recordedAt,
    outcomeKind: worker.outcome?.kind ?? (worker.status === "ok" ? "completed" : null),
    outcome: worker.outcome ?? null,
    nextStep: worker.nextStep,
    validationRun: worker.validationRun,
    artifactsChanged: worker.artifactsChanged,
    decisions: worker.decisions,
    featureResult: worker.featureResult,
    reviewerDecision: next.execution.lastReviewerDecision,
    featureReview: worker.featureReview,
    finalReview: worker.finalReview,
  });
  next.notes = worker.decisions.map((decision) => decision.summary);

  if (worker.status === "ok") {
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
    if (plan.completionPolicy?.requireFinalReview && wasFinalFeature && !isReviewPassing(worker.finalReview)) {
      return fail(
        "Worker result cannot complete the session because a passing finalReview is required.",
        buildCompletionRecovery(featureId, wasFinalFeature, "failing_final_review"),
      );
    }

    plan.features = plan.features.map((feature) =>
      feature.id === featureId ? { ...feature, status: "completed" } : feature,
    );
    next.execution.activeFeatureId = null;

    if (completionThresholdReached(plan.features, plan)) {
      return succeed(markSessionCompleted(next, worker.summary));
    }

    next.status = "ready";
    return succeed(next);
  }

  const outcomeKind = worker.outcome.kind;
  next.execution.activeFeatureId = null;

  if (outcomeKind === "replan_required") {
    next.plan = null;
    next.status = "planning";
    next.approval = "pending";
    next.timestamps.approvedAt = null;
    return succeed(next);
  }

  plan.features = plan.features.map((feature) =>
    feature.id === featureId ? { ...feature, status: "blocked" } : feature,
  );
  next.status = "blocked";
  return succeed(next);
}

export function resetFeature(session: Session, featureId: string): TransitionResult<Session> {
  if (!session.plan) {
    return fail("There is no active plan to reset.");
  }

  const next = cloneSession(session);
  const plan = next.plan!;
  const feature = plan.features.find((item) => item.id === featureId);
  if (!feature) {
    return fail(`Feature '${featureId}' was not found in the active plan.`);
  }

  const affected = collectDependents(plan.features, featureId);
  affected.add(featureId);
  plan.features = plan.features.map((item) => (affected.has(item.id) ? { ...item, status: "pending" } : item));
  next.status = next.approval === "approved" ? "ready" : "planning";
  if (next.execution.activeFeatureId && affected.has(next.execution.activeFeatureId)) {
    next.execution.activeFeatureId = null;
  }
  const shouldClearLastRun = next.execution.lastFeatureId ? affected.has(next.execution.lastFeatureId) : false;
  if (shouldClearLastRun) {
    next.execution.lastFeatureId = null;
    next.execution.lastValidationRun = [];
    next.execution.lastOutcome = null;
    next.execution.lastNextStep = null;
    next.execution.lastFeatureResult = null;
    next.execution.lastReviewerDecision = null;
    next.artifacts = [];
    next.notes = [];
  }
  next.execution.lastSummary =
    affected.size > 1
      ? `Reset feature '${featureId}' and its dependent features to pending.`
      : `Reset feature '${featureId}' to pending.`;
  next.execution.lastOutcomeKind = null;
  next.timestamps.completedAt = null;
  return succeed(next);
}

export function recordReviewerDecision(session: Session, input: unknown): TransitionResult<Session> {
  let decision: Session["execution"]["lastReviewerDecision"];
  try {
    decision = ReviewerDecisionSchema.parse(input);
  } catch (error) {
    return fail(`Reviewer decision validation failed: ${formatValidationError(error)}`);
  }

  const next = cloneSession(session);
  if (decision.scope === "feature") {
    if (!next.execution.activeFeatureId) {
      return fail("There is no active feature to review.");
    }
    if (decision.featureId !== next.execution.activeFeatureId) {
      return fail(`Reviewer decision feature '${decision.featureId}' does not match active feature '${next.execution.activeFeatureId}'.`);
    }
  }

  next.execution.lastReviewerDecision = decision;
  next.execution.lastSummary = decision.summary;
  return succeed(next);
}
