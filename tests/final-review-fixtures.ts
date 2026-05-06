import type { Session, WorkerResult } from "../src/runtime/schema";

export const CANONICAL_FINAL_REVIEW_VALIDATION_ASSESSMENT =
	"bun test was mapped to the session-completion regression oracle; no unchecked behavior gap remains for this runtime-only fixture.";

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

type ReviewScopeLedgerEntry = NonNullable<
	FinalReviewerDecision["reviewScopeLedger"]
>[number];

type ReviewScopeLedgerEntryOverrides = Partial<ReviewScopeLedgerEntry>;

function finalReviewBase(): Omit<FinalReviewPayload, "status"> {
	return {
		reviewDepth: "detailed",
		reviewedSurfaces: DEFAULT_REVIEWED_SURFACES,
		evidenceSummary:
			"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
		validationAssessment: CANONICAL_FINAL_REVIEW_VALIDATION_ASSESSMENT,
		evidenceRefs: DEFAULT_EVIDENCE_REFS,
		integrationChecks: [
			"Checked the session completion entrypoint against the runtime state/finalization boundary.",
		],
		regressionChecks: [
			"Checked bun test covers the session-completion regression path cited by the fixture.",
		],
		remainingGaps: [],
		summary: "Final review checked the runtime path and validation oracle.",
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

export function createReviewScopeLedgerEntry(
	overrides: ReviewScopeLedgerEntryOverrides = {},
): ReviewScopeLedgerEntry {
	return {
		scopeId: "feature:runtime-session",
		status: "reviewed_no_findings",
		evidenceRefs: ["tests/final-review-fixtures.ts"],
		residualRisk: "No additional risk identified by fixture coverage.",
		...overrides,
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
