import type { z } from "zod";
import type { ReviewerDecision } from "../schema";
import type { ReviewScopeLedgerEntrySchema } from "../schema-review-shared";
import type {
	FinalReviewBehaviorCheck,
	FinalReviewBehaviorRiskClass,
	FinalReviewValidationCoverage,
} from "./final-review-behavior-risks";
import {
	buildReviewContextPack,
	type ReviewContextPack,
	type ReviewContextPackInput,
} from "./review-content-discovery";

type FinalScopeReviewerDecision = Extract<ReviewerDecision, { scope: "final" }>;

export type BehaviorCheckInput = {
	riskClass: string;
	result: "passed" | "gap_recorded" | "not_applicable" | "needs_fix";
	invariant: string;
	entrypointRefs?: string[] | undefined;
	stateOwnerRefs?: string[] | undefined;
	lifecycleOwnerRefs?: string[] | undefined;
	failurePath: string;
	testEvidenceRefs?: string[] | undefined;
	oracleRefs?: string[] | undefined;
	validationRefs?: string[] | undefined;
	remainingGap?: string | undefined;
};

export type ValidationCoverageInput = {
	command: string;
	behaviorClasses?: string[] | undefined;
	proves?: string[] | undefined;
	gaps?: string[] | undefined;
	testEvidenceRefs?: string[] | undefined;
	oracleRefs?: string[] | undefined;
};

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
	behaviorChecks?: BehaviorCheckInput[] | undefined;
	validationCoverage?: ValidationCoverageInput[] | undefined;
	blockingFindings?: ReviewerDecision["blockingFindings"];
	followUps?: ReviewerDecision["followUps"];
	suggestedValidation?: ReviewerDecision["suggestedValidation"];
};

export function normalizeBehaviorRiskClass(
	riskClass: string,
): FinalReviewBehaviorRiskClass {
	return (
		riskClass === "test_oracle_authenticity"
			? "test_evidence_authenticity"
			: riskClass
	) as FinalReviewBehaviorRiskClass;
}

function legacyCompatibleTestEvidenceRefs(value: {
	testEvidenceRefs?: string[] | undefined;
	oracleRefs?: string[] | undefined;
}): string[] {
	return value.testEvidenceRefs ?? value.oracleRefs ?? [];
}

export function normalizeBehaviorChecksForCoverage(
	checks: BehaviorCheckInput[] | undefined,
): FinalReviewBehaviorCheck[] {
	return (checks ?? []).map((check) => ({
		riskClass: normalizeBehaviorRiskClass(check.riskClass),
		result: check.result,
		invariant: check.invariant,
		entrypointRefs: check.entrypointRefs ?? [],
		stateOwnerRefs: check.stateOwnerRefs ?? [],
		lifecycleOwnerRefs: check.lifecycleOwnerRefs ?? [],
		failurePath: check.failurePath,
		testEvidenceRefs: legacyCompatibleTestEvidenceRefs(check),
		validationRefs: check.validationRefs ?? [],
		...(check.remainingGap ? { remainingGap: check.remainingGap } : {}),
	}));
}

export function normalizeValidationCoverageForCoverage(
	coverage: ValidationCoverageInput[] | undefined,
): FinalReviewValidationCoverage[] {
	return (coverage ?? []).map((item) => ({
		command: item.command,
		behaviorClasses: (item.behaviorClasses ?? []).map(
			normalizeBehaviorRiskClass,
		),
		proves: item.proves ?? [],
		gaps: item.gaps ?? [],
		testEvidenceRefs: legacyCompatibleTestEvidenceRefs(item),
	}));
}

export function normalizeReviewScopeLedgerForDecision(
	ledger: RecordReviewerDecisionInput["reviewScopeLedger"],
): FinalScopeReviewerDecision["reviewScopeLedger"] {
	return ledger?.map((entry) => ({
		...entry,
		evidenceRefs: entry.evidenceRefs ?? [],
	}));
}

export function normalizeFinalReviewEvidenceRefs(
	input: RecordReviewerDecisionInput,
): FinalScopeReviewerDecision["evidenceRefs"] {
	return {
		changedArtifacts: input.evidenceRefs?.changedArtifacts ?? [],
		validationCommands: input.evidenceRefs?.validationCommands ?? [],
	};
}

export function finalReviewedSurfacesForInput(
	input: RecordReviewerDecisionInput,
): string[] {
	return input.reviewedSurfaces ?? [];
}

export function buildNormalizedReviewContextPack(
	input: RecordReviewerDecisionInput,
): ReviewContextPack | undefined {
	return input.reviewContextPack
		? buildReviewContextPack(input.reviewContextPack)
		: undefined;
}
