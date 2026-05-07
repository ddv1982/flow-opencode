import type { z } from "zod";
import type { ReviewerDecision, Session } from "../schema";
import type {
	BehaviorCheckSchema,
	ReviewScopeLedgerEntrySchema,
	ValidationCoverageSchema,
} from "../schema-review-shared";
import type {
	FinalReviewBehaviorCheck,
	FinalReviewValidationCoverage,
} from "./final-review-behavior-risks";
import {
	describeFinalReviewCoverageFailure,
	detailedFinalReviewRequirementFailures,
	isKnownFinalReviewSurface,
} from "./final-review-coverage";
import {
	buildReviewContextPack,
	type ReviewContextPackInput,
} from "./review-content-discovery";
import { detailedFinalReviewDecisionFailureMessage } from "./review-messages";
import { describeFinalReviewerReviewScopeFailure } from "./review-scope-accounting";
import {
	finalReviewPolicyForPlan,
	reviewerPurposeForScope,
} from "./workflow-policy";

type FinalScopeReviewerDecision = Extract<ReviewerDecision, { scope: "final" }>;

function normalizeBehaviorChecksForCoverage(
	checks: Array<z.input<typeof BehaviorCheckSchema>> | undefined,
): FinalReviewBehaviorCheck[] {
	return (checks ?? []).map((check) => ({
		riskClass: check.riskClass,
		result: check.result,
		invariant: check.invariant,
		entrypointRefs: check.entrypointRefs ?? [],
		stateOwnerRefs: check.stateOwnerRefs ?? [],
		lifecycleOwnerRefs: check.lifecycleOwnerRefs ?? [],
		failurePath: check.failurePath,
		oracleRefs: check.oracleRefs ?? [],
		validationRefs: check.validationRefs ?? [],
		...(check.remainingGap ? { remainingGap: check.remainingGap } : {}),
	}));
}

function normalizeValidationCoverageForCoverage(
	coverage: Array<z.input<typeof ValidationCoverageSchema>> | undefined,
): FinalReviewValidationCoverage[] {
	return (coverage ?? []).map((item) => ({
		command: item.command,
		behaviorClasses: item.behaviorClasses ?? [],
		proves: item.proves ?? [],
		gaps: item.gaps ?? [],
		oracleRefs: item.oracleRefs ?? [],
	}));
}

function normalizeReviewScopeLedgerForDecision(
	ledger: RecordReviewerDecisionInput["reviewScopeLedger"],
): FinalScopeReviewerDecision["reviewScopeLedger"] {
	return ledger?.map((entry) => ({
		...entry,
		evidenceRefs: entry.evidenceRefs ?? [],
	}));
}

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
	reviewScopeLedger?:
		| Array<z.input<typeof ReviewScopeLedgerEntrySchema>>
		| undefined;
	reviewContextPack?: ReviewContextPackInput | undefined;
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
	remainingGaps?: string[] | undefined;
	behaviorChecks?: Array<z.input<typeof BehaviorCheckSchema>> | undefined;
	validationCoverage?:
		| Array<z.input<typeof ValidationCoverageSchema>>
		| undefined;
	blockingFindings?: ReviewerDecision["blockingFindings"];
	followUps?: ReviewerDecision["followUps"];
	suggestedValidation?: ReviewerDecision["suggestedValidation"];
};

export type ReviewerDecisionValidationFailureKind =
	| "shape"
	| "final_review_coverage"
	| "final_review_scope_accounting";

export type ReviewerDecisionValidationFailure = {
	kind: ReviewerDecisionValidationFailureKind;
	message: string;
};

function reviewerDecisionValidationFailure(
	kind: ReviewerDecisionValidationFailureKind,
	message: string,
): ReviewerDecisionValidationFailure {
	return { kind, message };
}

export function validateReviewerDecisionInputDetailed(
	session: Session,
	input: RecordReviewerDecisionInput,
): ReviewerDecisionValidationFailure | null {
	if (input.scope === "final" && input.featureId !== undefined) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: featureId: Final reviewer decisions must not include a featureId.",
		);
	}
	if (
		input.scope === "feature" &&
		(input.featureId === undefined || input.featureId.trim() === "")
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: featureId: Feature reviewer decisions must include a featureId.",
		);
	}
	if (input.scope !== "feature" && input.scope !== "final") {
		return reviewerDecisionValidationFailure(
			"shape",
			`Reviewer decision validation failed: scope: Invalid enum value. Expected 'feature' | 'final', received '${input.scope}'.`,
		);
	}
	if (
		input.status !== "approved" &&
		input.status !== "needs_fix" &&
		input.status !== "blocked"
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			`Reviewer decision validation failed: status: Invalid enum value. Expected 'approved' | 'needs_fix' | 'blocked', received '${input.status}'.`,
		);
	}
	if (
		input.scope === "feature" &&
		input.reviewPurpose !== undefined &&
		input.reviewPurpose !== "execution_gate"
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: reviewPurpose: Feature reviewer decisions must use execution_gate.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewPurpose !== undefined &&
		input.reviewPurpose !== "completion_gate"
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: reviewPurpose: Final reviewer decisions must use completion_gate.",
		);
	}
	if (input.scope === "final" && input.reviewDepth === undefined) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: reviewDepth: Final reviewer decisions must include a reviewDepth.",
		);
	}
	if (
		input.scope === "final" &&
		input.reviewDepth !== "broad" &&
		input.reviewDepth !== "detailed"
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			`Reviewer decision validation failed: reviewDepth: Invalid enum value. Expected 'broad' | 'detailed', received '${input.reviewDepth}'.`,
		);
	}
	if (input.scope === "feature" && input.reviewDepth !== undefined) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: reviewDepth: Feature reviewer decisions must not include a reviewDepth.",
		);
	}
	if (
		input.scope === "final" &&
		session.plan &&
		input.reviewDepth !== finalReviewPolicyForPlan(session.plan)
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			`Reviewer decision validation failed: reviewDepth: Final reviewer decisions must match deliveryPolicy.finalReviewPolicy (${finalReviewPolicyForPlan(session.plan)}).`,
		);
	}
	if (
		input.scope === "final" &&
		(!input.reviewedSurfaces || input.reviewedSurfaces.length === 0)
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: reviewedSurfaces: Final reviewer decisions must list reviewedSurfaces.",
		);
	}
	if (
		input.scope === "final" &&
		(!input.evidenceSummary || input.evidenceSummary.trim() === "")
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: evidenceSummary: Final reviewer decisions must include an evidenceSummary.",
		);
	}
	if (
		input.scope === "final" &&
		(!input.validationAssessment || input.validationAssessment.trim() === "")
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: validationAssessment: Final reviewer decisions must include a validationAssessment.",
		);
	}
	if (input.scope === "final" && !input.evidenceRefs) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: evidenceRefs: Final reviewer decisions must include evidenceRefs.",
		);
	}
	const finalReviewedSurfaces = input.reviewedSurfaces ?? [];
	if (
		input.scope === "final" &&
		finalReviewedSurfaces.some((surface) => !isKnownFinalReviewSurface(surface))
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: reviewedSurfaces: Final reviewer decisions must only use known reviewedSurfaces.",
		);
	}
	if (
		input.scope === "final" &&
		input.status === "approved" &&
		(input.behaviorChecks ?? []).some((check) => check.result === "needs_fix")
	) {
		return reviewerDecisionValidationFailure(
			"shape",
			"Reviewer decision validation failed: behaviorChecks: Approved final reviewer decisions cannot include needs_fix behavior checks.",
		);
	}
	if (input.scope === "final") {
		const [detailedFailure] = detailedFinalReviewRequirementFailures({
			reviewDepth: input.reviewDepth ?? "",
			reviewedSurfaces: finalReviewedSurfaces,
			integrationChecks: input.integrationChecks,
			regressionChecks: input.regressionChecks,
		});
		if (detailedFailure) {
			return reviewerDecisionValidationFailure(
				"shape",
				detailedFinalReviewDecisionFailureMessage(detailedFailure),
			);
		}
	}
	if (input.scope === "final" && input.status === "approved") {
		const evidenceRefs = {
			changedArtifacts: input.evidenceRefs?.changedArtifacts ?? [],
			validationCommands: input.evidenceRefs?.validationCommands ?? [],
		};
		const coverageFailure = describeFinalReviewCoverageFailure(
			session,
			{
				artifactsChanged: evidenceRefs.changedArtifacts.map((path) => ({
					path,
				})),
				validationRun: evidenceRefs.validationCommands.map((command) => ({
					command,
				})),
			},
			{
				reviewDepth: input.reviewDepth ?? "",
				reviewedSurfaces: finalReviewedSurfaces,
				evidenceSummary: input.evidenceSummary,
				validationAssessment: input.validationAssessment,
				evidenceRefs,
				integrationChecks: input.integrationChecks,
				regressionChecks: input.regressionChecks,
				remainingGaps: input.remainingGaps,
				suggestedValidation: input.suggestedValidation,
				behaviorChecks: normalizeBehaviorChecksForCoverage(
					input.behaviorChecks,
				),
				validationCoverage: normalizeValidationCoverageForCoverage(
					input.validationCoverage,
				),
				...(input.reviewContextPack
					? {
							reviewContextPack: buildReviewContextPack(
								input.reviewContextPack,
							),
						}
					: {}),
			},
		);
		if (coverageFailure) {
			return reviewerDecisionValidationFailure(
				"final_review_coverage",
				`Reviewer decision validation failed: finalReviewCoverage: ${coverageFailure}`,
			);
		}
		const reviewScopeFailure = describeFinalReviewerReviewScopeFailure(
			session,
			{
				status: "approved",
				evidenceRefs,
				reviewScopeLedger: normalizeReviewScopeLedgerForDecision(
					input.reviewScopeLedger,
				),
				...(input.reviewContextPack
					? {
							reviewContextPack: buildReviewContextPack(
								input.reviewContextPack,
							),
						}
					: {}),
			},
		);
		if (reviewScopeFailure) {
			return reviewerDecisionValidationFailure(
				"final_review_scope_accounting",
				`Reviewer decision validation failed: reviewScopeLedger: ${reviewScopeFailure}`,
			);
		}
	}

	return null;
}

export function validateReviewerDecisionInput(
	session: Session,
	input: RecordReviewerDecisionInput,
): string | null {
	return validateReviewerDecisionInputDetailed(session, input)?.message ?? null;
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
	const reviewScopeLedger = normalizeReviewScopeLedgerForDecision(
		input.reviewScopeLedger,
	);

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
				...(reviewScopeLedger ? { reviewScopeLedger } : {}),
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
				behaviorChecks: (input.behaviorChecks ??
					[]) as FinalScopeReviewerDecision["behaviorChecks"],
				validationCoverage: (input.validationCoverage ??
					[]) as FinalScopeReviewerDecision["validationCoverage"],
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
