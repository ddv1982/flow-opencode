import { ZodError } from "zod";
import {
  PlanSchema,
  WorkerResultSchema,
  type Feature,
  type PlanningContext,
  type Plan,
  type Session,
  type WorkerResult,
} from "./schema";

export type TransitionResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function fail<T>(message: string): TransitionResult<T> {
  return { ok: false, message };
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

function clearExecution(session: Session): void {
  session.execution.activeFeatureId = null;
  session.execution.lastFeatureId = null;
  session.execution.lastSummary = null;
  session.execution.lastOutcomeKind = null;
  session.execution.lastOutcome = null;
  session.execution.lastNextStep = null;
  session.execution.lastFeatureResult = null;
  session.execution.lastValidationRun = [];
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

function completionThresholdReached(features: Feature[], plan: Plan): boolean {
  const completedCount = features.filter((feature) => feature.status === "completed").length;
  const minimum = plan.completionPolicy?.minCompletedFeatures;

  if (minimum !== undefined) {
    return completedCount >= minimum;
  }

  return completedCount === features.length;
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
    const unknownIdsError = ensureRequestedFeatureIdsExist(next.plan.features, featureIds);
    if (unknownIdsError) {
      return fail(unknownIdsError);
    }

    const selectedIds = new Set(featureIds);
    const filtered = next.plan.features.filter((feature) => selectedIds.has(feature.id));

    if (filtered.length === 0) {
      return fail("None of the requested feature ids matched the draft plan.");
    }

    const filteredIds = new Set(filtered.map((feature) => feature.id));
    for (const feature of filtered) {
      const unresolvedDependsOn = (feature.dependsOn ?? []).filter((id) => !filteredIds.has(id));
      const unresolvedBlockedBy = (feature.blockedBy ?? []).filter((id) => !filteredIds.has(id));
      if (unresolvedDependsOn.length > 0 || unresolvedBlockedBy.length > 0) {
        return fail(`Feature '${feature.id}' depends on omitted features. Select a dependency-consistent set before approval.`);
      }
    }

    next.plan.features = filtered.map((feature) => ({ ...feature, status: "pending" }));
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

  const unknownIdsError = ensureRequestedFeatureIdsExist(next.plan.features, featureIds);
  if (unknownIdsError) {
    return fail(unknownIdsError);
  }

  const selected = new Set(featureIds);
  const filtered = next.plan.features.filter((feature) => selected.has(feature.id));
  if (filtered.length === 0) {
    return fail("None of the requested feature ids matched the draft plan.");
  }

  const filteredIds = new Set(filtered.map((feature) => feature.id));
  for (const feature of filtered) {
    const unresolvedDependsOn = (feature.dependsOn ?? []).filter((id) => !filteredIds.has(id));
    const unresolvedBlockedBy = (feature.blockedBy ?? []).filter((id) => !filteredIds.has(id));
    if (unresolvedDependsOn.length > 0 || unresolvedBlockedBy.length > 0) {
      return fail(`Feature '${feature.id}' depends on omitted features. Keep a dependency-consistent set.`);
    }
  }

  next.plan.features = filtered.map((feature) => ({ ...feature, status: feature.status === "completed" ? "completed" : "pending" }));
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
    featureReview: worker.featureReview,
    finalReview: worker.finalReview,
  });
  next.notes = worker.decisions.map((decision) => decision.summary);

  if (worker.status === "ok") {
    if (!isReviewPassing(worker.featureReview)) {
      return fail("Worker result cannot complete the feature because featureReview is not passing.");
    }
    if (worker.finalReview && !isReviewPassing(worker.finalReview)) {
      return fail("Worker result cannot complete the feature because finalReview is not passing.");
    }
    if (plan.completionPolicy?.requireFinalReview && wasFinalFeature && !isReviewPassing(worker.finalReview)) {
      return fail("Worker result cannot complete the session because a passing finalReview is required.");
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
