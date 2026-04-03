type AdaptedReview = {
  status: unknown;
  summary: unknown;
  blockingFindings: unknown[];
};

type AdaptedFeatureResult = {
  featureId: unknown;
  verificationStatus: unknown;
  notes: unknown[];
  followUps: unknown[];
};

type AdaptedReviewerDecision = {
  scope: unknown;
  featureId?: unknown;
  status: unknown;
  summary: unknown;
  blockingFindings: unknown[];
  followUps: unknown[];
  suggestedValidation: unknown[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function adaptReview(value: unknown): AdaptedReview | unknown {
  const review = asRecord(value);
  if (!review) {
    return value;
  }

  return {
    status: review.status,
    summary: review.summary,
    blockingFindings: asArray(review.blockingFindings),
  };
}

function adaptFeatureResult(value: unknown): AdaptedFeatureResult | unknown {
  const featureResult = asRecord(value);
  if (!featureResult) {
    return value;
  }

  return {
    featureId: featureResult.featureId,
    verificationStatus: featureResult.verificationStatus,
    notes: asArray(featureResult.notes),
    followUps: asArray(featureResult.followUps),
  };
}

export function adaptReviewerDecisionInput(input: unknown): AdaptedReviewerDecision | unknown {
  const decision = asRecord(input);
  if (!decision) {
    return input;
  }

  return {
    scope: decision.scope,
    ...(decision.featureId !== undefined ? { featureId: decision.featureId } : {}),
    status: decision.status,
    summary: decision.summary,
    blockingFindings: asArray(decision.blockingFindings),
    followUps: asArray(decision.followUps),
    suggestedValidation: asArray(decision.suggestedValidation),
  };
}

export function adaptFlowRunCompleteFeatureInput(input: unknown): unknown {
  const record = asRecord(input);
  if (!record) {
    return input;
  }

  const outcome = asRecord(record.outcome);

  return {
    contractVersion: record.contractVersion,
    status: record.status,
    summary: record.summary,
    artifactsChanged: asArray(record.artifactsChanged),
    validationRun: asArray(record.validationRun),
    validationScope: record.validationScope,
    reviewIterations: record.reviewIterations,
    decisions: asArray(record.decisions),
    nextStep: record.nextStep,
    ...(outcome ? { outcome: { ...outcome } } : {}),
    featureResult: adaptFeatureResult(record.featureResult),
    featureReview: adaptReview(record.featureReview),
    ...(record.finalReview !== undefined ? { finalReview: adaptReview(record.finalReview) } : {}),
  };
}
