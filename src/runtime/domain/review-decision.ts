// Reviewer decision domain: structural shape validation and normalization
// only. Review depth, coverage, and evidence-quality judgment moved to the
// flow-review skill rubric in v3.

import { FINAL_REVIEW_POLICIES } from "../constants";
import type { ReviewerDecision, Session } from "../schema";
import { reviewerPurposeForScope } from "./workflow-policy";

type FinalScopeReviewerDecision = Extract<ReviewerDecision, { scope: "final" }>;
type FinalReviewDepth = FinalScopeReviewerDecision["reviewDepth"];

export type RecordReviewerDecisionInput = {
	scope: string;
	reviewPurpose?: string | undefined;
	status: string;
	summary: string;
	featureId?: string | undefined;
	reviewDepth?: string | undefined;
	reviewedSurfaces?: string[] | undefined;
	evidenceSummary?: string | undefined;
	validationAssessment?: string | undefined;
	remainingGaps?: string[] | undefined;
	evidenceRefs?:
		| {
				changedArtifacts?: string[] | undefined;
				validationCommands?: string[] | undefined;
		  }
		| undefined;
	blockingFindings?: ReviewerDecision["blockingFindings"];
	followUps?: ReviewerDecision["followUps"];
	suggestedValidation?: ReviewerDecision["suggestedValidation"];
};

function isFinalReviewDepth(value: string): value is FinalReviewDepth {
	return (FINAL_REVIEW_POLICIES as readonly string[]).includes(value);
}

function describeReviewerDecisionShapeFailure(
	session: Session,
	input: RecordReviewerDecisionInput,
): string | null {
	if (input.scope !== "feature" && input.scope !== "final") {
		return `Reviewer decision validation failed: scope: expected "feature" or "final", received "${input.scope}".`;
	}
	if (input.scope === "feature" && !input.featureId) {
		return "Reviewer decision validation failed: featureId: feature-scope decisions must name the reviewed feature.";
	}
	if (input.scope === "final" && input.featureId) {
		return "Reviewer decision validation failed: featureId: final-scope decisions must not name a single feature.";
	}
	if (
		input.scope === "final" &&
		(!input.reviewDepth || !isFinalReviewDepth(input.reviewDepth))
	) {
		return 'Reviewer decision validation failed: reviewDepth: final-scope decisions must declare "broad" or "detailed".';
	}
	void session;
	return null;
}

export function buildReviewerDecision(
	input: RecordReviewerDecisionInput,
): ReviewerDecision {
	const status = input.status as ReviewerDecision["status"];
	if (input.scope === "final") {
		const reviewDepth =
			input.reviewDepth && isFinalReviewDepth(input.reviewDepth)
				? input.reviewDepth
				: "broad";
		return {
			scope: "final",
			reviewPurpose: reviewerPurposeForScope("final"),
			status,
			summary: input.summary,
			blockingFindings: input.blockingFindings ?? [],
			followUps: input.followUps ?? [],
			suggestedValidation: input.suggestedValidation ?? [],
			reviewDepth,
			reviewedSurfaces: (input.reviewedSurfaces ??
				[]) as FinalScopeReviewerDecision["reviewedSurfaces"],
			...(input.evidenceSummary
				? { evidenceSummary: input.evidenceSummary }
				: {}),
			...(input.validationAssessment
				? { validationAssessment: input.validationAssessment }
				: {}),
			remainingGaps: input.remainingGaps ?? [],
			evidenceRefs: {
				changedArtifacts: input.evidenceRefs?.changedArtifacts ?? [],
				validationCommands: input.evidenceRefs?.validationCommands ?? [],
			},
		};
	}
	return {
		scope: "feature",
		featureId: input.featureId ?? "",
		reviewPurpose: reviewerPurposeForScope("feature"),
		status,
		summary: input.summary,
		blockingFindings: input.blockingFindings ?? [],
		followUps: input.followUps ?? [],
		suggestedValidation: input.suggestedValidation ?? [],
	};
}

export function validateReviewerDecisionInput(
	session: Session,
	input: RecordReviewerDecisionInput,
): string | null {
	return describeReviewerDecisionShapeFailure(session, input);
}
