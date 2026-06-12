import {
	buildReviewerDecision,
	type RecordReviewerDecisionInput,
	validateReviewerDecisionInput,
} from "../domain";
import type { Feature, ReviewerDecision, Session } from "../schema";
import { fail, succeed, type TransitionResult } from "./shared";

type FeatureScopeReviewerDecision = Extract<
	ReviewerDecision,
	{ scope: "feature" }
>;

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

function clearLastRunProjection(
	execution: Session["execution"],
	session: Session,
) {
	execution.lastFeatureId = null;
	execution.lastValidationRun = [];
	execution.lastOutcome = null;
	execution.lastNextStep = null;
	execution.lastFeatureResult = null;
	execution.lastReviewerDecision = null;
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

function canonicalizeDecisionValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalizeDecisionValue);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entryValue]) => entryValue !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entryValue]) => [
					key,
					canonicalizeDecisionValue(entryValue),
				]),
		);
	}
	return value;
}

function reviewerDecisionFingerprint(decision: ReviewerDecision): string {
	return JSON.stringify(canonicalizeDecisionValue(decision));
}

function isSameReviewerDecision(
	current: ReviewerDecision | null,
	next: ReviewerDecision,
): boolean {
	return current
		? reviewerDecisionFingerprint(current) === reviewerDecisionFingerprint(next)
		: false;
}

export function isReviewerDecisionAlreadyRecorded(
	session: Session,
	input: RecordReviewerDecisionInput,
): boolean {
	return isSameReviewerDecision(
		session.execution.lastReviewerDecision,
		buildReviewerDecision(input),
	);
}

export function resetFeature(
	session: Session,
	featureId: string,
): TransitionResult<Session> {
	const plan = session.plan;
	if (!plan) {
		return fail("There is no active plan to reset.");
	}

	const feature = plan.features.find((item) => item.id === featureId);
	if (!feature) {
		return fail(`Feature '${featureId}' was not found in the active plan.`);
	}

	const affected = collectDependents(plan.features, featureId);
	affected.add(featureId);

	const nextPlan = {
		...plan,
		features: resetAffectedFeatures(plan.features, affected),
	};
	const nextExecution = {
		...session.execution,
		activeFeatureId:
			session.execution.activeFeatureId &&
			affected.has(session.execution.activeFeatureId)
				? null
				: session.execution.activeFeatureId,
		lastSummary: buildResetSummary(featureId, affected.size),
		lastOutcomeKind: null,
	};
	const next: Session = {
		...session,
		plan: nextPlan,
		status: session.approval === "approved" ? "ready" : "planning",
		closure: null,
		execution: nextExecution,
		timestamps: {
			...session.timestamps,
			completedAt: null,
		},
	};

	if (
		session.execution.lastFeatureId &&
		affected.has(session.execution.lastFeatureId)
	) {
		clearLastRunProjection(next.execution, next);
	}

	return succeed(next);
}

export function recordReviewerDecision(
	session: Session,
	input: RecordReviewerDecisionInput,
): TransitionResult<Session> {
	const inputFailure = validateReviewerDecisionInput(session, input);
	if (inputFailure) {
		return fail(inputFailure);
	}

	const decision = buildReviewerDecision(input);

	if (isFeatureScopeReviewerDecision(decision)) {
		const validation = validateFeatureScopeReviewerDecision(session, decision);
		if (!validation.ok) {
			return validation;
		}
	}

	if (isReviewerDecisionAlreadyRecorded(session, input)) {
		return succeed(session);
	}

	return succeed({
		...session,
		execution: {
			...session.execution,
			lastReviewerDecision: decision,
			lastSummary: decision.summary,
		},
	});
}
