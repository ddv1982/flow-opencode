import { buildReviewContextPack, type ReviewContextPack } from "../domain";
import type { Session, WorkerResultArgs } from "../schema";

export type NormalizedReview = Omit<
	NonNullable<WorkerResultArgs["featureReview"]>,
	"blockingFindings"
> & {
	blockingFindings: NonNullable<
		NonNullable<WorkerResultArgs["featureReview"]>["blockingFindings"]
	>;
};

export type NormalizedFinalReview = Omit<
	NonNullable<WorkerResultArgs["finalReview"]>,
	| "blockingFindings"
	| "reviewedSurfaces"
	| "evidenceRefs"
	| "integrationChecks"
	| "regressionChecks"
	| "remainingGaps"
	| "reviewContextPack"
> & {
	blockingFindings: NonNullable<
		NonNullable<WorkerResultArgs["finalReview"]>["blockingFindings"]
	>;
	reviewedSurfaces: NonNullable<
		NonNullable<WorkerResultArgs["finalReview"]>["reviewedSurfaces"]
	>;
	evidenceRefs: {
		changedArtifacts: string[];
		validationCommands: string[];
	};
	integrationChecks: NonNullable<
		NonNullable<WorkerResultArgs["finalReview"]>["integrationChecks"]
	>;
	regressionChecks: NonNullable<
		NonNullable<WorkerResultArgs["finalReview"]>["regressionChecks"]
	>;
	remainingGaps: NonNullable<
		NonNullable<WorkerResultArgs["finalReview"]>["remainingGaps"]
	>;
	reviewContextPack: ReviewContextPack | undefined;
};

export type NormalizedReviewFindingClosure = Omit<
	NonNullable<WorkerResultArgs["reviewFindingClosures"]>[number],
	"fixRefs" | "testRefs" | "validationRefs"
> & {
	fixRefs: string[];
	testRefs: string[];
	validationRefs: string[];
};

export type NormalizedWorkerResultBase = Omit<
	WorkerResultArgs,
	| "artifactsChanged"
	| "validationRun"
	| "decisions"
	| "reviewFindingClosures"
	| "featureReview"
	| "finalReview"
> & {
	artifactsChanged: NonNullable<WorkerResultArgs["artifactsChanged"]>;
	validationRun: NonNullable<WorkerResultArgs["validationRun"]>;
	decisions: NonNullable<WorkerResultArgs["decisions"]>;
	reviewFindingClosures: NormalizedReviewFindingClosure[];
	featureReview: NormalizedReview;
	finalReview: NormalizedFinalReview | undefined;
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

function normalizeFinalReview(
	review: NonNullable<WorkerResultArgs["finalReview"]>,
): NormalizedFinalReview {
	return {
		...review,
		blockingFindings: review.blockingFindings ?? [],
		reviewedSurfaces: review.reviewedSurfaces ?? [],
		evidenceRefs: {
			changedArtifacts: review.evidenceRefs?.changedArtifacts ?? [],
			validationCommands: review.evidenceRefs?.validationCommands ?? [],
		},
		integrationChecks: review.integrationChecks ?? [],
		regressionChecks: review.regressionChecks ?? [],
		remainingGaps: review.remainingGaps ?? [],
		reviewContextPack: review.reviewContextPack
			? buildReviewContextPack(review.reviewContextPack)
			: undefined,
	};
}

function normalizeReviewFindingClosures(
	closures: NonNullable<WorkerResultArgs["reviewFindingClosures"]> | undefined,
): NormalizedReviewFindingClosure[] {
	return (closures ?? []).map((closure) => ({
		...closure,
		fixRefs: closure.fixRefs ?? [],
		testRefs: closure.testRefs ?? [],
		validationRefs: closure.validationRefs ?? [],
	}));
}

export function normalizeWorkerResult(
	worker: WorkerResultArgs,
): NormalizedWorkerResult {
	return {
		...worker,
		artifactsChanged: worker.artifactsChanged ?? [],
		validationRun: worker.validationRun ?? [],
		decisions: worker.decisions ?? [],
		reviewFindingClosures: normalizeReviewFindingClosures(
			worker.reviewFindingClosures,
		),
		featureReview: normalizeReview(worker.featureReview),
		finalReview: worker.finalReview
			? normalizeFinalReview(worker.finalReview)
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
					reviewFindingClosures: worker.reviewFindingClosures,
					featureResult: worker.featureResult,
					replanRecord: replanRecord ?? undefined,
					reviewerDecision: session.execution.lastReviewerDecision,
					evidencePackets: worker.evidencePackets,
					featureReview: worker.featureReview,
					finalReview: worker.finalReview,
				},
			],
		},
	};
}
