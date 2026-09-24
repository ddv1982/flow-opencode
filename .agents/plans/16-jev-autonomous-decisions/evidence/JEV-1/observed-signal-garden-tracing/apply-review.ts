import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildReviewedCorpus,
	reviewSnapshot,
} from "../../../../../../evals/recovery-decisions/dataset.js";
import { evaluateRecoveryCorpus } from "../../../../../../evals/recovery-decisions/evaluate.js";
import {
	DraftSchema,
	datasetDigest,
	LabelSubmissionSchema,
} from "../../../../../../evals/recovery-decisions/schema.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
const read = async (name: string) =>
	JSON.parse(await readFile(join(directory, name), "utf8"));
const write = async (name: string, value: unknown) =>
	writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
const hash = (value: Uint8Array) =>
	createHash("sha256").update(value).digest("hex");

const draft = DraftSchema.parse(await read("draft.json"));
const labels = LabelSubmissionSchema.parse(
	(await read("label-proposal-unreviewed.json")).submission,
);
const independent = await read("independent-label-review.json");
const decision = independent.review;
const candidateId = draft.snapshot.proposal.candidates[0]?.id;
for (const [name, expected] of Object.entries(
	independent.inputFileSha256 as Record<string, string>,
)) {
	if (hash(await readFile(join(directory, name))) !== expected)
		throw new Error(`Reviewed input changed: ${name}`);
}
if (
	hash(await readFile(join(directory, "audit-source.ts"))) !==
	independent.auditSourceScriptSha256
)
	throw new Error("Reviewed source-audit code changed.");
const negativeChecks = await read("audit-negative-checks.json");
if (
	negativeChecks.auditScriptSha256 !== independent.auditSourceScriptSha256 ||
	!negativeChecks.checks.every(
		(row: { auditRejected: boolean }) => row.auditRejected === true,
	)
)
	throw new Error("Source-audit negative checks are incomplete.");
if (
	independent.model !== "openai/gpt-5.6-sol" ||
	independent.toolsAllowed !== false ||
	decision.verdict !== "approve" ||
	decision.sourceAuthenticity !== "sufficient" ||
	decision.candidateOutcome !== labels.candidateOutcomes[candidateId] ||
	JSON.stringify(decision.acceptableSelections) !==
		JSON.stringify(labels.expected.acceptableSelections)
)
	throw new Error("Independent review does not approve the proposed labels.");
const submission = {
	labels,
	review: {
		reviewedBy: "openai-gpt-5-6-sol-signal-label-review",
		reviewedAt: independent.reviewedAt,
		labelDigest: datasetDigest(labels),
		verdict: "approved" as const,
		notes: `${decision.rationale} Limitations: ${decision.limitations.join(" ")}`,
	},
};
const reviewedCase = reviewSnapshot(draft, submission);
const oneCaseCorpus = await buildReviewedCorpus([reviewedCase]);
const echoDirectory = join(directory, "..", "observed-echo-recording-gate");
const echoReceipt = JSON.parse(
	await readFile(join(echoDirectory, "review-receipt.json"), "utf8"),
);
for (const name of [
	"reviewed-case.json",
	"reviewed-calibration-corpus.json",
	"runtime-shadow-outcome.json",
	"decision-packet.json",
]) {
	if (!echoReceipt.files?.[name])
		throw new Error(`Echo receipt does not bind ${name}.`);
}
for (const [name, expected] of Object.entries(
	echoReceipt.files as Record<string, string>,
)) {
	if (name.includes("/") || name.includes(".."))
		throw new Error("Echo receipt contains an invalid file name.");
	if (hash(await readFile(join(echoDirectory, name))) !== expected)
		throw new Error(`Echo receipt digest differs: ${name}`);
}
const echoCase = JSON.parse(
	await readFile(join(echoDirectory, "reviewed-case.json"), "utf8"),
);
const echoCorpus = JSON.parse(
	await readFile(
		join(echoDirectory, "reviewed-calibration-corpus.json"),
		"utf8",
	),
);
const echoOutcome = JSON.parse(
	await readFile(join(echoDirectory, "runtime-shadow-outcome.json"), "utf8"),
);
const echoPacket = JSON.parse(
	await readFile(join(echoDirectory, "decision-packet.json"), "utf8"),
);
if (
	echoReceipt.classification !== "independently-reviewed-calibration-only" ||
	echoReceipt.caseId !== echoCase.id ||
	echoReceipt.corpusDigest !== datasetDigest(echoCorpus) ||
	echoOutcome.sourceRevision !== echoCase.session.revision ||
	echoPacket.sessionId !== echoCase.session.id ||
	echoPacket.sourceDigest !== echoCase.sourceDigest ||
	datasetDigest(echoOutcome.managerProposal) !==
		datasetDigest(echoCase.proposal) ||
	echoOutcome.recovery.packetDigest !==
		hash(Buffer.from(JSON.stringify(echoPacket)))
)
	throw new Error("Echo outcome is not bound to its reviewed source.");
const twoCaseCorpus = await buildReviewedCorpus([echoCase, reviewedCase]);
const preparation = await evaluateRecoveryCorpus(twoCaseCorpus);
if (!preparation.rows.every((row) => row.eligibilityMatches))
	throw new Error("Calibration labels disagree with controller eligibility.");
const signalOutcome = await read("runtime-shadow-outcome.json");
const outcomes = [
	{ case: echoCase, outcome: echoOutcome },
	{ case: reviewedCase, outcome: signalOutcome },
].map(({ case: row, outcome }) => {
	const observed =
		outcome.recovery.kind === "selected"
			? outcome.recovery.selectedCandidateId
			: outcome.recovery.kind === "abstain"
				? "abstain"
				: null;
	return {
		caseId: row.id,
		independenceGroupId: row.provenance.independenceGroupId,
		split: row.labels.split,
		observedSelection: observed,
		acceptable: observed
			? row.labels.expected.acceptableSelections.includes(observed)
			: false,
	};
});
const summary = {
	schemaVersion: 1,
	classification: "two-reviewed-calibration-cases-only",
	corpusDigest: preparation.corpusDigest,
	qualification: preparation.qualification,
	cases: outcomes,
	acceptableObservedSelections: outcomes.filter((row) => row.acceptable).length,
	qualifyingAcceptedActions: 0,
	limits: [
		"Both cases are calibration; no holdout has been reviewed or run.",
		"Only Jev shadow selections were observed. There is no paired manager-only decision arm or whole-episode comparison.",
		"Two independent tasks cannot support the per-action safety bound or delegated qualification.",
	],
};
await write("label-review-submission.json", submission);
await write("reviewed-case.json", reviewedCase);
await write("reviewed-calibration-corpus.json", oneCaseCorpus);
await write("two-case-calibration-corpus.json", twoCaseCorpus);
await write("two-case-calibration-summary.json", summary);
const manifestNames = [
	"README.md",
	"checkpoint.json",
	"manager-proposal.json",
	"decision-packet.json",
	"review-findings.json",
	"runtime-shadow-outcome.json",
	"source-provenance.json",
	"snapshot.json",
	"draft.json",
	"label-proposal-unreviewed.json",
	"raw-source-audit.json",
	"audit-source.ts",
	"build-draft.ts",
	"reconstruct-packet.ts",
	"apply-review.ts",
	"independent-label-review.json",
	"initial-review-inconclusive.json",
	"prior-review-before-audit-fix.json",
	"audit-negative-checks.json",
	"label-review-submission.json",
	"reviewed-case.json",
	"reviewed-calibration-corpus.json",
	"two-case-calibration-corpus.json",
	"two-case-calibration-summary.json",
	"related-variant.json",
];
const files = Object.fromEntries(
	await Promise.all(
		manifestNames.map(async (name) => [
			name,
			hash(await readFile(join(directory, name))),
		]),
	),
);
await write("review-receipt.json", {
	schemaVersion: 1,
	classification: "independently-reviewed-calibration-only",
	caseId: reviewedCase.id,
	corpusDigest: datasetDigest(oneCaseCorpus),
	files,
	limits: summary.limits,
});
process.stdout.write(
	`${JSON.stringify({ caseId: reviewedCase.id, corpusCases: twoCaseCorpus.cases.length, acceptableObservedSelections: summary.acceptableObservedSelections, qualification: summary.qualification })}\n`,
);
