import { z } from "zod";
import { evaluateRecoveryCorpus } from "./evaluate.js";
import { datasetDigest, ReviewedCorpusSchema } from "./schema.js";
import { recoverySourceDigests } from "./sources.js";

export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().trim().min(1);
export const CampaignConfigSchema = z
	.object({
		split: z.enum(["calibration", "holdout"]),
		calibrationEvidenceDigest: Hash.nullable(),
		manager: z
			.object({
				model: Text,
				prompt: Text,
				protocol: z.literal("recovery-observation-v1"),
			})
			.strict(),
	})
	.strict()
	.refine(
		(config) =>
			config.split !== "holdout" || config.calibrationEvidenceDigest !== null,
		"Holdout requires frozen calibration evidence.",
	);
export const JevConfiguration = {
	model: "jev-1.13.0",
	rubric: "recovery-v1",
	policy: "bounded-recovery-v1",
	thresholds: { choice: 0.9, goal: 0.95, suitability: 0.95 },
} as const;
export const RegistrationSchema = z
	.object({
		schemaVersion: z.literal(1),
		qualification: z.literal("inconclusive"),
		createdAt: z.iso.datetime(),
		corpus: ReviewedCorpusSchema,
		corpusDigest: Hash,
		config: CampaignConfigSchema,
		managerPromptDigest: Hash,
		sourceDigests: z.record(z.string(), Hash),
		jev: z
			.object({
				model: z.literal("jev-1.13.0"),
				rubric: z.literal("recovery-v1"),
				policy: z.literal("bounded-recovery-v1"),
				thresholds: z
					.object({
						choice: z.literal(0.9),
						goal: z.literal(0.95),
						suitability: z.literal(0.95),
					})
					.strict(),
			})
			.strict(),
		cases: z
			.array(
				z
					.object({
						id: Text,
						caseDigest: Hash,
						packetDigest: Hash.nullable(),
						primary: z.boolean(),
						independenceGroupId: Text,
					})
					.strict(),
			)
			.min(1),
	})
	.strict();
export type Registration = z.infer<typeof RegistrationSchema>;
export const selectedCorpus = (registration: Registration) => ({
	...registration.corpus,
	cases: registration.corpus.cases.filter(
		(row) => row.labels.split === registration.config.split,
	),
});
export async function registerCampaign(
	corpusInput: unknown,
	configInput: unknown,
) {
	const corpus = ReviewedCorpusSchema.parse(corpusInput),
		config = CampaignConfigSchema.parse(configInput);
	const selected = {
		...corpus,
		cases: corpus.cases.filter((row) => row.labels.split === config.split),
	};
	if (!selected.cases.length) throw new Error("Selected split is empty.");
	const preparation = await evaluateRecoveryCorpus(selected);
	if (!preparation.rows.every((row) => row.eligibilityMatches))
		throw new Error("Registration eligibility mismatch.");
	return RegistrationSchema.parse({
		schemaVersion: 1,
		qualification: "inconclusive",
		createdAt: new Date().toISOString(),
		corpus,
		corpusDigest: datasetDigest(corpus),
		config,
		managerPromptDigest: datasetDigest(config.manager.prompt),
		sourceDigests: await recoverySourceDigests(),
		jev: JevConfiguration,
		cases: selected.cases.map((row, index) => ({
			id: row.id,
			caseDigest: datasetDigest(row),
			packetDigest: preparation.rows[index]?.packetDigest,
			primary: row.labels.primary,
			independenceGroupId: row.provenance.independenceGroupId,
		})),
	});
}
export async function validateRegistration(input: unknown) {
	const registration = RegistrationSchema.parse(input);
	const expected = await registerCampaign(
		registration.corpus,
		registration.config,
	);
	if (
		datasetDigest({ ...expected, createdAt: registration.createdAt }) !==
		datasetDigest(registration)
	)
		throw new Error("Registration bindings or sources changed.");
	return registration;
}
