import { PlanSchema, type Feature, type PlanningContext, type Plan, type Session } from "../schema";
import { nowIso } from "../time";
import { clearExecution, cloneSession, fail, formatValidationError, indexFeatures, succeed, type TransitionResult } from "./shared";

type DraftPlanEditMessages = {
  missingPlan: string;
  activeSession: string;
};

type DraftPlanSession = Session & { plan: Plan };

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

function projectSelectedFeatures(features: Feature[], preserveCompleted: boolean): Feature[] {
  return features.map((feature) => ({
    ...feature,
    status: preserveCompleted && feature.status === "completed" ? "completed" : "pending",
  }));
}

function selectProjectedFeatureSubset(
  features: Feature[],
  featureIds: string[],
  dependencyErrorMessage: (featureId: string) => string,
  preserveCompleted: boolean,
): TransitionResult<Feature[]> {
  const subset = selectDependencyConsistentFeatureSubset(features, featureIds, dependencyErrorMessage);
  if (!subset.ok) {
    return subset;
  }

  return succeed(projectSelectedFeatures(subset.value, preserveCompleted));
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
    const feature = byId.get(featureId);
    if (!feature) {
      visitState.set(featureId, "visited");
      return false;
    }
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

function prepareDraftPlanEdit(
  session: Session,
  messages: DraftPlanEditMessages,
): TransitionResult<DraftPlanSession> {
  const next = cloneSession(session);
  const { plan } = next;
  if (!plan) {
    return fail(messages.missingPlan);
  }
  if (next.status !== "planning" || next.execution.activeFeatureId) {
    return fail(messages.activeSession);
  }

  return succeed({
    ...next,
    plan,
  });
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
  const editable = prepareDraftPlanEdit(session, {
    missingPlan: "There is no draft plan to approve.",
    activeSession: "The active session is already executing work. Replanning or approval is only allowed while reviewing a draft plan.",
  });
  if (!editable.ok) {
    return editable;
  }

  const next = editable.value;

  if (featureIds && featureIds.length > 0) {
    const subset = selectProjectedFeatureSubset(
      next.plan.features,
      featureIds,
      (featureId) => `Feature '${featureId}' depends on omitted features. Select a dependency-consistent set before approval.`,
      false,
    );
    if (!subset.ok) {
      return subset;
    }

    next.plan.features = subset.value;
  }

  next.approval = "approved";
  next.status = "ready";
  next.timestamps.approvedAt = nowIso();
  return succeed(next);
}

export function selectPlanFeatures(session: Session, featureIds: string[]): TransitionResult<Session> {
  const editable = prepareDraftPlanEdit(session, {
    missingPlan: "There is no draft plan to narrow.",
    activeSession: "The active session is already executing work. Narrow the plan only while it is still a draft.",
  });
  if (!editable.ok) {
    return editable;
  }
  if (featureIds.length === 0) {
    return fail("Provide at least one feature id to keep in the draft plan.");
  }

  const next = editable.value;
  const subset = selectProjectedFeatureSubset(
    next.plan.features,
    featureIds,
    (featureId) => `Feature '${featureId}' depends on omitted features. Keep a dependency-consistent set.`,
    true,
  );
  if (!subset.ok) {
    return subset;
  }

  next.plan.features = subset.value;
  next.approval = "pending";
  next.status = "planning";
  clearExecution(next);
  return succeed(next);
}
