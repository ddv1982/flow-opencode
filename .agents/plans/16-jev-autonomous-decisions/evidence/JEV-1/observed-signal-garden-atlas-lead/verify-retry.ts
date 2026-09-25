import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionSchema } from "../../../../../../src/application/schema.js";
import { isValidationEligible } from "../../../../../../src/domain/validation.js";

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
const normalization = JSON.parse(
	await readFile(new URL("normalization.json", directory), "utf8"),
);
const provenanceBytes = await readFile(
	new URL("source-provenance.json", directory),
);
const provenance = JSON.parse(provenanceBytes.toString("utf8"));
const baselineBytes = await readFile(new URL("task-baseline.json", directory));
const baseline = JSON.parse(baselineBytes.toString("utf8"));
const baselineNetworkBytes = await readFile(
	new URL("baseline-network-comparison.json", directory),
);
const baselineNetwork = JSON.parse(baselineNetworkBytes.toString("utf8"));
const baselineNetworkArm = baselineNetwork.reports.find(
	(row: { arm: string }) => row.arm === "baseline",
);
const focusedAtlasGate = "pnpm lint && pnpm test";
const broadAtlasGate =
	"pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e --project=chromium && pnpm e2e:mobile-smoke";
const browserGate =
	"pnpm exec playwright test e2e/garden-loop.spec.ts --project=chromium";

assert(
	outcome.classification === "observed-remedy-outcome-not-qualification" &&
		outcome.sourceReference === lead.snapshot.provenance.sourceReference &&
		outcome.checkpointRevision === lead.snapshot.session.revision &&
		outcome.checkpointSourceDigest === lead.snapshot.sourceDigest &&
		outcome.originatingTaskId === lead.snapshot.provenance.originatingTaskId &&
		outcome.independenceGroupId ===
			lead.snapshot.provenance.independenceGroupId &&
		outcome.remedy.candidateId === lead.snapshot.proposal.candidates[0]?.id &&
		outcome.remedy.featureId === "theme-runtime-atlases" &&
		outcome.remedy.featureId ===
			lead.snapshot.proposal.candidates[0]?.featureId,
	"checkpoint and proposed remedy binding",
);
assert(
	outcome.authorization.maxDispatches === 1 &&
		outcome.authorization.consumed === 1 &&
		outcome.authorization.causalLinkToFlowSession ===
			"not-established-by-this-record" &&
		outcome.authorization.dispatchModel === "openai/gpt-5.6-terra" &&
		outcome.authorization.dispatchKind === "command" &&
		outcome.authorization.models.includes(outcome.authorization.dispatchModel) &&
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
		sha(provenanceBytes) ===
			"db480bf30866add218179bc30394e082ed817b1b718e2f00ef724bdb12776441" &&
		sha(baselineBytes) === provenance.baselineSha256 &&
		baseline.sourceHead === provenance.baseHead &&
		sha(baselineNetworkBytes) ===
			"9f7b4263a43920f1fa7a7fb496830d646a7d83f4baf97896639b79054b33d7bd" &&
		baselineNetwork.baselineHead === baseline.sourceHead &&
		baselineNetwork.browserVersion ===
			baseline.browserBaseline.browserVersion &&
		baselineNetworkArm.networkImageResponses ===
			baseline.browserBaseline.networkImageResponses &&
		baselineNetworkArm.uniqueImageUrls ===
			outcome.continuation.recordedBaselineUniqueImageUrls &&
		baselineNetworkArm.paths.length === baselineNetworkArm.uniqueImageUrls &&
		new Set(baselineNetworkArm.paths).size ===
			baselineNetworkArm.uniqueImageUrls &&
		outcome.continuation.recordedBaselineImageResponses ===
			baselineNetworkArm.networkImageResponses &&
		outcome.continuation.correctedAssertionExecution ===
			"not-established-by-this-record" &&
		outcome.qualification.decisionLabelEvidence === "not-in-this-record" &&
		outcome.qualification.typedManagerProposalAtCheckpoint === false &&
		normalization.status ===
			"author-normalized-from-manager-prose-unreviewed" &&
		outcome.qualification.jevActivity === "not-assessed-by-this-record" &&
		outcome.qualification.acceptedCasesContributedByThisRecord === 0 &&
		outcome.qualification.pairedEpisodesContributedByThisRecord === 0,
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

	const session = SessionSchema.parse(
		JSON.parse(await readFile(join(privateRoot, "final-session.json"), "utf8")),
	);
	const checkpoint = SessionSchema.parse(
		JSON.parse(
			await readFile(
				join(privateRoot, "retry-private/snapshots/revision-00010.json"),
				"utf8",
			),
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
	const dispatchFiles = (await readdir(join(privateRoot, "retry-dispatch")))
		.filter((name) => /^dispatch-\d+\.json$/.test(name))
		.sort();
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
	const e2ePatch = sourcePatch
		.split("diff --git a/e2e/garden-loop.spec.ts b/e2e/garden-loop.spec.ts")[1]
		?.split("\ndiff --git ")[0];
	const addedE2eLines = e2ePatch?.split("\n") ?? [];
	const measurementStart = addedE2eLines.findIndex((line) =>
		/^\+  test\('loads the bounded atlas garden image set after onboarding',/.test(
			line,
		),
	);
	const measurementEnd = addedE2eLines.findIndex(
		(line, index) => index > measurementStart && line === "+  });",
	);
	const measurementBody = addedE2eLines.slice(
		measurementStart + 1,
		measurementEnd,
	);
	const responseStart = measurementBody.indexOf(
		"+    page.on('response', (response) => {",
	);
	const responseEnd = measurementBody.indexOf("+    });", responseStart + 1);
	const responseBody = measurementBody.slice(responseStart + 1, responseEnd);
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
	const failureHeaders = [
		...(failedOutput?.body.matchAll(/^\s+\d+\) \[chromium\] › /gm) ?? []),
	];
	const namedFailureHeader = failedOutput?.body.match(
		/^\s+1\) \[chromium\] › e2e\/garden-loop\.spec\.ts:\d+:\d+ › garden-first lens journey › loads the bounded atlas garden image set after onboarding\s*$/m,
	);
	const namedFailureBlock =
		namedFailureHeader && failedOutput?.body
			? failedOutput.body.slice(
					namedFailureHeader.index,
					failedOutput.body.indexOf("\n  1 failed", namedFailureHeader.index),
				)
			: null;
	const receivedValues = [
		...(namedFailureBlock?.matchAll(/^\s+Received: (\d+)\s*$/gm) ?? []),
	];
	const assertionErrors = [
		...(namedFailureBlock?.matchAll(
			/^\s+Error: expect\(received\)\.toBe\(expected\)/gm,
		) ?? []),
	];
	const passedMeasurementLines =
		passedOutput?.body
			.split("\n")
			.filter((line) =>
				line.includes(
					"loads the bounded atlas garden image set after onboarding",
				),
			) ?? [];
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
			remedy.featureId === outcome.remedy.featureId &&
			remedy.attempt === outcome.remedy.attempt &&
			review?.result?.verdict === "passed" &&
			review.kind === "feature" &&
			review.featureId === outcome.remedy.featureId &&
			review.runId === remedy.id &&
			JSON.stringify([...review.validationIds].sort()) ===
				JSON.stringify([...outcome.remedy.passedValidationIds].sort()) &&
			review.result.findings.length === 0 &&
			review.result.terminalDisposition === "submitted" &&
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
						isValidationEligible(row, review.sourceDigest),
				),
			) &&
			continuation.state === "active" &&
			continuation.reviews.length === 0 &&
			continuation.startedRevision > review.result.recordedRevision &&
			firstMeasurement?.command === browserGate &&
			firstMeasurement.scope === "focused" &&
			firstMeasurement.exitCode === 1 &&
			firstMeasurement.outputComplete === true &&
			firstMeasurement.ineligibleReason === undefined &&
			firstMeasurement.recordedRevision > review.result.recordedRevision &&
			firstMeasurement.recordedRevision < focusedValidation?.recordedRevision &&
			passedValidation?.exitCode === 0 &&
			focusedValidation.recordedRevision <= passedValidation.recordedRevision &&
			isValidationEligible(
				passedValidation,
				outcome.continuation.sourceDigest,
			) &&
			passedValidation.command === broadAtlasGate &&
			passedValidation.scope === "broad" &&
			passedValidation.outputComplete === true &&
			focusedValidation?.exitCode === 0 &&
			isValidationEligible(
				focusedValidation,
				outcome.continuation.sourceDigest,
			) &&
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
			failureHeaders.length === 1 &&
			namedFailureHeader !== null &&
			failedOutput?.body.includes("\n  1 failed\n") &&
			assertionErrors.length === 1 &&
			receivedValues.length === 1 &&
			namedFailureBlock?.includes("Expected: 9") &&
			/^\s*>\s*\d+ \|\s*await expect\.poll\(\(\) => imageUrls\.size\)\.toBe\(9\);\s*$/m.test(
				namedFailureBlock ?? "",
			) &&
			Number(receivedValues[0][1]) ===
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
			passedMeasurementLines.length === 1 &&
			/^\s*✓\s+\d+ \[chromium\] › e2e\/garden-loop\.spec\.ts:\d+:\d+ › garden-first lens journey › loads the bounded atlas garden image set after onboarding \([\d.]+s\)$/.test(
				passedMeasurementLines[0],
			) &&
			passedOutput?.receipt.id === focusedValidation.id &&
			passedOutput.receipt.passed === true &&
			`sha256:${sha(Buffer.from(passedOutput.body))}` ===
				focusedValidation.outputDigest &&
			sourceManifest.revision === 21 &&
			sourceManifest.stable === true &&
			sourceManifest.sourceDigestBefore === passedValidation.sourceDigest &&
			sourceManifest.sourceDigestAfter === passedValidation.sourceDigest &&
			sourceManifest.trackedPatchSha256 === sha(Buffer.from(sourcePatch)) &&
			measurementStart >= 0 &&
			measurementEnd > measurementStart &&
			measurementBody.includes("+    const imageUrls = new Set<string>();") &&
			measurementBody.includes(
				"+    const appOrigin = new URL(page.url()).origin;",
			) &&
			responseStart >= 0 &&
			responseEnd > responseStart &&
			responseBody.includes("+      const url = new URL(response.url());") &&
			responseBody.includes(
				"+      if (url.origin === appOrigin && /\\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname)) {",
			) &&
			responseBody.includes("+        imageUrls.add(url.href);") &&
			measurementBody.filter((line) => line.includes("imageUrls.add("))
				.length === 1 &&
			measurementBody.filter((line) => line.includes("imageUrls")).length ===
				3 &&
			e2ePatch !== undefined &&
			!e2ePatch.includes("/*") &&
			!e2ePatch.includes("*/") &&
			!e2ePatch.includes("`") &&
			measurementBody.every(
				(line) =>
					!line.includes("/*") && !line.includes("*/") && !line.includes("`"),
			) &&
			measurementBody.some((line) =>
				/^\+    await expect\.poll\(\(\) => imageUrls\.size\)\.toBe\(14\);$/.test(
					line,
				),
			),
		"observed measurement, source assertion, and passing named test; assertion execution unproven",
	);
	assert(
		JSON.stringify(authorization.models) ===
			JSON.stringify(outcome.authorization.models) &&
			authorization.purpose === outcome.authorization.purpose &&
			authorization.maxDispatches === outcome.authorization.maxDispatches &&
			dispatchFiles.length === outcome.authorization.consumed &&
			dispatchFiles.length === authorization.maxDispatches &&
			dispatchFiles[0] === "dispatch-0.json" &&
			authorization.expiresAt === outcome.authorization.expiresAt &&
			dispatch.model === outcome.authorization.dispatchModel &&
			authorization.models.includes(dispatch.model) &&
			dispatch.kind === outcome.authorization.dispatchKind &&
			dispatch.at === outcome.authorization.dispatchAt,
		"private authorization and dispatch",
	);
}

console.log(
	JSON.stringify({
		verdict: privateRoot
			? "verified-private-evidence-bindings"
			: "verified-public-retry-bindings",
		remedyReview: outcome.remedy.independentFeatureReview.verdict,
		continuationReview: outcome.continuation.independentFeatureReview,
		qualification: "no-qualification-claim",
	}),
);
