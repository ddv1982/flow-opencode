import type { Session } from "../schema";
import {
	detailedFinalReviewRequirementFailures,
	isKnownFinalReviewSurface,
} from "./final-review-coverage";
import { detailedFinalReviewDecisionFailureMessage } from "./review-messages";
import {
	finalReviewedSurfacesForInput,
	type RecordReviewerDecisionInput,
} from "./reviewer-decision-normalization";
import { finalReviewPolicyForPlan } from "./workflow-policy";

export function describeReviewerDecisionShapeFailure(
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
	const finalReviewedSurfaces = finalReviewedSurfacesForInput(input);
	if (
		input.scope === "final" &&
		finalReviewedSurfaces.some((surface) => !isKnownFinalReviewSurface(surface))
	) {
		return "Reviewer decision validation failed: reviewedSurfaces: Final reviewer decisions must only use known reviewedSurfaces.";
	}
	if (
		input.scope === "final" &&
		input.status === "approved" &&
		(input.behaviorChecks ?? []).some((check) => check.result === "needs_fix")
	) {
		return "Reviewer decision validation failed: behaviorChecks: Approved final reviewer decisions cannot include needs_fix behavior checks.";
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
