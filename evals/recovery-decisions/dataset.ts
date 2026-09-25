import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { evaluateRecoveryCorpus } from "./evaluate.js";
import {
	DraftSchema,
	datasetDigest,
	LabelSubmissionSchema,
	ReviewedCaseSchema,
	ReviewedCorpusSchema,
	ReviewSchema,
	SnapshotSchema,
} from "./schema.js";

export function importSnapshot(input: unknown) {
	const encoded = JSON.stringify(input);
	if (
		/Bearer\s|(?:api[_-]?key|password|secret)[\\"' ]*\s*[:=]\s*\S+/i.test(
			encoded,
		) ||
		(process.env.TYPESAFE_API_KEY &&
			encoded.includes(process.env.TYPESAFE_API_KEY))
	)
		throw new Error("Sensitive snapshot refused; sanitize before import.");
	return DraftSchema.parse({
		schemaVersion: 1,
		status: "awaiting-label-review",
		snapshot: SnapshotSchema.parse(input),
	});
}

export function reviewSnapshot(draftInput: unknown, submissionInput: unknown) {
	const draft = DraftSchema.parse(draftInput);
	const submission = z
		.object({ labels: LabelSubmissionSchema, review: ReviewSchema })
		.strict()
		.parse(submissionInput);
	return ReviewedCaseSchema.parse({
		...draft.snapshot,
		rationale: submission.labels.rationale,
		expected: submission.labels.expected,
		...submission,
	});
}

export async function buildReviewedCorpus(input: unknown) {
	const corpus = ReviewedCorpusSchema.parse({
		schemaVersion: 1,
		purpose: "reviewed-evaluation",
		labelStatus: "independently-reviewed",
		cases: input,
	});
	const preparation = await evaluateRecoveryCorpus(corpus);
	if (!preparation.rows.every((row) => row.eligibilityMatches))
		throw new Error("Reviewed labels disagree with deterministic eligibility.");
	return corpus;
}

export async function runDatasetCommand(args: readonly string[]) {
	const [command, ...paths] = args;
	const [inputPath, secondPath, thirdPath] = paths;
	const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
	if (
		command === "dataset-import" &&
		paths.length === 2 &&
		inputPath &&
		secondPath
	) {
		const draft = importSnapshot(await read(inputPath));
		await writeExclusive(secondPath, draft);
		return 0;
	}
	if (
		command === "dataset-review" &&
		paths.length === 3 &&
		inputPath &&
		secondPath &&
		thirdPath
	) {
		const row = reviewSnapshot(await read(inputPath), await read(secondPath));
		await writeExclusive(thirdPath, row);
		return 0;
	}
	if (
		command === "dataset-build" &&
		paths.length === 2 &&
		inputPath &&
		secondPath
	) {
		const corpus = await buildReviewedCorpus(await read(inputPath));
		await writeExclusive(secondPath, corpus);
		return 0;
	}
	if (command === "dataset-digest" && paths.length === 1 && inputPath) {
		console.log(datasetDigest(await read(inputPath)));
		return 0;
	}
	throw new Error(
		"Expected dataset-import <snapshot> <new-draft>, dataset-review <draft> <submission> <new-case>, dataset-build <cases-array> <new-corpus>, or dataset-digest <json>.",
	);
}
