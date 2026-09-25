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
const lead = JSON.parse(
	await readFile(new URL("draft.json", directory), "utf8"),
);
const focusedAtlasGate = "pnpm lint && pnpm test";
const broadAtlasGate =
	"pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e --project=chromium && pnpm e2e:mobile-smoke";
const browserGate =
	"pnpm exec playwright test e2e/garden-loop.spec.ts --project=chromium";

assert(
	outcome.classification === "observed-remedy-outcome-not-qualification" &&
		outcome.checkpointRevision === lead.snapshot.session.revision &&
		outcome.checkpointSourceDigest === lead.snapshot.sourceDigest &&
		outcome.originatingTaskId === lead.snapshot.provenance.originatingTaskId &&
		outcome.independenceGroupId ===
			lead.snapshot.provenance.independenceGroupId &&
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
		outcome.remedy.passedValidationIds.length === 2 &&
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
		[
			"measurement-failed-part.json",
			outcome.privateEvidence.failedMeasurementPartSha256,
		],
		[
			"measurement-passed-part.json",
			outcome.privateEvidence.passedMeasurementPartSha256,
		],
		[
			"retry-private/source-snapshots/revision-00021/manifest.json",
			outcome.privateEvidence.finalSourceManifestSha256,
		],
		[
			"retry-private/source-snapshots/revision-00021/tracked.patch",
			outcome.privateEvidence.finalSourcePatchSha256,
		],
	] as const;
	for (const [name, digest] of files)
		assert(sha(await readFile(join(privateRoot, name))) === digest, name);

	const session = JSON.parse(
		await readFile(join(privateRoot, "final-session.json"), "utf8"),
	);
	const checkpoint = JSON.parse(
		await readFile(
			join(privateRoot, "retry-private/snapshots/revision-00010.json"),
			"utf8",
		),
	);
	const authorization = JSON.parse(
		await readFile(
			join(privateRoot, "retry-dispatch/authorization.json"),
			"utf8",
		),
	);
	const dispatch = JSON.parse(
		await readFile(join(privateRoot, "retry-dispatch/dispatch-0.json"), "utf8"),
	);
	const remedy = session.runs.find(
		(run: { id: string }) => run.id === outcome.remedy.runId,
	);
	const review = remedy?.reviews.find(
		(row: { id: string }) =>
			row.id === outcome.remedy.independentFeatureReview.id,
	);
	const continuation = session.runs.find(
		(run: { featureId: string }) =>
			run.featureId === outcome.continuation.featureId,
	);
	const passedValidation = continuation?.validations.find(
		(row: { id: string }) =>
			row.id === outcome.continuation.fullGateValidationId,
	);
	const focusedValidation = continuation?.validations.find(
		(row: { id: string }) =>
			row.id === outcome.continuation.focusedValidationId,
	);
	const firstMeasurement = continuation?.validations.find(
		(row: { id: string }) =>
			row.id === outcome.continuation.firstMeasurementValidationId,
	);
	const failedPart = JSON.parse(
		await readFile(join(privateRoot, "measurement-failed-part.json"), "utf8"),
	);
	const passedPart = JSON.parse(
		await readFile(join(privateRoot, "measurement-passed-part.json"), "utf8"),
	);
	const sourceManifest = JSON.parse(
		await readFile(
			join(
				privateRoot,
				"retry-private/source-snapshots/revision-00021/manifest.json",
			),
			"utf8",
		),
	);
	const sourcePatch = await readFile(
		join(
			privateRoot,
			"retry-private/source-snapshots/revision-00021/tracked.patch",
		),
		"utf8",
	);
	const validationOutput = (output: string) => {
		const match = output.match(/\n\n\[flow-validation\] (\{[^\n]+\})$/);
		return match
			? {
					body: output.slice(0, match.index),
					receipt: JSON.parse(match[1]),
				}
			: null;
	};
	const failedOutput = validationOutput(failedPart.state.output);
	const passedOutput = validationOutput(passedPart.state.output);
	const expectedRemedyGates = [
		{ command: focusedAtlasGate, scope: "focused" },
		{ command: broadAtlasGate, scope: "broad" },
	];
	assert(
		session.id === lead.snapshot.session.id &&
			checkpoint.id === session.id &&
			checkpoint.revision === outcome.checkpointRevision &&
			JSON.stringify(checkpoint) === JSON.stringify(lead.snapshot.session) &&
			session.revision === outcome.continuation.recordedRevision &&
			remedy?.state === "completed" &&
			remedy.attempt === outcome.remedy.attempt &&
			review?.result?.verdict === "passed" &&
			review.result.findings.length === 0 &&
			review.sourceDigest === outcome.remedy.sourceDigest &&
			review.result.recordedRevision ===
				outcome.remedy.independentFeatureReview.recordedRevision &&
			outcome.remedy.passedValidationIds.every((id: string, index: number) =>
				remedy.validations.some(
					(row: {
						id: string;
						command: string;
						scope: string;
						exitCode: number;
						outputComplete: boolean;
						sourceDigest: string;
					}) =>
						row.id === id &&
						row.command === expectedRemedyGates[index].command &&
						row.scope === expectedRemedyGates[index].scope &&
						row.exitCode === 0 &&
						row.outputComplete &&
						row.sourceDigest === review.sourceDigest,
				),
			) &&
			continuation.state === "active" &&
			continuation.reviews.length === 0 &&
			firstMeasurement?.command === browserGate &&
			firstMeasurement.scope === "focused" &&
			firstMeasurement.exitCode === 1 &&
			passedValidation?.exitCode === 0 &&
			passedValidation.command === broadAtlasGate &&
			passedValidation.scope === "broad" &&
			passedValidation.outputComplete === true &&
			focusedValidation?.exitCode === 0 &&
			focusedValidation.command === browserGate &&
			focusedValidation.scope === "focused" &&
			focusedValidation.outputComplete === true &&
			passedValidation.sourceDigest === outcome.continuation.sourceDigest &&
			focusedValidation.sourceDigest === outcome.continuation.sourceDigest,
		"private Flow review and current-source validation",
	);
	assert(
		failedPart.type === "tool" &&
			failedPart.tool === "bash" &&
			failedPart.state.input.command === browserGate &&
			failedPart.state.metadata.exit === 1 &&
			failedPart.state.output.includes(
				"loads the bounded atlas garden image set after onboarding",
			) &&
			Number(failedOutput?.body.match(/Received: (\d+)/)?.[1]) ===
				outcome.continuation.observedDesktopImageUrls &&
			failedOutput?.receipt.id === firstMeasurement.id &&
			failedOutput.receipt.passed === false &&
			`sha256:${sha(Buffer.from(failedOutput.body))}` ===
				firstMeasurement.outputDigest &&
			passedPart.type === "tool" &&
			passedPart.tool === "bash" &&
			passedPart.state.input.command === browserGate &&
			passedPart.state.metadata.exit === 0 &&
			passedPart.state.output.includes("32 passed") &&
			passedOutput?.receipt.id === focusedValidation.id &&
			passedOutput.receipt.passed === true &&
			`sha256:${sha(Buffer.from(passedOutput.body))}` ===
				focusedValidation.outputDigest &&
			sourceManifest.revision === 21 &&
			sourceManifest.stable === true &&
			sourceManifest.sourceDigestBefore === passedValidation.sourceDigest &&
			sourceManifest.sourceDigestAfter === passedValidation.sourceDigest &&
			sourceManifest.trackedPatchSha256 === sha(Buffer.from(sourcePatch)) &&
			sourcePatch.includes(
				"diff --git a/e2e/garden-loop.spec.ts b/e2e/garden-loop.spec.ts",
			) &&
			sourcePatch.includes("toBe(14)"),
		"observed measurement and passing assertion at the validated source",
	);
	assert(
		JSON.stringify(authorization.models) ===
			JSON.stringify(outcome.authorization.models) &&
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
		verdict: privateRoot
			? "verified-private-retry-outcome"
			: "verified-public-retry-bindings",
		remedyReview: outcome.remedy.independentFeatureReview.verdict,
		continuationReview: outcome.continuation.independentFeatureReview,
		qualification: "none",
	}),
);
