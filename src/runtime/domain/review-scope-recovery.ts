import type { Session } from "../schema";
import {
	isSafeReviewArtifactRef,
	normalizeArtifactPath,
	pathForReviewArtifactRef,
} from "./final-review-coverage-paths";
import type { ReviewContextPack } from "./review-content-discovery";
import type { ReviewScopeWorkerEvidence } from "./review-scope-evidence";
import {
	closedReviewFindingRefsForCompletion,
	reviewContextPackPaths,
	reviewScopeTargetGroundsRef,
} from "./review-scope-ledger-validation";
import {
	declaredReviewScopeForCompletion,
	declaredReviewScopeForPlan,
	REVIEW_SCOPE_LEDGER_SCAFFOLD_PURPOSE,
	REVIEW_SCOPE_LEDGER_SCAFFOLD_RESIDUAL_RISK,
	type ReviewScopeLedgerEntry,
	type ReviewScopeTarget,
} from "./review-scope-targets";

type ReviewScopeRecoveryDecisionEvidence = {
	evidenceRefs?:
		| {
				changedArtifacts?: readonly string[] | undefined;
				validationCommands?: readonly string[] | undefined;
		  }
		| undefined;
	reviewScopeLedger?: readonly ReviewScopeLedgerEntry[] | undefined;
	reviewContextPack?: ReviewContextPack | undefined;
};

export type ReviewScopeRecoveryDetails = {
	declaredScopes: Array<{
		scopeId: string;
		kind: ReviewScopeTarget["kind"];
		target: string;
		description?: string;
	}>;
	evidenceCandidates: {
		changedArtifacts: string[];
		reviewedContext: string[];
		validationCommands: string[];
		closedFindingRefs: string[];
	};
	repairSteps: string[];
	retryPolicy: {
		doNotReplayScaffold: true;
		mustChangeEvidenceRefs: boolean;
	};
	invalidLedgerGuidance?: Array<{
		scopeId: string;
		problem: "missing_scope_evidence" | "candidate_scope_evidence_available";
		guidance: string;
		requiredEvidenceSource: "changedArtifacts_or_reviewContextPack";
		suggestedEvidenceRefs: string[];
	}>;
	exampleReviewScopeLedgerPurpose: typeof REVIEW_SCOPE_LEDGER_SCAFFOLD_PURPOSE;
	exampleReviewScopeLedger: ReviewScopeLedgerEntry[];
	notes: string[];
};

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function evidenceRefsFor(entry: ReviewScopeLedgerEntry): readonly string[] {
	return entry.evidenceRefs ?? [];
}

function closedFindingRefsFor(worker: ReviewScopeWorkerEvidence): string[] {
	return (worker.reviewFindingClosures ?? [])
		.filter((closure) => closure.status === "closed")
		.map((closure) => closure.findingRef);
}

function evidenceRefsForScope(
	scope: ReviewScopeTarget,
	artifactCandidates: readonly string[],
): string[] {
	const matchingArtifacts = artifactCandidates.filter((candidate) => {
		if (!isSafeReviewArtifactRef(candidate)) {
			return false;
		}
		return reviewScopeTargetGroundsRef(
			scope,
			candidate,
			pathForReviewArtifactRef(candidate),
		);
	});
	return uniqueStrings(matchingArtifacts);
}

function scopeRecoveryEntryFor(
	scope: ReviewScopeTarget,
	artifactCandidates: readonly string[],
	validationCommands: readonly string[],
): ReviewScopeLedgerEntry {
	const evidenceRefs = evidenceRefsForScope(scope, artifactCandidates);
	return {
		scopeId: scope.id,
		status: "reviewed_no_findings",
		evidenceRefs,
		...(validationCommands.length > 0
			? { validationRefs: uniqueStrings(validationCommands) }
			: {}),
		residualRisk: REVIEW_SCOPE_LEDGER_SCAFFOLD_RESIDUAL_RISK,
	};
}

function buildReviewScopeRecoveryDetailsForDeclaredScope({
	declaredScope,
	changedArtifacts,
	reviewedContext,
	validationCommands,
	closedFindingRefs,
}: {
	declaredScope: readonly ReviewScopeTarget[];
	changedArtifacts: readonly string[];
	reviewedContext: readonly string[];
	validationCommands: readonly string[];
	closedFindingRefs: readonly string[];
}): ReviewScopeRecoveryDetails {
	const normalizedChangedArtifacts = uniqueStrings(
		changedArtifacts.map(normalizeArtifactPath),
	);
	const normalizedReviewedContext = uniqueStrings(
		reviewedContext.map(normalizeArtifactPath),
	);
	const normalizedValidationCommands = uniqueStrings(validationCommands);
	const normalizedClosedFindingRefs = uniqueStrings(closedFindingRefs);
	const artifactCandidates = uniqueStrings([
		...normalizedChangedArtifacts,
		...normalizedReviewedContext,
	]);
	const exampleReviewScopeLedger = declaredScope.map((scope) =>
		scopeRecoveryEntryFor(
			scope,
			artifactCandidates,
			normalizedValidationCommands,
		),
	);
	const invalidLedgerGuidance = declaredScope.map((scope) => {
		const suggestedEvidenceRefs = evidenceRefsForScope(
			scope,
			artifactCandidates,
		);
		const hasScopeEvidence = suggestedEvidenceRefs.length > 0;
		return {
			scopeId: scope.id,
			problem: hasScopeEvidence
				? ("candidate_scope_evidence_available" as const)
				: ("missing_scope_evidence" as const),
			guidance: hasScopeEvidence
				? `Use evidenceRefs for '${scope.id}' only after reviewing artifacts that ground '${scope.target}'; replace scaffold residualRisk with the actual residual risk for that scope.`
				: `No changed artifact or reviewContextPack path currently grounds '${scope.target}'. Add a matching changed artifact or reviewContextPack entry, then cite that concrete ref in reviewScopeLedger before retry.`,
			requiredEvidenceSource: "changedArtifacts_or_reviewContextPack" as const,
			suggestedEvidenceRefs,
		};
	});
	const scopesWithoutArtifactEvidence = invalidLedgerGuidance
		.filter((entry) => entry.problem === "missing_scope_evidence")
		.map((entry) => entry.scopeId);
	const mustChangeEvidenceRefs = exampleReviewScopeLedger.some(
		(entry) => evidenceRefsFor(entry).length === 0,
	);
	return {
		declaredScopes: declaredScope.map((scope) => ({
			scopeId: scope.id,
			kind: scope.kind,
			target: scope.target,
			...(scope.description ? { description: scope.description } : {}),
		})),
		evidenceCandidates: {
			changedArtifacts: normalizedChangedArtifacts,
			reviewedContext: normalizedReviewedContext,
			validationCommands: normalizedValidationCommands,
			closedFindingRefs: normalizedClosedFindingRefs,
		},
		repairSteps: [
			"Rebuild reviewScopeLedger; do not resubmit exampleReviewScopeLedger unchanged.",
			"For every declaredScopes entry, include one ledger entry with the same scopeId.",
			"Set evidenceRefs to safe relative artifact paths that are grounded in changedArtifacts or reviewContextPack for that exact scope; validation commands alone are not concrete scope evidence.",
			"Use validationRefs only for commands that were recorded in validation evidence and that support the scoped review.",
			"Replace scaffold residualRisk with a truthful residual-risk statement for the reviewed scope before retrying completion or final-review approval.",
		],
		retryPolicy: {
			doNotReplayScaffold: true,
			mustChangeEvidenceRefs,
		},
		...(invalidLedgerGuidance.length > 0 ? { invalidLedgerGuidance } : {}),
		exampleReviewScopeLedgerPurpose: REVIEW_SCOPE_LEDGER_SCAFFOLD_PURPOSE,
		exampleReviewScopeLedger,
		notes: [
			"exampleReviewScopeLedger is scaffold-only; do not replay unchanged.",
			mustChangeEvidenceRefs
				? "Evidence refs must come from changed artifacts or review context that ground the declared scope; at least one declared scope has no generated evidenceRefs, so add grounded evidence before retry."
				: "Generated evidenceRefs are grounded candidates; reuse them only after actual review and replace scaffold residualRisk with a truthful scope-specific statement.",
			...(normalizedClosedFindingRefs.length > 0
				? [
						"Closed finding refs are candidates only; add findingRefs only when mapped to that scope.",
					]
				: []),
			...(scopesWithoutArtifactEvidence.length > 0
				? [
						`No concrete artifact candidate for: ${scopesWithoutArtifactEvidence.join(", ")}. Add matching changed artifact or reviewContextPack entry before retry.`,
					]
				: []),
		],
	};
}

export function buildReviewScopeRecoveryDetails(
	session: Session,
	worker: ReviewScopeWorkerEvidence,
	featureId: string,
	wasFinalFeature: boolean,
): ReviewScopeRecoveryDetails {
	const declaredScope = declaredReviewScopeForCompletion(
		session,
		featureId,
		wasFinalFeature,
	);
	return buildReviewScopeRecoveryDetailsForDeclaredScope({
		declaredScope,
		changedArtifacts: [
			...(worker.artifactsChanged ?? []).map((artifact) => artifact.path),
			...(worker.finalReview?.evidenceRefs?.changedArtifacts ?? []),
		],
		reviewedContext: reviewContextPackPaths(
			worker.finalReview?.reviewContextPack,
		),
		validationCommands: (worker.validationRun ?? []).map(
			(item) => item.command,
		),
		closedFindingRefs: wasFinalFeature
			? closedReviewFindingRefsForCompletion(session, worker)
			: closedFindingRefsFor(worker),
	});
}

export function buildFinalReviewerReviewScopeRecoveryDetails(
	session: Session,
	decision: ReviewScopeRecoveryDecisionEvidence,
	options?: { closedFindingRefs?: readonly string[] },
): ReviewScopeRecoveryDetails {
	return buildReviewScopeRecoveryDetailsForDeclaredScope({
		declaredScope: declaredReviewScopeForPlan(session.plan),
		changedArtifacts: decision.evidenceRefs?.changedArtifacts ?? [],
		reviewedContext: reviewContextPackPaths(decision.reviewContextPack),
		validationCommands: decision.evidenceRefs?.validationCommands ?? [],
		closedFindingRefs: options?.closedFindingRefs ?? [],
	});
}
