import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(`Atlas retry outcome invalid: ${message}`);
};
const directory = new URL(".", import.meta.url);
const outcome = JSON.parse(
	await readFile(new URL("observed-retry-outcome.json", directory), "utf8"),
);
const lead = JSON.parse(await readFile(new URL("draft.json", directory), "utf8"));

assert(
	outcome.classification === "observed-remedy-outcome-not-qualification" &&
		outcome.checkpointRevision === lead.snapshot.session.revision &&
		outcome.checkpointSourceDigest === lead.snapshot.sourceDigest &&
		outcome.originatingTaskId === lead.snapshot.provenance.originatingTaskId &&
		outcome.independenceGroupId === lead.snapshot.provenance.independenceGroupId &&
		outcome.remedy.candidateId === lead.snapshot.proposal.candidates[0]?.id,
	"checkpoint and proposed remedy binding",
);
assert(
	outcome.authorization.maxDispatches === 1 &&
		outcome.authorization.consumed === 1 &&
		outcome.authorization.dispatchModel === "openai/gpt-5.6-terra" &&
		outcome.authorization.dispatchKind === "command" &&
		outcome.authorization.models.includes("openai/gpt-5.6-sol") &&
		Date.parse(outcome.authorization.dispatchAt) <
			Date.parse(outcome.authorization.expiresAt),
	"bounded dispatch record",
);
assert(
	outcome.remedy.attempt === 3 &&
		outcome.remedy.state === "completed" &&
		outcome.remedy.independentFeatureReview.verdict === "passed" &&
		outcome.remedy.independentFeatureReview.findingCount === 0 &&
		outcome.continuation.state === "active" &&
		outcome.continuation.independentFeatureReview === "pending" &&
		outcome.continuation.observedDesktopImageUrls === 14 &&
		outcome.continuation.recordedBaselineImageUrls === 54 &&
		outcome.qualification.independentDecisionLabel === "pending" &&
		outcome.qualification.typedManagerProposalAtCheckpoint === false &&
		outcome.qualification.jevCalled === false &&
		outcome.qualification.acceptedCaseCount === 0 &&
		outcome.qualification.pairedEpisodeCount === 0,
	"review outcome and qualification limits",
);

const privateRoot = process.env.FLOW_SIGNAL_ATLAS_RETRY_PRIVATE_ROOT;
if (privateRoot) {
	const files = [
		["final-session.json", outcome.privateEvidence.finalSessionSha256],
		[
			"retry-private/snapshots/revision-00010.json",
			outcome.privateEvidence.checkpointSnapshotSha256,
		],
		[
			"retry-private/snapshots/revision-00017.json",
			outcome.privateEvidence.passedReviewSnapshotSha256,
		],
		[
			"retry-dispatch/authorization.json",
			outcome.privateEvidence.authorizationSha256,
		],
		["retry-dispatch/dispatch-0.json", outcome.privateEvidence.dispatchSha256],
	] as const;
	for (const [name, digest] of files)
		assert(sha(await readFile(join(privateRoot, name))) === digest, name);

	const session = JSON.parse(await readFile(join(privateRoot, "final-session.json"), "utf8"));
	const authorization = JSON.parse(
		await readFile(join(privateRoot, "retry-dispatch/authorization.json"), "utf8"),
	);
	const dispatch = JSON.parse(
		await readFile(join(privateRoot, "retry-dispatch/dispatch-0.json"), "utf8"),
	);
	const remedy = session.runs.find(
		(run: { id: string }) => run.id === outcome.remedy.runId,
	);
	const review = remedy?.reviews.find(
		(row: { id: string }) => row.id === outcome.remedy.independentFeatureReview.id,
	);
	const continuation = session.runs.find(
		(run: { featureId: string }) => run.featureId === outcome.continuation.featureId,
	);
	const passedValidation = continuation?.validations.find(
		(row: { id: string }) => row.id === outcome.continuation.fullGateValidationId,
	);
	const focusedValidation = continuation?.validations.find(
		(row: { id: string }) => row.id === outcome.continuation.focusedValidationId,
	);
	assert(
		session.revision === outcome.continuation.recordedRevision &&
		remedy?.state === "completed" &&
		remedy.attempt === outcome.remedy.attempt &&
		review?.result?.verdict === "passed" &&
		review.result.findings.length === 0 &&
		review.sourceDigest === outcome.remedy.sourceDigest &&
		review.result.recordedRevision === outcome.remedy.independentFeatureReview.recordedRevision &&
		outcome.remedy.passedValidationIds.every((id: string) =>
			remedy.validations.some(
				(row: { id: string; exitCode: number; outputComplete: boolean; sourceDigest: string }) =>
					row.id === id && row.exitCode === 0 && row.outputComplete &&
					row.sourceDigest === review.sourceDigest,
			),
		) &&
		continuation.state === "active" &&
		continuation.reviews.length === 0 &&
		passedValidation?.exitCode === 0 &&
		passedValidation.outputComplete === true &&
		focusedValidation?.exitCode === 0 &&
		focusedValidation.outputComplete === true &&
		passedValidation.sourceDigest === outcome.continuation.sourceDigest &&
		focusedValidation.sourceDigest === outcome.continuation.sourceDigest,
		"private Flow review and current-source validation",
	);
	assert(
		JSON.stringify(authorization.models) === JSON.stringify(outcome.authorization.models) &&
		authorization.purpose === outcome.authorization.purpose &&
		authorization.maxDispatches === outcome.authorization.maxDispatches &&
		authorization.expiresAt === outcome.authorization.expiresAt &&
		dispatch.model === outcome.authorization.dispatchModel &&
		dispatch.kind === outcome.authorization.dispatchKind &&
		dispatch.at === outcome.authorization.dispatchAt,
		"private authorization and dispatch",
	);
}

console.log(
	JSON.stringify({
		verdict: privateRoot ? "verified-private-retry-outcome" : "verified-public-retry-bindings",
		remedyReview: outcome.remedy.independentFeatureReview.verdict,
		continuationReview: outcome.continuation.independentFeatureReview,
		qualification: "none",
	}),
);
