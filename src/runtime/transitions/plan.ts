import { PlanSchema, type PlanningContext, type Plan, type Session } from "../schema";
import { nowIso } from "../time";
import { selectProjectedFeatureSubset } from "./plan-feature-selection";
import { validatePlanGraph } from "./plan-graph-validation";
import { clearExecution, cloneSession, fail, formatValidationError, succeed, type TransitionResult } from "./shared";

type DraftPlanEditMessages = {
  missingPlan: string;
  activeSession: string;
};

type DraftPlanSession = Session & { plan: Plan };

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
