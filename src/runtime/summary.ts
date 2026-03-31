import type { Feature, Session } from "./schema";

function summarizeFeature(feature: Feature): string {
  return `${feature.id} (${feature.status}): ${feature.title}`;
}

export function summarizeSession(session: Session | null) {
  if (!session) {
    return {
      status: "missing",
      summary: "No active Flow session found.",
    };
  }

  const features = session.plan?.features ?? [];
  const completedCount = features.filter((feature) => feature.status === "completed").length;
  const activeFeature = features.find((feature) => feature.id === session.execution.activeFeatureId) ?? null;

  return {
    status: session.status,
    summary: session.execution.lastSummary ?? session.plan?.summary ?? "Flow session is initialized.",
    session: {
      id: session.id,
      goal: session.goal,
      approval: session.approval,
      status: session.status,
      planSummary: session.plan?.summary ?? null,
      planOverview: session.plan?.overview ?? null,
      activeFeature,
      featureProgress: {
        completed: completedCount,
        total: features.length,
      },
      features: features.map((feature) => ({
        id: feature.id,
        title: feature.title,
        status: feature.status,
        summary: feature.summary,
      })),
      notes: session.notes,
      artifacts: session.artifacts,
      planning: session.planning,
      lastOutcome: session.execution.lastOutcome,
      lastNextStep: session.execution.lastNextStep,
      lastFeatureResult: session.execution.lastFeatureResult,
      lastReviewerDecision: session.execution.lastReviewerDecision,
      lastValidationRun: session.execution.lastValidationRun,
      lastOutcomeKind: session.execution.lastOutcomeKind,
      nextCommand: deriveNextCommand(session),
      featureLines: features.map(summarizeFeature),
    },
  };
}

export function deriveNextCommand(session: Session): string {
  if (!session.plan) {
    return "/flow-plan <goal>";
  }
  if (session.status === "planning") {
    return "/flow-plan";
  }
  if (session.status === "ready" || session.status === "running") {
    return "/flow-run";
  }
  if (session.status === "blocked") {
    const lastFeatureId = session.execution.lastFeatureId;
    const outcome = session.execution.lastOutcome;

    if (
      lastFeatureId &&
      !outcome?.needsHuman &&
      (outcome?.retryable || outcome?.autoResolvable || outcome?.kind === "contract_error")
    ) {
      return `/flow-reset feature ${lastFeatureId}`;
    }
  }
  if (session.status === "completed") {
    return "/flow-plan <goal>";
  }

  return "/flow-status";
}
