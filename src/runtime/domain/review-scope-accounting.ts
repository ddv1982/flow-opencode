import { REVIEW_SCOPE_ACCOUNTING_STATUSES } from "../constants";
import type {
	Feature,
	Plan,
	ReviewerDecision,
	Session,
	WorkerResultArgs,
} from "../schema";
import {
	integrationAreaForPath,
	isDocsAndPromptsPath,
	isOperatorSurfacePath,
	isReleaseSurfacePath,
	isSafeReviewArtifactRef,
	isTestPath,
	isToolingAndConfigPath,
	normalizeArtifactPath,
	pathForReviewArtifactRef,
	sharedAreaForPath,
} from "./final-review-coverage-paths";
import type { ReviewContextPack } from "./review-content-discovery";

export type ReviewScopeTarget = NonNullable<Feature["reviewScope"]>[number];
export type ReviewScopeLedgerEntry = NonNullable<
	WorkerResultArgs["reviewScopeLedger"]
>[number];

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

type WorkerEvidence = {
	artifactsChanged?: readonly { path: string }[] | undefined;
	reviewScopeLedger?: readonly ReviewScopeLedgerEntry[] | undefined;
	validationRun?: readonly { command: string }[] | undefined;
	finalReview?:
		| {
				evidenceRefs?: { changedArtifacts: string[] } | undefined;
				reviewContextPack?: ReviewContextPack | undefined;
		  }
		| undefined;
	reviewFindingClosures?:
		| readonly { findingRef: string; status: string }[]
		| undefined;
};

const WILDCARD_PATTERN = /[*?[\]{}]/;
const UNSUPPORTED_GLOB_PATTERN = /[[\]{}]/;

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

function scopeTargetsForFileTargets(
	fileTargets: readonly string[] | undefined,
): ReviewScopeTarget[] {
	return (fileTargets ?? [])
		.map(normalizeScopeText)
		.filter(Boolean)
		.map((target) => ({
			id: scopeIdForFileTarget(target),
			kind: scopeTargetKindForFileTarget(target),
			target,
		}));
}

export function declaredReviewScopeForFeature(
	feature: Pick<Feature, "fileTargets" | "reviewScope">,
): ReviewScopeTarget[] {
	return dedupeScopeTargets([
		...(feature.reviewScope ?? []),
		...scopeTargetsForFileTargets(feature.fileTargets),
	]);
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
		const featureScopesById = new Map<string, ReviewScopeTarget>();
		for (const rawScope of [
			...(feature.reviewScope ?? []),
			...scopeTargetsForFileTargets(feature.fileTargets),
		]) {
			const scope = dedupeScopeTargets([rawScope])[0];
			if (!scope) {
				continue;
			}
			const priorFeatureScope = featureScopesById.get(scope.id);
			if (!priorFeatureScope) {
				featureScopesById.set(scope.id, scope);
				continue;
			}
			if (
				priorFeatureScope.kind !== scope.kind ||
				priorFeatureScope.target !== scope.target
			) {
				return `Review scope target id '${scope.id}' is declared for multiple distinct targets; reviewScope ids must not collide with fileTargets-derived scope ids.`;
			}
		}
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

function reviewContextPackPaths(pack: ReviewContextPack | undefined): string[] {
	if (!pack) {
		return [];
	}
	return [
		...pack.changedFiles,
		...pack.includedContext.map((context) => context.path),
		...pack.relationships.flatMap((relationship) => [
			relationship.from,
			relationship.to,
		]),
	];
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function globPatternMatchesPath(pattern: string, path: string): boolean {
	if (UNSUPPORTED_GLOB_PATTERN.test(pattern)) {
		return false;
	}
	const regexSource = escapeRegExp(pattern)
		.replaceAll("**", ".*")
		.replaceAll("*", "[^/]*")
		.replaceAll("\\?", "[^/]");
	return new RegExp(`^${regexSource}$`).test(path);
}

function pathMatchesPathLikeScopeTarget(target: string, path: string): boolean {
	const normalizedTarget = normalizeArtifactPath(target);
	if (!normalizedTarget.includes("/")) {
		return false;
	}
	return (
		path === normalizedTarget ||
		path.startsWith(`${normalizedTarget.replace(/\/$/, "")}/`)
	);
}

function pathMatchesDomainScopeTarget(target: string, path: string): boolean {
	if (pathMatchesPathLikeScopeTarget(target, path)) {
		return true;
	}
	const targetTokens = target.toLowerCase().split(/[^a-z0-9]+/);
	return [sharedAreaForPath(path), integrationAreaForPath(path)].some(
		(area) => area !== null && targetTokens.includes(area),
	);
}

function pathMatchesSurfaceScopeTarget(target: string, path: string): boolean {
	const normalizedTarget = normalizeArtifactPath(target).toLowerCase();
	switch (normalizedTarget) {
		case "changed_files":
			return true;
		case "docs_and_prompts":
		case "docs":
			return isDocsAndPromptsPath(path);
		case "tooling_and_config":
		case "tooling":
			return isToolingAndConfigPath(path);
		case "operator_surfaces":
		case "operator":
			return isOperatorSurfacePath(path);
		case "release_surface":
		case "release":
			return isReleaseSurfacePath(path);
		case "tests":
			return isTestPath(path);
		case "shared_surfaces":
			return sharedAreaForPath(path) !== null;
		case "integration_points":
			return integrationAreaForPath(path) !== null;
		default:
			return pathMatchesPathLikeScopeTarget(target, path);
	}
}

function reviewScopeTargetGroundsRef(
	scope: ReviewScopeTarget,
	_pathRef: string,
	path: string,
): boolean {
	const normalizedTarget = normalizeArtifactPath(scope.target);
	if (scope.kind === "file") {
		return path === normalizedTarget;
	}
	if (scope.kind === "glob") {
		return globPatternMatchesPath(normalizedTarget, path);
	}
	if (scope.kind === "domain") {
		return pathMatchesDomainScopeTarget(normalizedTarget, path);
	}
	if (scope.kind === "surface") {
		return pathMatchesSurfaceScopeTarget(normalizedTarget, path);
	}
	return pathMatchesPathLikeScopeTarget(normalizedTarget, path);
}

function validateLedgerEntries({
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
		reviewContextPackPaths(reviewContextPack),
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
			const targetSelfReferenceAllowed =
				declaredScopeEntry.kind === "file" &&
				evidencePath === normalizeArtifactPath(declaredScopeEntry.target);
			if (
				!reviewScopeTargetGroundsRef(
					declaredScopeEntry,
					trimmedEvidenceRef,
					evidencePath,
				) ||
				(!changedArtifactSet.has(evidencePath) &&
					!reviewedContextPathSet.has(evidencePath) &&
					!targetSelfReferenceAllowed)
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
			changedArtifacts: historyEntry.artifactsChanged.map(
				(artifact) => artifact.path,
			),
			reviewContextPack: historyEntry.finalReview?.reviewContextPack,
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
