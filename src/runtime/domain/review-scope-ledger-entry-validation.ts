import { REVIEW_SCOPE_ACCOUNTING_STATUSES } from "../constants";
import {
	isSafeReviewArtifactRef,
	normalizeArtifactPath,
	pathForReviewArtifactRef,
} from "./final-review-coverage-paths";
import type { ReviewContextPack } from "./review-content-discovery";
import {
	reviewContextPackPaths,
	reviewScopeTargetGroundsRef,
} from "./review-scope-path-matching";
import {
	isScaffoldResidualRiskPlaceholder,
	type ReviewScopeLedgerEntry,
	type ReviewScopeTarget,
} from "./review-scope-targets";

type LedgerValidationContext = {
	declaredScope: readonly ReviewScopeTarget[];
	ledger: readonly ReviewScopeLedgerEntry[];
	validationCommands?: readonly string[];
	changedArtifacts?: readonly string[];
	reviewContextPack?: ReviewContextPack | undefined;
	closedFindingRefs?: readonly string[];
	requireClosedFindingMatch?: boolean;
	label?: string;
};

const REVIEW_SCOPE_ACCOUNTING_STATUS_SET = new Set<string>(
	REVIEW_SCOPE_ACCOUNTING_STATUSES,
);

function evidenceRefsFor(entry: ReviewScopeLedgerEntry): readonly string[] {
	return entry.evidenceRefs ?? [];
}

function validationRefsFor(entry: ReviewScopeLedgerEntry): readonly string[] {
	return entry.validationRefs ?? [];
}

function findingRefsFor(entry: ReviewScopeLedgerEntry): readonly string[] {
	return entry.findingRefs ?? [];
}

export function validateLedgerEntries({
	declaredScope,
	ledger,
	validationCommands = [],
	changedArtifacts = [],
	reviewContextPack,
	closedFindingRefs = [],
	requireClosedFindingMatch = false,
	label = "reviewScopeLedger",
}: LedgerValidationContext): string | null {
	const declaredById = new Map(declaredScope.map((scope) => [scope.id, scope]));
	const validationCommandSet = new Set(validationCommands);
	const changedArtifactSet = new Set(
		changedArtifacts.map((path) => normalizeArtifactPath(path)),
	);
	const reviewedContextPathSet = new Set(
		reviewContextPackPaths(reviewContextPack).map((path) =>
			normalizeArtifactPath(path),
		),
	);
	const closedFindingSet = new Set(closedFindingRefs);
	const seen = new Set<string>();

	for (const [index, entry] of ledger.entries()) {
		const entryLabel = `${label}[${index}]`;
		const declaredScopeEntry = declaredById.get(entry.scopeId);
		if (!declaredScopeEntry) {
			return `${entryLabel}.scopeId '${entry.scopeId}' is not a declared review scope target.`;
		}
		if (!REVIEW_SCOPE_ACCOUNTING_STATUS_SET.has(entry.status)) {
			return `${entryLabel}.status '${entry.status}' is not a supported review scope accounting status.`;
		}
		if (seen.has(entry.scopeId)) {
			return `${entryLabel}.scopeId '${entry.scopeId}' is duplicated in the same review scope ledger.`;
		}
		seen.add(entry.scopeId);
		let hasConcreteScopeEvidence = false;
		for (const evidenceRef of evidenceRefsFor(entry)) {
			const trimmedEvidenceRef = evidenceRef.trim();
			if (validationCommandSet.has(trimmedEvidenceRef)) {
				if (validationRefsFor(entry).includes(trimmedEvidenceRef)) {
					continue;
				}
				return `${entryLabel}.evidenceRefs includes validation command '${evidenceRef}', which is not tied to this scope entry by validationRefs.`;
			}
			if (!isSafeReviewArtifactRef(trimmedEvidenceRef)) {
				return `${entryLabel}.evidenceRefs includes '${evidenceRef}', which is not a safe relative path reference or recorded validation command.`;
			}
			const evidencePath = pathForReviewArtifactRef(trimmedEvidenceRef);
			if (
				!reviewScopeTargetGroundsRef(
					declaredScopeEntry,
					trimmedEvidenceRef,
					evidencePath,
				) ||
				(!changedArtifactSet.has(evidencePath) &&
					!reviewedContextPathSet.has(evidencePath))
			) {
				return `${entryLabel}.evidenceRefs includes '${evidenceRef}', which is not grounded in this declared scope target, reviewed context, changed artifacts, or validation evidence.`;
			}
			hasConcreteScopeEvidence = true;
		}
		if (evidenceRefsFor(entry).length === 0) {
			return `${entryLabel} must include evidenceRefs.`;
		}
		if (!hasConcreteScopeEvidence) {
			return `${entryLabel}.evidenceRefs must include at least one concrete artifact reference grounded in this declared scope target.`;
		}
		if (!entry.residualRisk?.trim()) {
			return `${entryLabel} must include residualRisk.`;
		}
		if (isScaffoldResidualRiskPlaceholder(entry.residualRisk)) {
			return `${entryLabel}.residualRisk uses scaffold placeholder; replace.`;
		}
		for (const validationRef of validationRefsFor(entry)) {
			if (!validationCommandSet.has(validationRef)) {
				return `${entryLabel}.validationRefs includes '${validationRef}', which was not recorded in validation evidence.`;
			}
		}
		if (entry.status === "finding_closed") {
			const findingRefs = findingRefsFor(entry);
			if (findingRefs.length === 0) {
				return `${entryLabel} uses finding_closed without findingRefs.`;
			}
			if (requireClosedFindingMatch) {
				for (const findingRef of findingRefs) {
					if (!closedFindingSet.has(findingRef)) {
						return `${entryLabel}.findingRefs includes '${findingRef}', which was not closed in reviewFindingClosures.`;
					}
				}
			}
		}
	}

	return null;
}

export function ledgerCoversDeclaredScope(
	declaredScope: readonly ReviewScopeTarget[],
	ledger: readonly ReviewScopeLedgerEntry[],
): boolean {
	const accountedScopeIds = new Set(ledger.map((entry) => entry.scopeId));
	return declaredScope.every((scope) => accountedScopeIds.has(scope.id));
}
