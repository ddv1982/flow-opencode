import { FINAL_REVIEW_SURFACES } from "../constants";
import { finalReviewPolicyForPlan, reviewerPurposeForScope } from "../domain";
import type { Feature, ReviewerDecision, Session } from "../schema";
import { fail, succeed, type TransitionResult } from "./shared";

type FeatureScopeReviewerDecision = Extract<
	ReviewerDecision,
	{ scope: "feature" }
>;
type FinalScopeReviewerDecision = Extract<ReviewerDecision, { scope: "final" }>;
type RecordReviewerDecisionInput = {
	scope: string;
	reviewPurpose?: string | undefined;
	status: string;
	summary: string;
	featureId?: string | undefined;
	reviewDepth?: string | undefined;
	reviewedSurfaces?: string[] | undefined;
	evidenceSummary?: string | undefined;
	validationAssessment?: string | undefined;
	evidenceRefs?:
		| {
				changedArtifacts?: string[] | undefined;
				validationCommands?: string[] | undefined;
		  }
		| undefined;
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
	remainingGaps?: string[] | undefined;
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
	if (input.scope === "final" && input.reviewDepth === undefined) {
		return fail(
			"Reviewer decision validation failed: reviewDepth: Final reviewer decisions must include a reviewDepth.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewDepth !== "broad" &&
		input.reviewDepth !== "detailed"
	) {
		return fail(
			`Reviewer decision validation failed: reviewDepth: Invalid enum value. Expected 'broad' | 'detailed', received '${input.reviewDepth}'.`,
		);
	}
	if (input.scope === "feature" && input.reviewDepth !== undefined) {
		return fail(
			"Reviewer decision validation failed: reviewDepth: Feature reviewer decisions must not include a reviewDepth.",
		);
	}
	if (
		input.scope === "final" &&
		session.plan &&
		input.reviewDepth !== finalReviewPolicyForPlan(session.plan)
	) {
		return fail(
			`Reviewer decision validation failed: reviewDepth: Final reviewer decisions must match deliveryPolicy.finalReviewPolicy (${finalReviewPolicyForPlan(session.plan)}).`,
		);
	}
	if (
		input.scope === "final" &&
		(!input.reviewedSurfaces || input.reviewedSurfaces.length === 0)
	) {
		return fail(
			"Reviewer decision validation failed: reviewedSurfaces: Final reviewer decisions must list reviewedSurfaces.",
		);
	}
	if (
		input.scope === "final" &&
		(!input.evidenceSummary || input.evidenceSummary.trim() === "")
	) {
		return fail(
			"Reviewer decision validation failed: evidenceSummary: Final reviewer decisions must include an evidenceSummary.",
		);
	}
	if (
		input.scope === "final" &&
		(!input.validationAssessment || input.validationAssessment.trim() === "")
	) {
		return fail(
			"Reviewer decision validation failed: validationAssessment: Final reviewer decisions must include a validationAssessment.",
		);
	}
	if (input.scope === "final" && !input.evidenceRefs) {
		return fail(
			"Reviewer decision validation failed: evidenceRefs: Final reviewer decisions must include evidenceRefs.",
		);
	}
	const finalReviewedSurfaces = input.reviewedSurfaces ?? [];
	const finalEvidenceRefs = {
		changedArtifacts: input.evidenceRefs?.changedArtifacts ?? [],
		validationCommands: input.evidenceRefs?.validationCommands ?? [],
	};
	if (
		input.scope === "final" &&
		finalReviewedSurfaces.some(
			(surface) =>
				!FINAL_REVIEW_SURFACES.includes(
					surface as (typeof FINAL_REVIEW_SURFACES)[number],
				),
		)
	) {
		return fail(
			"Reviewer decision validation failed: reviewedSurfaces: Final reviewer decisions must only use known reviewedSurfaces.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewDepth === "detailed" &&
		finalReviewedSurfaces.length < 2
	) {
		return fail(
			"Reviewer decision validation failed: reviewedSurfaces: Detailed final reviewer decisions must cover at least two reviewedSurfaces.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewDepth === "detailed" &&
		!finalReviewedSurfaces.includes("validation_evidence")
	) {
		return fail(
			"Reviewer decision validation failed: reviewedSurfaces: Detailed final reviewer decisions must include validation_evidence.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewDepth === "detailed" &&
		![
			"integration_points",
			"shared_surfaces",
			"tooling_and_config",
			"release_surface",
		].some((surface) => finalReviewedSurfaces.includes(surface))
	) {
		return fail(
			"Reviewer decision validation failed: reviewedSurfaces: Detailed final reviewer decisions must include a cross-feature surface.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewDepth === "detailed" &&
		(!input.integrationChecks || input.integrationChecks.length === 0)
	) {
		return fail(
			"Reviewer decision validation failed: integrationChecks: Detailed final reviewer decisions must include integrationChecks.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewDepth === "detailed" &&
		(!input.regressionChecks || input.regressionChecks.length === 0)
	) {
		return fail(
			"Reviewer decision validation failed: regressionChecks: Detailed final reviewer decisions must include regressionChecks.",
		);
	}
	const finalReviewDepth = input.reviewDepth as
		| FinalScopeReviewerDecision["reviewDepth"]
		| undefined;
	const featureReviewerId = input.featureId ?? "";
	const decision: ReviewerDecision =
		input.scope === "final"
			? {
					scope: "final",
					reviewPurpose: reviewerPurposeForScope("final"),
					reviewDepth:
						finalReviewDepth as FinalScopeReviewerDecision["reviewDepth"],
					status: input.status,
					summary: input.summary,
					blockingFindings: input.blockingFindings ?? [],
					followUps: input.followUps ?? [],
					suggestedValidation: input.suggestedValidation ?? [],
					reviewedSurfaces:
						finalReviewedSurfaces as FinalScopeReviewerDecision["reviewedSurfaces"],
					...(input.evidenceSummary
						? { evidenceSummary: input.evidenceSummary }
						: {}),
					...(input.validationAssessment
						? { validationAssessment: input.validationAssessment }
						: {}),
					evidenceRefs: {
						changedArtifacts: finalEvidenceRefs.changedArtifacts,
						validationCommands: finalEvidenceRefs.validationCommands,
					},
					integrationChecks: (input.integrationChecks ??
						[]) as FinalScopeReviewerDecision["integrationChecks"],
					regressionChecks: (input.regressionChecks ??
						[]) as FinalScopeReviewerDecision["regressionChecks"],
					remainingGaps: (input.remainingGaps ??
						[]) as FinalScopeReviewerDecision["remainingGaps"],
				}
			: {
					scope: "feature",
					featureId: featureReviewerId,
					reviewPurpose: reviewerPurposeForScope("feature"),
					status: input.status,
					summary: input.summary,
					blockingFindings: input.blockingFindings ?? [],
					followUps: input.followUps ?? [],
					suggestedValidation: input.suggestedValidation ?? [],
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
