import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const read = (path) => readFileSync(join(directory, path));
const json = (path) => JSON.parse(read(path).toString("utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const percentile = (values, percentileRank) => {
	const ordered = [...values].sort((a, b) => a - b);
	return ordered[
		Math.max(0, Math.ceil((percentileRank / 100) * ordered.length) - 1)
	];
};
const median = (values) => {
	const ordered = [...values].sort((a, b) => a - b);
	const middle = Math.floor(ordered.length / 2);
	return ordered.length % 2 === 0
		? (ordered[middle - 1] + ordered[middle]) / 2
		: ordered[middle];
};
const close = (actual, expected) =>
	assert.ok(Math.abs(actual - expected) < 0.000001);
const validCost = (value) =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

const receipt = json("receipt.json");
assert.equal(receipt.schemaVersion, 1);
const recordedFiles = Object.keys(receipt.files).sort();
const actualFiles = readdirSync(join(directory, "campaign"))
	.map((name) => `campaign/${name}`)
	.sort();
const expectedFiles = [
	"campaign/manifest.json",
	"campaign/summary.json",
	...Array.from(
		{ length: 8 },
		(_, index) => `campaign/case-${String(index + 1).padStart(6, "0")}.json`,
	),
	...Array.from(
		{ length: 6 },
		(_, index) => `campaign/attempt-${String(index + 1).padStart(6, "0")}.json`,
	),
].sort();
assert.deepEqual(actualFiles, expectedFiles, "Unexpected campaign file set");
assert.deepEqual(recordedFiles, expectedFiles, "Unexpected receipt file set");
assert.deepEqual(
	actualFiles,
	recordedFiles,
	"Campaign file set differs from the receipt",
);
for (const [path, digest] of Object.entries(receipt.files)) {
	assert.equal(sha256(read(path)), digest, `Changed evidence: ${path}`);
}

const manifest = json("campaign/manifest.json");
const summary = json("campaign/summary.json");
assert.equal(
	receipt.purpose,
	"Pinned live shadow-latency diagnostic on eight synthetic development cases; performance evidence only",
);
assert.equal(manifest.schemaVersion, 1);
assert.equal(summary.schemaVersion, 1);
assert.equal(manifest.preparation.schemaVersion, 1);
assert.equal(receipt.sourceHead.length, 40);
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	encoding: "utf8",
}).trim();
process.chdir(repositoryRoot);
const { recoverySourceDigests } = await import(
	pathToFileURL(join(repositoryRoot, "evals/recovery-decisions/sources.ts"))
		.href
);
const { CorpusSchema, digest } = await import(
	pathToFileURL(join(repositoryRoot, "evals/recovery-decisions/schema.ts")).href
);
const { evaluateRecoveryCorpus } = await import(
	pathToFileURL(join(repositoryRoot, "evals/recovery-decisions/evaluate.ts"))
		.href
);
const { AdviceSchema } = await import(
	pathToFileURL(join(repositoryRoot, "evals/recovery-decisions/compare.ts"))
		.href
);
const { JEV_ATTEMPT_RESERVATION_USD } = await import(
	pathToFileURL(
		join(repositoryRoot, "src/application/ports/decision-provider.ts"),
	).href
);
const selectedSources = await recoverySourceDigests();
assert.equal(
	receipt.sourceHead,
	"764779645168bcbbb80ed2d0421c98a3de5dfbff",
	"The diagnostic source differs from the approved and documented run",
);
assert.deepEqual(
	Object.keys(manifest.sourceDigests).sort(),
	Object.keys(selectedSources).sort(),
	"Incomplete pinned-source digest set",
);
for (const [path, digest] of Object.entries(manifest.sourceDigests)) {
	const bytes = execFileSync("git", ["show", `${receipt.sourceHead}:${path}`]);
	assert.equal(sha256(bytes), digest, `Source mismatch: ${path}`);
	assert.equal(
		selectedSources[path],
		digest,
		`Current source mismatch: ${path}`,
	);
}
assert.equal(manifest.origin, "live");
assert.equal(manifest.controllerMode, "shadow");
assert.equal(manifest.model, "jev-1.13.0");
assert.equal(manifest.rubric, "recovery-v1");
assert.equal(manifest.policy, "bounded-recovery-v1");
assert.equal(manifest.qualification, "inconclusive");
assert.equal(manifest.registrationDigest, null);
assert.equal(receipt.approval.model, `typesafe/${manifest.model}`);
assert.equal(receipt.approval.dispatches, 1);
assert.equal(receipt.approval.maxAttempts, 24);
assert.equal(receipt.approval.maxUsd, 0.1);
assert.equal(receipt.approval.expiresAt, "2026-09-27T03:00:00Z");
assert.equal(
	validCost(receipt.approval.maxUsd) && receipt.approval.maxUsd > 0,
	true,
);
assert.equal(
	Number.isSafeInteger(receipt.approval.maxAttempts) &&
		receipt.approval.maxAttempts > 0,
	true,
);
const corpus = CorpusSchema.parse(manifest.corpus);
assert.equal(digest(corpus), manifest.corpusDigest);
assert.equal(
	manifest.corpusDigest,
	"4ee3bca9e450d33a38009d08eedb4e316ffc2a14f821daf009571abf58c6e20f",
);
assert.deepEqual(
	JSON.parse(JSON.stringify(await evaluateRecoveryCorpus(corpus))),
	manifest.preparation,
	"Offline preparation differs from the retained corpus",
);
assert.equal(manifest.preparation.corpusDigest, manifest.corpusDigest);
assert.equal(manifest.corpusDigest, summary.corpusDigest);
assert.equal(manifest.corpus.purpose, summary.purpose);
assert.equal(manifest.corpus.labelStatus, summary.labelStatus);
assert.equal(manifest.maxCalls, receipt.approval.maxAttempts);
assert.equal(manifest.maxUsd, receipt.approval.maxUsd);
assert.equal(validCost(manifest.attemptReservationUsd), true);
close(manifest.attemptReservationUsd, JEV_ATTEMPT_RESERVATION_USD);
assert.equal(manifest.attemptReservationUsd > 0, true);
assert.equal(
	Date.parse(manifest.createdAt) < Date.parse(receipt.approval.expiresAt),
	true,
);
assert.equal(summary.status, "complete");
assert.equal(summary.origin, "live");
assert.equal(summary.registrationDigest, null);
assert.equal(summary.purpose, "synthetic-development");
assert.equal(summary.labelStatus, "author-proposed-unreviewed");
assert.equal(summary.qualification, "inconclusive");
assert.equal(summary.plannedCases, 8);
assert.equal(summary.plannedCases, corpus.cases.length);
assert.equal(manifest.preparation.rows.length, corpus.cases.length);
assert.equal(summary.completedCases, 8);
assert.equal(summary.completedCases, summary.plannedCases);
assert.equal(summary.rows.length, 8);
assert.equal(summary.maxCalls, manifest.maxCalls);
assert.equal(summary.maxUsd, manifest.maxUsd);
assert.equal(summary.calls, 6);
assert.equal(summary.calls <= receipt.approval.maxAttempts, true);
assert.equal(summary.reservedUsd <= receipt.approval.maxUsd, true);
assert.equal(validCost(summary.reservedUsd), true);
assert.equal(validCost(receipt.accounting.reservedUsd), true);
assert.equal(summary.reservedUsd, receipt.accounting.reservedUsd);
close(summary.reservedUsd, 0.016128);
assert.equal(
	receipt.accounting.basis,
	"conservative local reservation; provider invoice unavailable",
);
assert.equal(
	summary.reservationAccounting,
	"conservative-reservations-not-invoice",
);
assert.equal(summary.usageScope, "answered-responses-only");

let totalAttempts = 0;
let totalReservedUsd = 0;
let inputTokens = 0;
let outputTokens = 0;
const providerLatency = [];
const controllerLatency = [];
for (const [index, row] of summary.rows.entries()) {
	const number = String(index + 1).padStart(6, "0");
	assert.deepEqual(json(`campaign/case-${number}.json`), row);
	assert.equal(row.schemaVersion, 1);
	assert.equal(row.origin, "live");
	assert.equal(validCost(row.reservedUsd), true);
	assert.equal(
		typeof row.latencyMs === "number" &&
			Number.isFinite(row.latencyMs) &&
			row.latencyMs >= 0,
		true,
	);
	assert.equal(row.id, corpus.cases[index].id);
	assert.deepEqual(row.packet, manifest.preparation.rows[index].packet);
	assert.equal(row.packetDigest, row.packet ? digest(row.packet) : null);
	assert.equal(row.packetDigest, manifest.preparation.rows[index].packetDigest);
	assert.equal(
		row.eligibilityMatches,
		manifest.preparation.rows[index].eligibilityMatches,
	);
	assert.equal(row.rejection, manifest.preparation.rows[index].rejection);
	totalAttempts += row.attempts;
	totalReservedUsd += row.reservedUsd;
	if (row.attempts === 0) {
		assert.equal(row.advice, null);
		assert.equal(row.packet, null);
		assert.equal(row.decision, null);
		assert.equal(row.labelMatches, null);
		assert.equal(row.reservedUsd, 0);
		continue;
	}
	assert.equal(row.attempts, 1);
	close(row.reservedUsd, manifest.attemptReservationUsd);
	assert.equal(row.advice.kind, "answered");
	assert.equal(row.advice.model, "jev-1.13.0");
	AdviceSchema.parse(row.advice);
	const candidateIds = row.packet.candidates.map((candidate) => candidate.id);
	const answerIds = [...candidateIds, "abstain"];
	assert.deepEqual(
		Object.keys(row.advice.probabilities).sort(),
		answerIds.sort(),
	);
	assert.deepEqual(
		Object.keys(row.advice.assessments).sort(),
		candidateIds.sort(),
	);
	assert.equal(answerIds.includes(row.advice.choice), true);
	assert.equal(
		Math.abs(
			Object.values(row.advice.probabilities).reduce((a, b) => a + b, 0) - 1,
		) <= 1e-6,
		true,
	);
	assert.equal(
		row.advice.probabilities[row.advice.choice],
		Math.max(...Object.values(row.advice.probabilities)),
	);
	assert.equal(
		typeof row.advice.latencyMs === "number" &&
			Number.isFinite(row.advice.latencyMs) &&
			row.advice.latencyMs >= 0,
		true,
	);
	assert.equal(row.decision.mode, "shadow");
	assert.equal(row.decision.kind, "abstain");
	assert.equal(row.decision.packetDigest, row.packetDigest);
	assert.equal(row.decision.model, manifest.model);
	assert.equal(row.decision.requestedModel, manifest.model);
	assert.equal(row.decision.selectedCandidateId, null);
	assert.equal(row.decision.action, null);
	assert.equal(row.decision.featureId, null);
	assert.equal(row.latencyMs >= row.advice.latencyMs, true);
	assert.equal(
		row.labelMatches,
		corpus.cases[index].expected.acceptableSelections.includes("abstain"),
	);
	assert.equal(
		Number.isSafeInteger(row.advice.inputTokens) && row.advice.inputTokens >= 0,
		true,
	);
	assert.equal(
		Number.isSafeInteger(row.advice.outputTokens) &&
			row.advice.outputTokens >= 0,
		true,
	);
	inputTokens += row.advice.inputTokens;
	outputTokens += row.advice.outputTokens;
	providerLatency.push(row.advice.latencyMs);
	controllerLatency.push(row.latencyMs);
}
assert.equal(totalAttempts, 6);
assert.equal(totalAttempts, summary.calls);
assert.equal(totalAttempts, receipt.accounting.attempts);
close(totalReservedUsd, summary.reservedUsd);
const answeredRows = summary.rows.filter((row) => row.attempts > 0);
let replayIndex = 0;
const replay = await evaluateRecoveryCorpus(corpus, {
	async assess(packet, options) {
		assert.equal(options.reserveAttempt(), true);
		const row = answeredRows[replayIndex++];
		assert.ok(row);
		assert.equal(digest(packet), row.packetDigest);
		return row.advice;
	},
});
assert.equal(replayIndex, answeredRows.length);
for (const [index, row] of summary.rows.entries()) {
	assert.deepEqual(replay.rows[index].decision, row.decision);
	assert.equal(replay.rows[index].labelMatches, row.labelMatches);
	assert.equal(replay.rows[index].eligibilityMatches, row.eligibilityMatches);
	assert.equal(replay.rows[index].rejection, row.rejection);
}
let precedingReservation = 0;
let precedingAttemptAt = Date.parse(manifest.createdAt);
for (let index = 0; index < totalAttempts; index++) {
	const number = String(index + 1).padStart(6, "0");
	const attempt = json(`campaign/attempt-${number}.json`);
	assert.equal(attempt.schemaVersion, 1);
	assert.equal(attempt.calls, index + 1);
	assert.equal(attempt.caseId, answeredRows[index].id);
	assert.equal(attempt.packetDigest, answeredRows[index].packetDigest);
	assert.equal(
		Date.parse(attempt.at) < Date.parse(receipt.approval.expiresAt),
		true,
	);
	assert.equal(Date.parse(attempt.at) >= precedingAttemptAt, true);
	precedingAttemptAt = Date.parse(attempt.at);
	assert.equal(attempt.origin, "live");
	assert.equal(attempt.maxCalls, receipt.approval.maxAttempts);
	assert.equal(attempt.maxUsd, receipt.approval.maxUsd);
	assert.equal(validCost(attempt.reservedUsd), true);
	close(attempt.reservedUsd, (index + 1) * manifest.attemptReservationUsd);
	assert.equal(attempt.reservedUsd >= precedingReservation, true);
	assert.equal(attempt.reservedUsd <= receipt.approval.maxUsd, true);
	precedingReservation = attempt.reservedUsd;
}
close(json("campaign/attempt-000006.json").reservedUsd, summary.reservedUsd);
assert.equal(summary.inputTokens, receipt.usage.inputTokens);
assert.equal(summary.outputTokens, receipt.usage.outputTokens);
assert.equal(inputTokens, summary.inputTokens);
assert.equal(outputTokens, summary.outputTokens);
assert.equal(inputTokens, 4672);
assert.equal(outputTokens, 428);
for (const value of Object.values(receipt.latency)) {
	assert.equal(
		typeof value === "number" && Number.isFinite(value) && value >= 0,
		true,
	);
}
close(median(providerLatency), receipt.latency.providerP50Ms);
close(percentile(providerLatency, 95), receipt.latency.providerP95Ms);
close(median(controllerLatency), receipt.latency.controllerP50Ms);
close(percentile(controllerLatency, 95), receipt.latency.controllerP95Ms);
close(receipt.latency.providerP50Ms, 242.6344685);
close(receipt.latency.providerP95Ms, 636.308719);
close(receipt.latency.controllerP50Ms, 245.243914);
close(receipt.latency.controllerP95Ms, 639.880864);
assert.equal(
	providerLatency.every((value) => value < 10_000),
	true,
);

console.log(
	"Verified: 8 synthetic cases, 6 live Jev attempts, shadow-only decisions, receipt digests, local limits, and latency metrics.",
);
