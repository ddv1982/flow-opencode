import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { validateRegistration } from "./campaign.js";
import { ArmEvidenceSchema, compareCampaign } from "./compare.js";
import { datasetDigest } from "./schema.js";

const Text = z.string().trim().min(1).max(1000);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Bundle = z
	.object({
		authoredBy: Text,
		registration: z.unknown(),
		manager: ArmEvidenceSchema,
		jev: ArmEvidenceSchema,
	})
	.strict();
const Draft = z
	.object({
		schemaVersion: z.literal(1),
		status: z.literal("awaiting-review"),
		qualification: z.literal("inconclusive"),
		inputs: Bundle,
		report: z.unknown(),
	})
	.strict();
const Review = z
	.object({
		reviewedBy: Text,
		reviewedAt: z.iso.datetime(),
		evidenceDigest: Hash,
		verdict: z.literal("approved"),
		notes: Text,
	})
	.strict();
const Reviewed = z
	.object({
		schemaVersion: z.literal(1),
		status: z.literal("reviewed-attestation"),
		qualification: z.literal("inconclusive"),
		draft: Draft,
		review: Review,
	})
	.strict();

export async function prepareCalibration(input: unknown) {
	const bundle = Bundle.parse(input);
	const registration = await validateRegistration(bundle.registration);
	if (registration.config.split !== "calibration")
		throw new Error("Calibration requires calibration-split observations.");
	return {
		schemaVersion: 1 as const,
		status: "awaiting-review" as const,
		qualification: "inconclusive" as const,
		inputs: { ...bundle, registration },
		report: await compareCampaign(registration, bundle.manager, bundle.jev),
	};
}

export async function reviewCalibration(input: unknown, reviewInput: unknown) {
	const draft = Draft.parse(input);
	const expected = await prepareCalibration(draft.inputs);
	if (datasetDigest(draft) !== datasetDigest(expected))
		throw new Error("Calibration draft changed.");
	const review = Review.parse(reviewInput);
	if (
		review.reviewedBy === draft.inputs.authoredBy ||
		review.evidenceDigest !== datasetDigest(draft)
	)
		throw new Error(
			"Calibration review must be independent and bind the exact draft.",
		);
	return {
		schemaVersion: 1 as const,
		status: "reviewed-attestation" as const,
		qualification: "inconclusive" as const,
		draft: expected,
		review,
	};
}

export async function bindHoldoutCalibration(
	evidenceInput: unknown,
	registrationInput: unknown,
) {
	const evidence = Reviewed.parse(evidenceInput);
	await reviewCalibration(evidence.draft, evidence.review);
	const holdout = await validateRegistration(registrationInput);
	const calibration = await validateRegistration(
		evidence.draft.inputs.registration,
	);
	if (
		holdout.config.split !== "holdout" ||
		holdout.config.calibrationEvidenceDigest !== datasetDigest(evidence) ||
		holdout.corpusDigest !== calibration.corpusDigest ||
		datasetDigest(holdout.config.manager) !==
			datasetDigest(calibration.config.manager) ||
		datasetDigest(holdout.jev) !== datasetDigest(calibration.jev) ||
		datasetDigest(holdout.sourceDigests) !==
			datasetDigest(calibration.sourceDigests)
	)
		throw new Error("Holdout does not match reviewed calibration evidence.");
	return {
		schemaVersion: 1,
		qualification: "inconclusive",
		status: "calibration-binding-verified",
		registrationDigest: datasetDigest(holdout),
		calibrationEvidenceDigest: datasetDigest(evidence),
		assurance:
			"Review and origin are attestations. This evaluates the fixed runtime thresholds; it neither tunes thresholds nor qualifies production.",
	};
}

export async function runCalibrationCommand(args: readonly string[]) {
	const [command, ...paths] = args;
	const read = async (path: string | undefined): Promise<unknown> => {
		if (!path) throw new Error("Missing calibration input.");
		return JSON.parse(await readFile(path, "utf8"));
	};
	const output = paths.at(-1);
	if (!output) throw new Error("Missing calibration output.");
	if (command === "calibration-prepare" && paths.length === 2)
		await writeExclusive(
			output,
			await prepareCalibration(await read(paths[0])),
		);
	else if (command === "calibration-review" && paths.length === 3)
		await writeExclusive(
			output,
			await reviewCalibration(await read(paths[0]), await read(paths[1])),
		);
	else if (command === "calibration-bind" && paths.length === 3)
		await writeExclusive(
			output,
			await bindHoldoutCalibration(await read(paths[0]), await read(paths[1])),
		);
	else
		throw new Error(
			"Expected calibration-prepare <bundle> <new-draft>, calibration-review <draft> <review> <new-evidence>, or calibration-bind <evidence> <holdout-registration> <new-binding>.",
		);
	return 0;
}
