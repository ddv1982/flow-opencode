import type { ReviewerDecision, Session } from "../schema";
import {
	detailedFinalReviewRequirementFailures,
	isKnownFinalReviewSurface,
} from "./final-review-coverage";
import {
	buildReviewContextPack,
	type ReviewContextPackInput,
} from "./review-content-discovery";
import { detailedFinalReviewDecisionFailureMessage } from "./review-messages";
import {
	finalReviewPolicyForPlan,
	reviewerPurposeForScope,
} from "./workflow-policy";

type FinalScopeReviewerDecision = Extract<ReviewerDecision, { scope: "final" }>;

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
	evidenceRefs?:
		| {
				changedArtifacts?: string[] | undefined;
				validationCommands?: string[] | undefined;
		  }
		| undefined;
	evidencePackets?: FinalScopeReviewerDecision["evidencePackets"];
	reviewContextPack?: ReviewContextPackInput | undefined;
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
	remainingGaps?: string[] | undefined;
	blockingFindings?: ReviewerDecision["blockingFindings"];
	followUps?: ReviewerDecision["followUps"];
	suggestedValidation?: ReviewerDecision["suggestedValidation"];
};

export function validateReviewerDecisionInput(
	session: Session,
	input: RecordReviewerDecisionInput,
): string | null {
	if (input.scope === "final" && input.featureId !== undefined) {
		return "Reviewer decision validation failed: featureId: Final reviewer decisions must not include a featureId.";
	}
	if (
		input.scope === "feature" &&
		(input.featureId === undefined || input.featureId.trim() === "")
	) {
		return "Reviewer decision validation failed: featureId: Feature reviewer decisions must include a featureId.";
	}
	if (input.scope !== "feature" && input.scope !== "final") {
		return `Reviewer decision validation failed: scope: Invalid enum value. Expected 'feature' | 'final', received '${input.scope}'.`;
	}
	if (
		input.status !== "approved" &&
		input.status !== "needs_fix" &&
		input.status !== "blocked"
	) {
		return `Reviewer decision validation failed: status: Invalid enum value. Expected 'approved' | 'needs_fix' | 'blocked', received '${input.status}'.`;
	}
	if (
		input.scope === "feature" &&
		input.reviewPurpose !== undefined &&
		input.reviewPurpose !== "execution_gate"
	) {
		return "Reviewer decision validation failed: reviewPurpose: Feature reviewer decisions must use execution_gate.";
	}
	if (
		input.scope === "final" &&
		input.reviewPurpose !== undefined &&
		input.reviewPurpose !== "completion_gate"
	) {
		return "Reviewer decision validation failed: reviewPurpose: Final reviewer decisions must use completion_gate.";
	}
	if (input.scope === "final" && input.reviewDepth === undefined) {
		return "Reviewer decision validation failed: reviewDepth: Final reviewer decisions must include a reviewDepth.";
	}
	if (
		input.scope === "final" &&
		input.reviewDepth !== "broad" &&
		input.reviewDepth !== "detailed"
	) {
		return `Reviewer decision validation failed: reviewDepth: Invalid enum value. Expected 'broad' | 'detailed', received '${input.reviewDepth}'.`;
	}
	if (input.scope === "feature" && input.reviewDepth !== undefined) {
		return "Reviewer decision validation failed: reviewDepth: Feature reviewer decisions must not include a reviewDepth.";
	}
	if (
		input.scope === "final" &&
		session.plan &&
		input.reviewDepth !== finalReviewPolicyForPlan(session.plan)
	) {
		return `Reviewer decision validation failed: reviewDepth: Final reviewer decisions must match deliveryPolicy.finalReviewPolicy (${finalReviewPolicyForPlan(session.plan)}).`;
	}
	if (
		input.scope === "final" &&
		(!input.reviewedSurfaces || input.reviewedSurfaces.length === 0)
	) {
		return "Reviewer decision validation failed: reviewedSurfaces: Final reviewer decisions must list reviewedSurfaces.";
	}
	if (
		input.scope === "final" &&
		(!input.evidenceSummary || input.evidenceSummary.trim() === "")
	) {
		return "Reviewer decision validation failed: evidenceSummary: Final reviewer decisions must include an evidenceSummary.";
	}
	if (
		input.scope === "final" &&
		(!input.validationAssessment || input.validationAssessment.trim() === "")
	) {
		return "Reviewer decision validation failed: validationAssessment: Final reviewer decisions must include a validationAssessment.";
	}
	if (input.scope === "final" && !input.evidenceRefs) {
		return "Reviewer decision validation failed: evidenceRefs: Final reviewer decisions must include evidenceRefs.";
	}
	const finalReviewedSurfaces = input.reviewedSurfaces ?? [];
	if (
		input.scope === "final" &&
		finalReviewedSurfaces.some((surface) => !isKnownFinalReviewSurface(surface))
	) {
		return "Reviewer decision validation failed: reviewedSurfaces: Final reviewer decisions must only use known reviewedSurfaces.";
	}
	if (input.scope === "final") {
		const [detailedFailure] = detailedFinalReviewRequirementFailures({
			reviewDepth: input.reviewDepth ?? "",
			reviewedSurfaces: finalReviewedSurfaces,
			integrationChecks: input.integrationChecks,
			regressionChecks: input.regressionChecks,
		});
		if (detailedFailure) {
			return detailedFinalReviewDecisionFailureMessage(detailedFailure);
		}
	}

	return null;
}

export function buildReviewerDecision(
	input: RecordReviewerDecisionInput,
): ReviewerDecision {
	const finalReviewedSurfaces = input.reviewedSurfaces ?? [];
	const finalEvidenceRefs = {
		changedArtifacts: input.evidenceRefs?.changedArtifacts ?? [],
		validationCommands: input.evidenceRefs?.validationCommands ?? [],
	};
	const finalReviewDepth = input.reviewDepth as
		| FinalScopeReviewerDecision["reviewDepth"]
		| undefined;
	const featureReviewerId = input.featureId ?? "";
	const reviewerStatus = input.status as ReviewerDecision["status"];

	return input.scope === "final"
		? {
				scope: "final",
				reviewPurpose: reviewerPurposeForScope("final"),
				reviewDepth:
					finalReviewDepth as FinalScopeReviewerDecision["reviewDepth"],
				status: reviewerStatus,
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
				...(input.evidencePackets
					? { evidencePackets: input.evidencePackets }
					: {}),
				...(input.reviewContextPack
					? {
							reviewContextPack: buildReviewContextPack(
								input.reviewContextPack,
							),
						}
					: {}),
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
				status: reviewerStatus,
				summary: input.summary,
				blockingFindings: input.blockingFindings ?? [],
				followUps: input.followUps ?? [],
				suggestedValidation: input.suggestedValidation ?? [],
			};
}
