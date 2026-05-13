import type { Feature, Plan, Session, WorkerResultArgs } from "../schema";
import { strictReviewGovernanceRequiredForPlan } from "./workflow-policy";

export type ReviewScopeTarget = NonNullable<Feature["reviewScope"]>[number];
export type ReviewScopeLedgerEntry = NonNullable<
	WorkerResultArgs["reviewScopeLedger"]
>[number];

export const REVIEW_SCOPE_LEDGER_SCAFFOLD_PURPOSE = "scaffold_only";
export const REVIEW_SCOPE_LEDGER_SCAFFOLD_RESIDUAL_RISK =
	"Example scaffold only; replace residual risk.";

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

export function isScaffoldResidualRiskPlaceholder(
	value: string | undefined,
): boolean {
	return value?.trim() === REVIEW_SCOPE_LEDGER_SCAFFOLD_RESIDUAL_RISK;
}

export function isReviewScopeAccountingRequired(
	plan: Plan | null | undefined,
): boolean {
	return strictReviewGovernanceRequiredForPlan(plan);
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
