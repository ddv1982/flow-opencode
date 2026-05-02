import type { Session, WorkerResult } from "../src/runtime/schema";

export const CANONICAL_FINAL_REVIEW_VALIDATION_ASSESSMENT =
	"Validation coverage and cross-feature interactions were reviewed.";

const DEFAULT_REVIEWED_SURFACES: NonNullable<
	NonNullable<WorkerResult["finalReview"]>["reviewedSurfaces"]
> = ["changed_files", "shared_surfaces", "validation_evidence"];

const DEFAULT_EVIDENCE_REFS = {
	changedArtifacts: ["src/runtime/session.ts"],
	validationCommands: ["bun test"],
};

type FinalReviewPayload = NonNullable<WorkerResult["finalReview"]>;
type FinalReviewerDecision = Extract<
	NonNullable<Session["execution"]["lastReviewerDecision"]>,
	{ scope: "final" }
>;

type FinalReviewOverrides = Partial<FinalReviewPayload> & {
	evidenceRefs?: Partial<FinalReviewPayload["evidenceRefs"]>;
};

type FinalReviewerDecisionOverrides = Partial<FinalReviewerDecision> & {
	evidenceRefs?: Partial<FinalReviewerDecision["evidenceRefs"]>;
};

function finalReviewBase(): Omit<FinalReviewPayload, "status"> {
	return {
		reviewDepth: "detailed",
		reviewedSurfaces: DEFAULT_REVIEWED_SURFACES,
		evidenceSummary:
			"Checked final cross-feature integration and validation evidence.",
		validationAssessment: CANONICAL_FINAL_REVIEW_VALIDATION_ASSESSMENT,
		evidenceRefs: DEFAULT_EVIDENCE_REFS,
		integrationChecks: [
			"Reviewed integration points across the active feature boundary.",
		],
		regressionChecks: [
			"Checked for regressions in shared surfaces and validation evidence.",
		],
		remainingGaps: [],
		summary: "Final review looks good.",
		blockingFindings: [],
	};
}

export function createFinalReviewPayload(
	overrides: FinalReviewOverrides = {},
): FinalReviewPayload {
	return {
		...finalReviewBase(),
		status: "passed",
		...overrides,
		evidenceRefs: {
			...DEFAULT_EVIDENCE_REFS,
			...overrides.evidenceRefs,
		},
	};
}

export function createApprovedFinalReviewerDecision(
	overrides: FinalReviewerDecisionOverrides = {},
): FinalReviewerDecision {
	return {
		scope: "final",
		...finalReviewBase(),
		status: "approved",
		followUps: [],
		suggestedValidation: [],
		...overrides,
		evidenceRefs: {
			...DEFAULT_EVIDENCE_REFS,
			...overrides.evidenceRefs,
		},
	};
}
