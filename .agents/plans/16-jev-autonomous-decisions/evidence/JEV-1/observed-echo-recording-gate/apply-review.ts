import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildReviewedCorpus,
	reviewSnapshot,
} from "../../../../../../evals/recovery-decisions/dataset.js";
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
	const actual = createHash("sha256")
		.update(await readFile(join(directory, name)))
		.digest("hex");
	if (actual !== expected) throw new Error(`Reviewed input changed: ${name}`);
}
if (
	independent.model !== "openai/gpt-5.6-sol" ||
	decision.verdict !== "approve" ||
	decision.sourceAuthenticity !== "sufficient" ||
	decision.candidateOutcome !== labels.candidateOutcomes[candidateId] ||
	JSON.stringify(decision.acceptableSelections) !==
		JSON.stringify(labels.expected.acceptableSelections) ||
	independent.toolsAllowed !== false
)
	throw new Error("Independent review does not approve the proposed labels");

const submission = {
	labels,
	review: {
		reviewedBy: "openai-gpt-5-6-sol-label-review",
		reviewedAt: independent.reviewedAt,
		labelDigest: datasetDigest(labels),
		verdict: "approved" as const,
		notes: `${decision.rationale} Limitations: ${decision.limitations.join(" ")}`,
	},
};
const reviewedCase = reviewSnapshot(draft, submission);
const corpus = await buildReviewedCorpus([reviewedCase]);
await write("label-review-submission.json", submission);
await write("reviewed-case.json", reviewedCase);
await write("reviewed-calibration-corpus.json", corpus);
const manifestNames = [
	"checkpoint.json",
	"manager-proposal.json",
	"decision-packet.json",
	"review-findings.json",
	"runtime-shadow-outcome.json",
	"source-provenance.json",
	"snapshot.json",
	"draft.json",
	"label-proposal-unreviewed.json",
	"independent-label-review.json",
	"label-review-submission.json",
	"reviewed-case.json",
	"reviewed-calibration-corpus.json",
	"README.md",
	"reconstruct-packet.ts",
	"build-draft.ts",
	"apply-review.ts",
	"dataset-import.log",
	"receipt.json",
];
const fileDigests = Object.fromEntries(
	await Promise.all(
		manifestNames.map(async (name) => [
			name,
			createHash("sha256")
				.update(await readFile(join(directory, name)))
				.digest("hex"),
		]),
	),
);
await write("review-receipt.json", {
	schemaVersion: 1,
	classification: "independently-reviewed-calibration-only",
	caseId: reviewedCase.id,
	corpusDigest: datasetDigest(corpus),
	files: fileDigests,
	limits: [
		"The reviewer saw sanitized metadata and linked digests, not private raw session bytes.",
		"One calibration case contributes no holdout or acceptance-volume evidence.",
		"The Jev shadow call abstained and made no delegated mutation.",
	],
});
process.stdout.write(
	`${JSON.stringify({
		caseId: reviewedCase.id,
		split: reviewedCase.labels.split,
		reviewedBy: reviewedCase.review.reviewedBy,
		corpusCases: corpus.cases.length,
	})}\n`,
);
