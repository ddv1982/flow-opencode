import type { Session, WorkerResult } from "../schema";

type WorkerOutcomeKind = NonNullable<WorkerResult["outcome"]>["kind"];

export function inferWorkerOutcomeKind(worker: WorkerResult): WorkerOutcomeKind | "completed" | "needs_input" {
  return worker.outcome?.kind ?? (worker.status === "ok" ? "completed" : "needs_input");
}

export function recordWorkerResult(session: Session, featureId: string, worker: WorkerResult, recordedAt: string): void {
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
