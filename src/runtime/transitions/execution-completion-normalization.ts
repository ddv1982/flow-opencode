import type { Session, WorkerResultArgs } from "../schema";

export type NormalizedReview = Omit<
	NonNullable<WorkerResultArgs["featureReview"]>,
	"blockingFindings"
> & {
	blockingFindings: NonNullable<
		NonNullable<WorkerResultArgs["featureReview"]>["blockingFindings"]
	>;
};

export type NormalizedWorkerResultBase = Omit<
	WorkerResultArgs,
	| "artifactsChanged"
	| "validationRun"
	| "decisions"
	| "featureReview"
	| "finalReview"
> & {
	artifactsChanged: NonNullable<WorkerResultArgs["artifactsChanged"]>;
	validationRun: NonNullable<WorkerResultArgs["validationRun"]>;
	decisions: NonNullable<WorkerResultArgs["decisions"]>;
	featureReview: NormalizedReview;
	finalReview: NormalizedReview | undefined;
};

export type NormalizedWorkerResultOk = NormalizedWorkerResultBase & {
	status: "ok";
};

export type NormalizedWorkerResultNeedsInput = NormalizedWorkerResultBase & {
	status: "needs_input";
	outcome: NonNullable<
		Extract<WorkerResultArgs, { status: "needs_input" }>["outcome"]
	>;
};

export type NormalizedWorkerResult =
	| NormalizedWorkerResultOk
	| NormalizedWorkerResultNeedsInput;

export type WorkerOutcomeKind = NonNullable<
	WorkerResultArgs["outcome"]
>["kind"];

function normalizeReview(
	review: NonNullable<WorkerResultArgs["featureReview"]>,
): NormalizedReview {
	return {
		...review,
		blockingFindings: review.blockingFindings ?? [],
	};
}

export function normalizeWorkerResult(
	worker: WorkerResultArgs,
): NormalizedWorkerResult {
	return {
		...worker,
		artifactsChanged: worker.artifactsChanged ?? [],
		validationRun: worker.validationRun ?? [],
		decisions: worker.decisions ?? [],
		featureReview: normalizeReview(worker.featureReview),
		finalReview: worker.finalReview
			? normalizeReview(worker.finalReview)
			: undefined,
	};
}

export function inferWorkerOutcomeKind(
	worker: NormalizedWorkerResult,
): WorkerOutcomeKind | "completed" | "needs_input" {
	return (
		worker.outcome?.kind ??
		(worker.status === "ok" ? "completed" : "needs_input")
	);
}

export function buildReplanRecord(
	featureId: string,
	worker: NormalizedWorkerResult,
	recordedAt: string,
) {
	if (worker.outcome?.kind !== "replan_required") {
		return null;
	}
	if (
		!worker.outcome.replanReason ||
		!worker.outcome.failedAssumption ||
		!worker.outcome.recommendedAdjustment
	) {
		return null;
	}

	return {
		featureId,
		reason: worker.outcome.replanReason,
		summary: worker.outcome.summary ?? worker.summary,
		failedAssumption: worker.outcome.failedAssumption,
		recommendedAdjustment: worker.outcome.recommendedAdjustment,
		recordedAt,
	};
}

export function recordWorkerResult(
	session: Session,
	featureId: string,
	worker: NormalizedWorkerResult,
	recordedAt: string,
): Session {
	const outcomeKind = inferWorkerOutcomeKind(worker);
	const replanRecord = buildReplanRecord(featureId, worker, recordedAt);

	return {
		...session,
		artifacts: worker.artifactsChanged,
		notes: worker.decisions.map((decision) => decision.summary),
		execution: {
			...session.execution,
			lastValidationRun: worker.validationRun,
			lastFeatureId: featureId,
			lastSummary: worker.summary,
			lastOutcomeKind: outcomeKind,
			lastOutcome: worker.outcome ?? null,
			lastNextStep: worker.nextStep,
			lastFeatureResult: worker.featureResult,
			history: [
				...session.execution.history,
				{
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
					replanRecord: replanRecord ?? undefined,
					reviewerDecision: session.execution.lastReviewerDecision,
					featureReview: worker.featureReview,
					finalReview: worker.finalReview,
				},
			],
		},
	};
}
