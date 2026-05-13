import type { Session } from "../schema";
import type { ReviewScopeWorkerEvidence } from "./review-scope-evidence";
import {
	ledgerCoversDeclaredScope,
	validateLedgerEntries,
} from "./review-scope-ledger-entry-validation";
import {
	declaredReviewScopeForFeature,
	type ReviewScopeLedgerEntry,
} from "./review-scope-targets";

export function closedFindingRefsFor(
	worker: ReviewScopeWorkerEvidence,
): string[] {
	return (worker.reviewFindingClosures ?? [])
		.filter((closure) => closure.status === "closed")
		.map((closure) => closure.findingRef);
}

export function latestValidCompletedHistoryEntries(
	session: Session,
): Session["execution"]["history"] {
	const completedFeatureIds = new Set(
		(session.plan?.features ?? [])
			.filter((feature) => feature.status === "completed")
			.map((feature) => feature.id),
	);
	const latestValidByFeature = new Map<
		string,
		Session["execution"]["history"][number]
	>();
	for (const historyEntry of session.execution.history) {
		if (!completedFeatureIds.has(historyEntry.featureId)) {
			continue;
		}
		const feature = session.plan?.features.find(
			(item) => item.id === historyEntry.featureId,
		);
		if (!feature) {
			continue;
		}
		const featureScope = declaredReviewScopeForFeature(feature);
		const historicalLedger = historyEntry.reviewScopeLedger ?? [];
		const structuralFailure = validateLedgerEntries({
			declaredScope: featureScope,
			ledger: historicalLedger,
			validationCommands: historyEntry.validationRun.map(
				(item) => item.command,
			),
			changedArtifacts: historyEntry.artifactsChanged.map(
				(artifact) => artifact.path,
			),
			reviewContextPack: historyEntry.finalReview?.reviewContextPack,
			closedFindingRefs: closedFindingRefsFor(historyEntry),
			requireClosedFindingMatch: session.plan?.goalMode === "review_and_fix",
			label: `history[${historyEntry.featureId}].reviewScopeLedger`,
		});
		if (
			!structuralFailure &&
			ledgerCoversDeclaredScope(featureScope, historicalLedger)
		) {
			latestValidByFeature.set(historyEntry.featureId, historyEntry);
		}
	}
	return [...latestValidByFeature.values()];
}

export function completionAccountingMap(
	session: Session,
	currentLedger: readonly ReviewScopeLedgerEntry[],
): Map<string, ReviewScopeLedgerEntry> {
	const accounted = new Map<string, ReviewScopeLedgerEntry>();

	for (const historyEntry of latestValidCompletedHistoryEntries(session)) {
		const feature = session.plan?.features.find(
			(item) => item.id === historyEntry.featureId,
		);
		if (!feature) {
			continue;
		}
		const featureScopeIds = new Set(
			declaredReviewScopeForFeature(feature).map((scope) => scope.id),
		);
		for (const ledgerEntry of historyEntry.reviewScopeLedger ?? []) {
			if (featureScopeIds.has(ledgerEntry.scopeId)) {
				accounted.set(ledgerEntry.scopeId, ledgerEntry);
			}
		}
	}
	for (const ledgerEntry of currentLedger) {
		accounted.set(ledgerEntry.scopeId, ledgerEntry);
	}
	return accounted;
}

export function closedReviewFindingRefsForCompletion(
	session: Session,
	currentWorker: ReviewScopeWorkerEvidence,
): string[] {
	const refs = new Set<string>();
	for (const historyEntry of latestValidCompletedHistoryEntries(session)) {
		for (const findingRef of closedFindingRefsFor(historyEntry)) {
			refs.add(findingRef);
		}
	}
	for (const findingRef of closedFindingRefsFor(currentWorker)) {
		refs.add(findingRef);
	}
	return [...refs];
}
