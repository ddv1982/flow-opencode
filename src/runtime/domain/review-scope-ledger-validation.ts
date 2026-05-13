import type { ReviewerDecision, Session } from "../schema";
import {
	closedFindingRefsFor,
	closedReviewFindingRefsForCompletion,
	completionAccountingMap,
} from "./review-scope-completion-accounting";
import type { ReviewScopeWorkerEvidence } from "./review-scope-evidence";
import { validateLedgerEntries } from "./review-scope-ledger-entry-validation";
import {
	reviewContextPackPaths,
	reviewScopeTargetGroundsRef,
} from "./review-scope-path-matching";
import {
	declaredReviewScopeForCompletion,
	declaredReviewScopeForPlan,
	isReviewScopeAccountingRequired,
} from "./review-scope-targets";

export {
	closedReviewFindingRefsForCompletion,
	reviewContextPackPaths,
	reviewScopeTargetGroundsRef,
};

export function describeReviewScopeLedgerFailure(
	session: Session,
	worker: ReviewScopeWorkerEvidence,
	featureId: string,
	wasFinalFeature: boolean,
): string | null {
	if (!isReviewScopeAccountingRequired(session.plan)) {
		return null;
	}

	const declaredScope = declaredReviewScopeForCompletion(
		session,
		featureId,
		wasFinalFeature,
	);
	if (declaredScope.length === 0) {
		return "review scope accounting is required, but the active plan has no declared review scope targets.";
	}

	const currentLedger = worker.reviewScopeLedger ?? [];
	const currentFailure = validateLedgerEntries({
		declaredScope,
		ledger: currentLedger,
		validationCommands: (worker.validationRun ?? []).map(
			(item) => item.command,
		),
		changedArtifacts: [
			...(worker.artifactsChanged ?? []).map((artifact) => artifact.path),
			...(worker.finalReview?.evidenceRefs?.changedArtifacts ?? []),
		],
		reviewContextPack: worker.finalReview?.reviewContextPack,
		closedFindingRefs: wasFinalFeature
			? closedReviewFindingRefsForCompletion(session, worker)
			: closedFindingRefsFor(worker),
		requireClosedFindingMatch: session.plan?.goalMode === "review_and_fix",
	});
	if (currentFailure) {
		return currentFailure;
	}

	const accounted = wasFinalFeature
		? completionAccountingMap(session, currentLedger)
		: new Map(currentLedger.map((entry) => [entry.scopeId, entry]));
	const missing = declaredScope.filter((scope) => !accounted.has(scope.id));
	if (missing.length > 0) {
		return `reviewScopeLedger is missing accounting for declared review scope: ${missing
			.map((scope) => scope.id)
			.join(", ")}.`;
	}

	return null;
}

export function describeFinalReviewerReviewScopeFailure(
	session: Session,
	decision: Pick<
		Extract<ReviewerDecision, { scope: "final" }>,
		"reviewScopeLedger" | "evidenceRefs" | "reviewContextPack" | "status"
	>,
	options?: {
		closedFindingRefs?: readonly string[];
		requireClosedFindingMatch?: boolean;
	},
): string | null {
	if (
		!isReviewScopeAccountingRequired(session.plan) ||
		decision.status !== "approved"
	) {
		return null;
	}

	const declaredScope = declaredReviewScopeForPlan(session.plan);
	if (declaredScope.length === 0) {
		return "review scope accounting is required, but the active plan has no declared review scope targets.";
	}
	const ledger = decision.reviewScopeLedger ?? [];
	if (ledger.length === 0) {
		return "approved final reviewer decisions for review/review_and_fix sessions must include reviewScopeLedger accounting.";
	}

	const structuralFailure = validateLedgerEntries({
		declaredScope,
		ledger,
		validationCommands: decision.evidenceRefs.validationCommands,
		changedArtifacts: decision.evidenceRefs.changedArtifacts,
		reviewContextPack: decision.reviewContextPack,
		closedFindingRefs: options?.closedFindingRefs ?? [],
		requireClosedFindingMatch: options?.requireClosedFindingMatch ?? false,
		label: "finalReviewerDecision.reviewScopeLedger",
	});
	if (structuralFailure) {
		return structuralFailure;
	}

	const accounted = new Set(ledger.map((entry) => entry.scopeId));
	const missing = declaredScope.filter((scope) => !accounted.has(scope.id));
	if (missing.length > 0) {
		return `final reviewer reviewScopeLedger is missing accounting for declared review scope: ${missing
			.map((scope) => scope.id)
			.join(", ")}.`;
	}

	return null;
}
