import { describe, expect, test } from "bun:test";
import {
	archivePublishedResidueProof,
	atomicFailpointReplayProof,
	closeAfterStateSaveProof,
	closeArchiveSafetyProof,
	closeFailureInjectionMatrixProof,
	closeFailureInjectionProof,
	closeFreshServiceRetryProof,
	closeHistoryScanAtomicProof,
	closeNoClobberProof,
	closeRetryHistoryScanAtomicProof,
	closeStatusContractProof,
	closeWorkspaceHistoryIdentityProof,
	finalContextLossProof,
	finalDomainTransitionProof,
	finalRegisteredHostPathProof,
	timeLifecycleBoundaryProof,
	timeReviewAtomicRejectionProof,
	timeValidationPerturbationProof,
} from "./support/lifecycle-recovery-proofs.js";

describe("Session v4 durable recovery proofs", () => {
	for (const [name, proof] of Object.entries({
		archivePublishedResidueProof,
		atomicFailpointReplayProof,
		closeAfterStateSaveProof,
		closeArchiveSafetyProof,
		closeFailureInjectionProof,
		closeFailureInjectionMatrixProof,
		closeFreshServiceRetryProof,
		closeHistoryScanAtomicProof,
		closeNoClobberProof,
		closeRetryHistoryScanAtomicProof,
		closeStatusContractProof,
		closeWorkspaceHistoryIdentityProof,
		finalContextLossProof,
		finalDomainTransitionProof,
		finalRegisteredHostPathProof,
		timeLifecycleBoundaryProof,
		timeReviewAtomicRejectionProof,
		timeValidationPerturbationProof,
	})) {
		test(name, async () => {
			const result = await proof.run();
			expect(result.assertionCount).toBeGreaterThan(0);
		}, 30_000);
	}
});
