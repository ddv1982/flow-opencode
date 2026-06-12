import type { WorkerResult } from "../src/runtime/schema";

const CANONICAL_FINAL_REVIEW_VALIDATION_ASSESSMENT =
	"bun test was mapped to the session-completion regression evidence; no unchecked behavior gap remains for this runtime-only fixture.";

const DEFAULT_REVIEWED_SURFACES: NonNullable<
	NonNullable<WorkerResult["finalReview"]>["reviewedSurfaces"]
> = ["changed_files", "shared_surfaces", "validation_evidence"];

const DEFAULT_EVIDENCE_REFS = {
	changedArtifacts: ["src/runtime/session.ts"],
	validationCommands: ["bun test"],
};

type FinalReviewPayload = NonNullable<WorkerResult["finalReview"]>;

type FinalReviewOverrides = Partial<FinalReviewPayload> & {
	evidenceRefs?: Partial<FinalReviewPayload["evidenceRefs"]>;
};

function finalReviewBase(): Omit<FinalReviewPayload, "status"> {
	return {
		reviewDepth: "detailed",
		reviewedSurfaces: DEFAULT_REVIEWED_SURFACES,
		evidenceSummary:
			"Checked src/runtime/session.ts entrypoint, session state owner, completion failure path, and validation evidence.",
		validationAssessment: CANONICAL_FINAL_REVIEW_VALIDATION_ASSESSMENT,
		evidenceRefs: DEFAULT_EVIDENCE_REFS,
		remainingGaps: [],
		summary: "Final review checked the runtime path and validation evidence.",
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
