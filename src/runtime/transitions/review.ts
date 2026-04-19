import { reviewerPurposeForScope } from "../domain";
import type { Feature, ReviewerDecision, Session } from "../schema";
import { fail, succeed, type TransitionResult } from "./shared";

type FeatureScopeReviewerDecision = ReviewerDecision & { scope: "feature" };
type RecordReviewerDecisionInput = {
	scope: string;
	reviewPurpose?: string | undefined;
	status: string;
	summary: string;
	featureId?: string | undefined;
	blockingFindings?: ReviewerDecision["blockingFindings"];
	followUps?: ReviewerDecision["followUps"];
	suggestedValidation?: ReviewerDecision["suggestedValidation"];
};

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
	if (input.scope === "final" && input.featureId !== undefined) {
		return fail(
			"Reviewer decision validation failed: featureId: Final reviewer decisions must not include a featureId.",
		);
	}
	if (
		input.scope === "feature" &&
		(input.featureId === undefined || input.featureId.trim() === "")
	) {
		return fail(
			"Reviewer decision validation failed: featureId: Feature reviewer decisions must include a featureId.",
		);
	}
	if (input.scope !== "feature" && input.scope !== "final") {
		return fail(
			`Reviewer decision validation failed: scope: Invalid enum value. Expected 'feature' | 'final', received '${input.scope}'.`,
		);
	}
	if (
		input.status !== "approved" &&
		input.status !== "needs_fix" &&
		input.status !== "blocked"
	) {
		return fail(
			`Reviewer decision validation failed: status: Invalid enum value. Expected 'approved' | 'needs_fix' | 'blocked', received '${input.status}'.`,
		);
	}
	if (
		input.scope === "feature" &&
		input.reviewPurpose !== undefined &&
		input.reviewPurpose !== "execution_gate"
	) {
		return fail(
			"Reviewer decision validation failed: reviewPurpose: Feature reviewer decisions must use execution_gate.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewPurpose !== undefined &&
		input.reviewPurpose !== "completion_gate"
	) {
		return fail(
			"Reviewer decision validation failed: reviewPurpose: Final reviewer decisions must use completion_gate.",
		);
	}

	const decision: ReviewerDecision = {
		scope: input.scope,
		reviewPurpose: reviewerPurposeForScope(input.scope),
		status: input.status,
		summary: input.summary,
		blockingFindings: input.blockingFindings ?? [],
		followUps: input.followUps ?? [],
		suggestedValidation: input.suggestedValidation ?? [],
		...(input.featureId !== undefined ? { featureId: input.featureId } : {}),
	};

	if (isFeatureScopeReviewerDecision(decision)) {
		const validation = validateFeatureScopeReviewerDecision(session, decision);
		if (!validation.ok) {
			return validation;
		}
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
