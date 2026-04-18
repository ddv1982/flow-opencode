import { type Feature, ReviewerDecisionSchema, type Session } from "../schema";
import {
	cloneSession,
	fail,
	formatValidationError,
	succeed,
	type TransitionResult,
} from "./shared";

type ReviewerDecision = NonNullable<
	Session["execution"]["lastReviewerDecision"]
>;
type FeatureScopeReviewerDecision = ReviewerDecision & { scope: "feature" };

function collectDependents(
	features: Feature[],
	featureId: string,
): Set<string> {
	const dependents = new Set<string>();
	let changed = true;

	while (changed) {
		changed = false;
		for (const feature of features) {
			if (feature.id === featureId || dependents.has(feature.id)) {
				continue;
			}

			const dependencies = new Set([
				...(feature.dependsOn ?? []),
				...(feature.blockedBy ?? []),
			]);
			if (
				dependencies.has(featureId) ||
				[...dependents].some((id) => dependencies.has(id))
			) {
				dependents.add(feature.id);
				changed = true;
			}
		}
	}

	return dependents;
}

function resetAffectedFeatures(
	features: Feature[],
	affected: Set<string>,
): Feature[] {
	return features.map((item) =>
		affected.has(item.id) ? { ...item, status: "pending" } : item,
	);
}

function clearLastRunProjection(session: Session): void {
	session.execution.lastFeatureId = null;
	session.execution.lastValidationRun = [];
	session.execution.lastOutcome = null;
	session.execution.lastNextStep = null;
	session.execution.lastFeatureResult = null;
	session.execution.lastReviewerDecision = null;
	session.artifacts = [];
	session.notes = [];
}

function buildResetSummary(featureId: string, affectedCount: number): string {
	return affectedCount > 1
		? `Reset feature '${featureId}' and its dependent features to pending.`
		: `Reset feature '${featureId}' to pending.`;
}

function validateFeatureScopeReviewerDecision(
	session: Session,
	decision: FeatureScopeReviewerDecision,
): TransitionResult<void> {
	if (!session.execution.activeFeatureId) {
		return fail("There is no active feature to review.");
	}
	if (decision.featureId !== session.execution.activeFeatureId) {
		return fail(
			`Reviewer decision feature '${decision.featureId}' does not match active feature '${session.execution.activeFeatureId}'.`,
		);
	}

	return succeed(undefined);
}

function isFeatureScopeReviewerDecision(
	decision: ReviewerDecision,
): decision is FeatureScopeReviewerDecision {
	return decision.scope === "feature";
}

export function resetFeature(
	session: Session,
	featureId: string,
): TransitionResult<Session> {
	if (!session.plan) {
		return fail("There is no active plan to reset.");
	}

	const next = cloneSession(session);
	const plan = next.plan;
	if (!plan) {
		return fail("There is no active plan to reset.");
	}
	const feature = plan.features.find((item) => item.id === featureId);
	if (!feature) {
		return fail(`Feature '${featureId}' was not found in the active plan.`);
	}

	const affected = collectDependents(plan.features, featureId);
	affected.add(featureId);
	plan.features = resetAffectedFeatures(plan.features, affected);
	next.status = next.approval === "approved" ? "ready" : "planning";
	if (
		next.execution.activeFeatureId &&
		affected.has(next.execution.activeFeatureId)
	) {
		next.execution.activeFeatureId = null;
	}
	const shouldClearLastRun = next.execution.lastFeatureId
		? affected.has(next.execution.lastFeatureId)
		: false;
	if (shouldClearLastRun) {
		clearLastRunProjection(next);
	}
	next.execution.lastSummary = buildResetSummary(featureId, affected.size);
	next.execution.lastOutcomeKind = null;
	next.timestamps.completedAt = null;
	return succeed(next);
}

export function recordReviewerDecision(
	session: Session,
	input: unknown,
): TransitionResult<Session> {
	let decision: ReviewerDecision;
	try {
		decision = ReviewerDecisionSchema.parse(input);
	} catch (error) {
		return fail(
			`Reviewer decision validation failed: ${formatValidationError(error)}`,
		);
	}

	if (decision.scope === "final" && decision.featureId !== undefined) {
		return fail(
			"Reviewer decision validation failed: featureId: Final reviewer decisions must not include a featureId.",
		);
	}
	if (
		decision.scope === "feature" &&
		(decision.featureId === undefined || decision.featureId.trim() === "")
	) {
		return fail(
			"Reviewer decision validation failed: featureId: Feature reviewer decisions must include a featureId.",
		);
	}

	const next = cloneSession(session);
	if (isFeatureScopeReviewerDecision(decision)) {
		const validation = validateFeatureScopeReviewerDecision(next, decision);
		if (!validation.ok) {
			return validation;
		}
	}

	next.execution.lastReviewerDecision = decision;
	next.execution.lastSummary = decision.summary;
	return succeed(next);
}
