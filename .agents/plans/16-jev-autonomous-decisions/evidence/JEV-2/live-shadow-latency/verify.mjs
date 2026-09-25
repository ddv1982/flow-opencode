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

const receipt = json("receipt.json");
const recordedFiles = Object.keys(receipt.files).sort();
const actualFiles = readdirSync(join(directory, "campaign"))
	.map((name) => `campaign/${name}`)
	.sort();
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
const selectedSources = await recoverySourceDigests();
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
assert.equal(receipt.approval.model, `typesafe/${manifest.model}`);
assert.equal(receipt.approval.dispatches, 1);
assert.equal(Number.isFinite(Date.parse(receipt.approval.expiresAt)), true);
const corpus = CorpusSchema.parse(manifest.corpus);
assert.equal(digest(corpus), manifest.corpusDigest);
assert.deepEqual(
	JSON.parse(JSON.stringify(await evaluateRecoveryCorpus(corpus))),
	manifest.preparation,
	"Offline preparation differs from the retained corpus",
);
assert.equal(manifest.preparation.corpusDigest, manifest.corpusDigest);
assert.equal(manifest.corpusDigest, summary.corpusDigest);
assert.equal(manifest.maxCalls, receipt.approval.maxAttempts);
assert.equal(manifest.maxUsd, receipt.approval.maxUsd);
assert.equal(
	Date.parse(manifest.createdAt) < Date.parse(receipt.approval.expiresAt),
	true,
);
assert.equal(summary.status, "complete");
assert.equal(summary.origin, "live");
assert.equal(summary.purpose, "synthetic-development");
assert.equal(summary.labelStatus, "author-proposed-unreviewed");
assert.equal(summary.qualification, "inconclusive");
assert.equal(summary.plannedCases, 8);
assert.equal(summary.completedCases, 8);
assert.equal(summary.rows.length, 8);
assert.equal(summary.calls, 6);
assert.equal(summary.calls <= receipt.approval.maxAttempts, true);
assert.equal(summary.reservedUsd <= receipt.approval.maxUsd, true);
assert.equal(summary.reservedUsd, receipt.accounting.reservedUsd);
assert.equal(
	summary.reservationAccounting,
	"conservative-reservations-not-invoice",
);

let totalAttempts = 0;
let totalReservedUsd = 0;
let inputTokens = 0;
let outputTokens = 0;
const providerLatency = [];
const controllerLatency = [];
for (const [index, row] of summary.rows.entries()) {
	const number = String(index + 1).padStart(6, "0");
	assert.deepEqual(json(`campaign/case-${number}.json`), row);
	assert.equal(row.origin, "live");
	assert.equal(row.id, corpus.cases[index].id);
	assert.deepEqual(row.packet, manifest.preparation.rows[index].packet);
	assert.equal(row.packetDigest, row.packet ? digest(row.packet) : null);
	assert.equal(row.packetDigest, manifest.preparation.rows[index].packetDigest);
	totalAttempts += row.attempts;
	totalReservedUsd += row.reservedUsd;
	if (row.attempts === 0) {
		assert.equal(row.advice, null);
		assert.equal(row.packet, null);
		assert.equal(row.reservedUsd, 0);
		continue;
	}
	assert.equal(row.attempts, 1);
	close(row.reservedUsd, manifest.attemptReservationUsd);
	assert.equal(row.advice.kind, "answered");
	assert.equal(row.advice.model, "jev-1.13.0");
	assert.equal(row.decision.mode, "shadow");
	assert.equal(row.decision.kind, "abstain");
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
let precedingReservation = 0;
for (let index = 0; index < totalAttempts; index++) {
	const number = String(index + 1).padStart(6, "0");
	const attempt = json(`campaign/attempt-${number}.json`);
	assert.equal(attempt.calls, index + 1);
	assert.equal(attempt.caseId, answeredRows[index].id);
	assert.equal(attempt.packetDigest, answeredRows[index].packetDigest);
	assert.equal(
		Date.parse(attempt.at) < Date.parse(receipt.approval.expiresAt),
		true,
	);
	assert.equal(attempt.origin, "live");
	assert.equal(attempt.maxCalls, receipt.approval.maxAttempts);
	assert.equal(attempt.maxUsd, receipt.approval.maxUsd);
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
close(median(providerLatency), receipt.latency.providerP50Ms);
close(percentile(providerLatency, 95), receipt.latency.providerP95Ms);
close(median(controllerLatency), receipt.latency.controllerP50Ms);
close(percentile(controllerLatency, 95), receipt.latency.controllerP95Ms);
assert.equal(
	providerLatency.every((value) => value < 10_000),
	true,
);

console.log(
	"Verified: 8 synthetic cases, 6 live Jev attempts, shadow-only decisions, receipt digests, local limits, and latency metrics.",
);
