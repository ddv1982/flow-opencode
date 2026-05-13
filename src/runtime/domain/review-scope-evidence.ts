import type { ReviewContextPack } from "./review-content-discovery";
import type { ReviewScopeLedgerEntry } from "./review-scope-targets";

export type ReviewScopeWorkerEvidence = {
	artifactsChanged?: readonly { path: string }[] | undefined;
	reviewScopeLedger?: readonly ReviewScopeLedgerEntry[] | undefined;
	validationRun?: readonly { command: string }[] | undefined;
	finalReview?:
		| {
				evidenceRefs?: { changedArtifacts: string[] } | undefined;
				reviewContextPack?: ReviewContextPack | undefined;
		  }
		| undefined;
	reviewFindingClosures?:
		| readonly { findingRef: string; status: string }[]
		| undefined;
};
