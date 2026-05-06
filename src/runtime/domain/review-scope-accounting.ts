import { REVIEW_SCOPE_ACCOUNTING_STATUSES } from "../constants";
import type {
	Feature,
	Plan,
	ReviewerDecision,
	Session,
	WorkerResultArgs,
} from "../schema";

export type ReviewScopeTarget = NonNullable<Feature["reviewScope"]>[number];
export type ReviewScopeLedgerEntry = NonNullable<
	WorkerResultArgs["reviewScopeLedger"]
>[number];

type LedgerValidationContext = {
	declaredScope: readonly ReviewScopeTarget[];
	ledger: readonly ReviewScopeLedgerEntry[];
	validationCommands?: readonly string[];
	closedFindingRefs?: readonly string[];
	requireClosedFindingMatch?: boolean;
	label?: string;
};

const REVIEW_SCOPE_ACCOUNTING_STATUS_SET = new Set<string>(
	REVIEW_SCOPE_ACCOUNTING_STATUSES,
);

type WorkerEvidence = {
	reviewScopeLedger?: readonly ReviewScopeLedgerEntry[] | undefined;
	validationRun?: readonly { command: string }[] | undefined;
	reviewFindingClosures?:
		| readonly { findingRef: string; status: string }[]
		| undefined;
};

const WILDCARD_PATTERN = /[*?[\]{}]/;

function normalizeScopeText(value: string): string {
	return value.trim();
}

function scopeTargetKindForFileTarget(
	target: string,
): ReviewScopeTarget["kind"] {
	return WILDCARD_PATTERN.test(target) ? "glob" : "file";
}

function scopeIdForFileTarget(target: string): string {
	return `file_target:${normalizeScopeText(target)}`;
}

function dedupeScopeTargets(
	targets: readonly ReviewScopeTarget[],
): ReviewScopeTarget[] {
	const seen = new Set<string>();
	const result: ReviewScopeTarget[] = [];
	for (const target of targets) {
		const id = normalizeScopeText(target.id);
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		result.push({
			...target,
			id,
			target: normalizeScopeText(target.target),
		});
	}
	return result;
}

export function isReviewScopeAccountingRequired(
	plan: Plan | null | undefined,
): boolean {
	return plan?.goalMode === "review" || plan?.goalMode === "review_and_fix";
}

export function declaredReviewScopeForFeature(
	feature: Pick<Feature, "fileTargets" | "reviewScope">,
): ReviewScopeTarget[] {
	const explicitScope = feature.reviewScope ?? [];
	if (explicitScope.length > 0) {
		return dedupeScopeTargets(explicitScope);
	}

	return dedupeScopeTargets(
		(feature.fileTargets ?? [])
			.map(normalizeScopeText)
			.filter(Boolean)
			.map((target) => ({
				id: scopeIdForFileTarget(target),
				kind: scopeTargetKindForFileTarget(target),
				target,
			})),
	);
}

export function declaredReviewScopeForPlan(
	plan: Plan | null | undefined,
): ReviewScopeTarget[] {
	if (!plan) {
		return [];
	}
	return dedupeScopeTargets(
		plan.features.flatMap((feature) => declaredReviewScopeForFeature(feature)),
	);
}

export function validatePlanReviewScopeDeclaration(plan: Plan): string | null {
	if (!isReviewScopeAccountingRequired(plan)) {
		return null;
	}
	const explicitScopeIds = new Set<string>();
	const effectiveScopesById = new Map<string, ReviewScopeTarget>();
	for (const feature of plan.features) {
		for (const scope of feature.reviewScope ?? []) {
			const scopeId = normalizeScopeText(scope.id);
			if (!scopeId) {
				continue;
			}
			if (explicitScopeIds.has(scopeId)) {
				return `Review scope target id '${scopeId}' is declared more than once; reviewScope ids must be unique.`;
			}
			explicitScopeIds.add(scopeId);
		}
	}
	for (const feature of plan.features) {
		for (const scope of declaredReviewScopeForFeature(feature)) {
			const priorScope = effectiveScopesById.get(scope.id);
			if (!priorScope) {
				effectiveScopesById.set(scope.id, scope);
				continue;
			}
			if (
				priorScope.kind !== scope.kind ||
				priorScope.target !== scope.target
			) {
				return `Review scope target id '${scope.id}' is declared for multiple distinct targets; reviewScope ids must be unique after fileTargets fallback.`;
			}
		}
	}
	return effectiveScopesById.size > 0
		? null
		: "Review and review-and-fix plans must declare review scope through reviewScope or fileTargets before approval.";
}

export function declaredReviewScopeForCompletion(
	session: Session,
	featureId: string,
	wasFinalFeature: boolean,
): ReviewScopeTarget[] {
	const plan = session.plan;
	if (!isReviewScopeAccountingRequired(plan) || !plan) {
		return [];
	}
	if (wasFinalFeature) {
		return declaredReviewScopeForPlan(plan);
	}
	const feature = plan.features.find((item) => item.id === featureId);
	return feature ? declaredReviewScopeForFeature(feature) : [];
}

function evidenceRefsFor(entry: ReviewScopeLedgerEntry): readonly string[] {
	return entry.evidenceRefs ?? [];
}

function validationRefsFor(entry: ReviewScopeLedgerEntry): readonly string[] {
	return entry.validationRefs ?? [];
}

function findingRefsFor(entry: ReviewScopeLedgerEntry): readonly string[] {
	return entry.findingRefs ?? [];
}

function validateLedgerEntries({
	declaredScope,
	ledger,
	validationCommands = [],
	closedFindingRefs = [],
	requireClosedFindingMatch = false,
	label = "reviewScopeLedger",
}: LedgerValidationContext): string | null {
	const declaredIds = new Set(declaredScope.map((scope) => scope.id));
	const validationCommandSet = new Set(validationCommands);
	const closedFindingSet = new Set(closedFindingRefs);
	const seen = new Set<string>();

	for (const [index, entry] of ledger.entries()) {
		const entryLabel = `${label}[${index}]`;
		if (!declaredIds.has(entry.scopeId)) {
			return `${entryLabel}.scopeId '${entry.scopeId}' is not a declared review scope target.`;
		}
		if (!REVIEW_SCOPE_ACCOUNTING_STATUS_SET.has(entry.status)) {
			return `${entryLabel}.status '${entry.status}' is not a supported review scope accounting status.`;
		}
		if (seen.has(entry.scopeId)) {
			return `${entryLabel}.scopeId '${entry.scopeId}' is duplicated in the same review scope ledger.`;
		}
		seen.add(entry.scopeId);
		if (evidenceRefsFor(entry).length === 0) {
			return `${entryLabel} must include evidenceRefs.`;
		}
		if (!entry.residualRisk?.trim()) {
			return `${entryLabel} must include residualRisk.`;
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

function latestValidCompletedHistoryEntries(
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
		const structuralFailure = validateLedgerEntries({
			declaredScope: featureScope,
			ledger: historyEntry.reviewScopeLedger ?? [],
			validationCommands: historyEntry.validationRun.map(
				(item) => item.command,
			),
			closedFindingRefs: closedFindingRefsFor(historyEntry),
			requireClosedFindingMatch: session.plan?.goalMode === "review_and_fix",
			label: `history[${historyEntry.featureId}].reviewScopeLedger`,
		});
		if (!structuralFailure) {
			latestValidByFeature.set(historyEntry.featureId, historyEntry);
		}
	}
	return [...latestValidByFeature.values()];
}

function completionAccountingMap(
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

function closedFindingRefsFor(worker: WorkerEvidence): string[] {
	return (worker.reviewFindingClosures ?? [])
		.filter((closure) => closure.status === "closed")
		.map((closure) => closure.findingRef);
}

export function closedReviewFindingRefsForCompletion(
	session: Session,
	currentWorker: WorkerEvidence,
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

export function describeReviewScopeLedgerFailure(
	session: Session,
	worker: WorkerEvidence,
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
		"reviewScopeLedger" | "evidenceRefs" | "status"
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
