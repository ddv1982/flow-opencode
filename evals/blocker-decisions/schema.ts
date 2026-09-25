import { createHash } from "node:crypto";
import { z } from "zod";
import { type DeepReadonly, freezeTree } from "../validated.js";

const Id = z
	.string()
	.min(1)
	.max(256)
	.regex(/^[a-zA-Z0-9_.:/-]+$/);
const Text = z.string().min(1).max(4096);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Probability = z.number().finite().min(0).max(1);
const Count = z.number().int().safe().nonnegative();
export const ActionSchema = z.enum([
	"retry",
	"independent-feature",
	"amend-plan",
	"abandon",
	"release",
]);
export const QualifiedActionSchema = z.enum(["retry", "independent-feature"]);
export type QualifiedAction = z.infer<typeof QualifiedActionSchema>;
export const ArmSchema = z.enum([
	"current-reference",
	"deterministic-policy",
	"manager-policy",
	"manager-policy-jev",
]);
export type Arm = z.infer<typeof ArmSchema>;
const CandidateSchema = z
	.object({
		id: Id.refine((id) => id !== "abstain"),
		action: ActionSchema,
		featureId: Id,
		remedy: Text,
		affectedFeatureIds: z.array(Id).min(1).max(20),
		evidenceIds: z.array(Id).max(20),
		dependenciesSatisfied: z.boolean(),
		evidenceComplete: z.boolean(),
		changesGoal: z.boolean(),
	})
	.strict();
const EpisodeSchema = z
	.object({
		id: Id,
		originatingTaskId: Id,
		independenceGroupId: Id,
		primary: z.boolean(),
		facts: z
			.object({
				goal: Text,
				blocker: Text,
				sourceIdentity: Id,
				revision: Count,
				evidence: z.array(z.object({ id: Id, fact: Text }).strict()).max(20),
				candidates: z.array(CandidateSchema).min(1).max(3),
			})
			.strict(),
		authority: z
			.object({
				allowedActions: z.array(QualifiedActionSchema).max(2),
				approvedFeatureIds: z.array(Id).min(1).max(20),
				remainingAttempts: Count,
			})
			.strict(),
		labels: z
			.array(
				z
					.object({
						candidateId: Id,
						legal: z.boolean(),
						useful: z.boolean(),
						unsafe: z.boolean(),
						rationale: Text,
					})
					.strict(),
			)
			.min(1)
			.max(3),
	})
	.strict();
export type Episode = DeepReadonly<z.infer<typeof EpisodeSchema>>;
const CorpusSchema = z
	.object({
		schemaVersion: z.literal(1),
		id: Id,
		synthetic: z.boolean(),
		episodes: z.array(EpisodeSchema).min(1).max(10000),
	})
	.strict();
const ThresholdSchema = z
	.object({ choice: Probability, goal: Probability, suitability: Probability })
	.strict();
const ManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		id: Id,
		corpusDigest: Digest,
		sourceRevision: Id,
		policyVersion: Id,
		rubricVersion: Id,
		managerModel: Id,
		managerPromptDigest: Digest,
		requestedModel: z.literal("jev-1.13.0"),
		budget: z
			.object({
				maxCalls: Count.min(1),
				maxUsd: z.number().finite().positive(),
			})
			.strict(),
		registration: z.discriminatedUnion("status", [
			z.object({ status: z.literal("development") }).strict(),
			z
				.object({
					status: z.literal("registered-holdout"),
					developmentEvidenceDigest: Digest,
					registeredAt: z.iso.datetime(),
				})
				.strict(),
		]),
		splits: z
			.array(
				z
					.object({
						episodeId: Id,
						split: z.enum(["development", "holdout", "robustness"]),
					})
					.strict(),
			)
			.min(1)
			.max(10000),
		thresholds: z
			.object({
				retry: ThresholdSchema,
				"independent-feature": ThresholdSchema,
			})
			.strict(),
		qualifyActions: z.array(QualifiedActionSchema).min(1).max(2),
		comparison: z
			.object({
				minimumPairs: Count.min(1),
				minimumUsefulCoverageGain: Probability,
			})
			.strict(),
	})
	.strict();
const CampaignSchema = z
	.object({ manifest: ManifestSchema, corpus: CorpusSchema })
	.brand<"BlockerCampaign">();
export type ValidatedCampaign = DeepReadonly<z.infer<typeof CampaignSchema>>;
export type Candidate = Episode["facts"]["candidates"][number];
const MetricsSchema = z
	.object({
		requestedModel: Id,
		resolvedModel: Id.nullable(),
		latencyMs: z.number().finite().nonnegative(),
		attempts: Count.max(3),
		inputTokens: Count.nullable(),
		outputTokens: Count.nullable(),
		reservedUsd: z.number().finite().nonnegative(),
		estimatedUsd: z.number().finite().nonnegative().nullable(),
	})
	.strict();
const AdviceSchema = z
	.object({
		choice: Id,
		confidence: Probability,
		probabilities: z.record(Id, Probability),
		assessments: z.record(
			Id,
			z.object({ goal: Probability, suitability: Probability }).strict(),
		),
	})
	.strict();
const ResultSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("decision"),
			candidateId: Id,
			advice: AdviceSchema.nullable(),
		})
		.strict(),
	z
		.object({ kind: z.literal("abstain"), advice: AdviceSchema.nullable() })
		.strict(),
	z
		.object({
			kind: z.literal("unavailable"),
			reason: z.enum([
				"missing-key",
				"budget",
				"cancelled",
				"timeout",
				"transport",
				"http",
				"oversize",
				"malformed",
				"unknown-model",
				"missing-metadata",
			]),
		})
		.strict(),
]);
const ObservationSchema = z
	.object({
		episodeId: Id,
		arm: ArmSchema,
		packetDigest: Digest,
		campaignDigest: Digest,
		policyVersion: Id,
		rubricVersion: Id,
		managerModel: Id,
		managerPromptDigest: Digest,
		origin: z.enum(["simulation", "live", "imported-live", "deterministic"]),
		result: ResultSchema,
		metrics: MetricsSchema.nullable(),
	})
	.strict();
const EvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		campaignDigest: Digest,
		receipts: z
			.array(
				z
					.object({ artifactDigest: Digest, producer: Id, reviewedBy: Id })
					.strict(),
			)
			.max(100)
			.default([]),
		observations: z.array(ObservationSchema).max(40000),
	})
	.strict()
	.brand<"BlockerEvidence">();
export type Observation = DeepReadonly<z.infer<typeof ObservationSchema>>;
export type ValidatedEvidence = DeepReadonly<z.infer<typeof EvidenceSchema>>;
export type Advice = DeepReadonly<z.infer<typeof AdviceSchema>>;

export function digest(value: unknown): string {
	const canonical = (input: unknown): unknown =>
		Array.isArray(input)
			? input.map(canonical)
			: input !== null && typeof input === "object"
				? Object.fromEntries(
						Object.entries(input)
							.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
							.map(([key, item]) => [key, canonical(item)]),
					)
				: input;
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}
function requireInvariant(ok: boolean, code: string): asserts ok {
	if (!ok) throw new Error(`Invalid blocker evidence: ${code}`);
}
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
	const result = schema.safeParse(input);
	if (!result.success)
		throw new Error(
			`Invalid blocker data: ${result.error.issues
				.map((issue) => issue.path.join("."))
				.join(",")
				.slice(0, 512)}`,
		);
	return result.data;
}
export function parseCampaign(
	manifest: unknown,
	corpus: unknown,
): ValidatedCampaign {
	const value = parse(CampaignSchema, { manifest, corpus });
	requireInvariant(
		value.manifest.corpusDigest === digest(value.corpus),
		"corpus-digest",
	);
	const ids = new Set<string>();
	const groups = new Map<
		string,
		{ task: string; split: string; primaries: number }
	>();
	const tasks = new Map<string, string>();
	const splits = new Map(
		value.manifest.splits.map((entry) => [entry.episodeId, entry.split]),
	);
	requireInvariant(
		splits.size === value.manifest.splits.length &&
			splits.size === value.corpus.episodes.length,
		"split-coverage",
	);
	for (const episode of value.corpus.episodes) {
		requireInvariant(!ids.has(episode.id), "duplicate-episode");
		ids.add(episode.id);
		const split = splits.get(episode.id);
		requireInvariant(split !== undefined, "missing-split");
		const oldTask = tasks.get(episode.originatingTaskId);
		requireInvariant(
			oldTask === undefined || oldTask === episode.independenceGroupId,
			"task-group",
		);
		tasks.set(episode.originatingTaskId, episode.independenceGroupId);
		const old = groups.get(episode.independenceGroupId);
		requireInvariant(
			old === undefined ||
				(old.task === episode.originatingTaskId && old.split === split),
			"origin-split",
		);
		groups.set(episode.independenceGroupId, {
			task: episode.originatingTaskId,
			split,
			primaries: (old?.primaries ?? 0) + Number(episode.primary),
		});
		const candidateIds = new Set(episode.facts.candidates.map((c) => c.id));
		const evidenceIds = new Set(episode.facts.evidence.map((e) => e.id));
		requireInvariant(
			candidateIds.size === episode.facts.candidates.length &&
				evidenceIds.size === episode.facts.evidence.length,
			"duplicate-candidate-or-evidence",
		);
		requireInvariant(
			episode.labels.length === candidateIds.size &&
				new Set(episode.labels.map((l) => l.candidateId)).size ===
					candidateIds.size &&
				episode.labels.every((l) => candidateIds.has(l.candidateId)),
			"labels",
		);
		requireInvariant(
			episode.facts.candidates.every((c) =>
				c.evidenceIds.every((id) => evidenceIds.has(id)),
			),
			"unknown-evidence",
		);
	}
	requireInvariant(
		[...groups.values()].every((group) => group.primaries === 1),
		"canonical-sample",
	);
	requireInvariant(
		new Set(value.manifest.qualifyActions).size ===
			value.manifest.qualifyActions.length,
		"duplicate-action",
	);
	freezeTree(value);
	return value;
}
export function packetFor(campaign: ValidatedCampaign, episode: Episode) {
	return {
		policyVersion: campaign.manifest.policyVersion,
		rubricVersion: campaign.manifest.rubricVersion,
		facts: episode.facts,
		authority: episode.authority,
	};
}
export function validateEvidence(
	campaign: ValidatedCampaign,
	input: unknown,
): ValidatedEvidence {
	const value = parse(EvidenceSchema, input);
	requireInvariant(
		value.receipts.every((receipt) => receipt.producer !== receipt.reviewedBy),
		"independent-import-review",
	);
	const campaignDigest = digest(campaign.manifest);
	requireInvariant(value.campaignDigest === campaignDigest, "campaign-digest");
	const seen = new Set<string>();
	for (const row of value.observations) {
		const episode = campaign.corpus.episodes.find(
			(entry) => entry.id === row.episodeId,
		);
		requireInvariant(episode !== undefined, "unknown-episode");
		const key = `${row.episodeId}/${row.arm}`;
		requireInvariant(!seen.has(key), "duplicate-observation");
		seen.add(key);
		requireInvariant(
			row.campaignDigest === campaignDigest &&
				row.packetDigest === digest(packetFor(campaign, episode)),
			"packet-digest",
		);
		requireInvariant(
			row.policyVersion === campaign.manifest.policyVersion &&
				row.rubricVersion === campaign.manifest.rubricVersion &&
				row.managerModel === campaign.manifest.managerModel &&
				row.managerPromptDigest === campaign.manifest.managerPromptDigest,
			"comparator-identity",
		);
		const result = row.result;
		const options = [...episode.facts.candidates.map((c) => c.id), "abstain"];
		if (result.kind === "decision")
			requireInvariant(
				options.includes(result.candidateId) &&
					result.candidateId !== "abstain",
				"unknown-candidate",
			);
		if (result.kind !== "unavailable" && result.advice !== null) {
			const advice = result.advice;
			requireInvariant(
				Object.keys(advice.assessments).length ===
					episode.facts.candidates.length &&
					episode.facts.candidates.every((c) => c.id in advice.assessments),
				"assessment-options",
			);
			requireInvariant(
				Object.keys(advice.probabilities).length === options.length &&
					options.every((id) => id in advice.probabilities),
				"choice-options",
			);
			requireInvariant(
				Math.abs(
					Object.values(advice.probabilities).reduce((sum, p) => sum + p, 0) -
						1,
				) <= 1e-6,
				"choice-normalization",
			);
			requireInvariant(
				options.includes(advice.choice) &&
					advice.probabilities[advice.choice] ===
						Math.max(...Object.values(advice.probabilities)),
				"choice-winner",
			);
			requireInvariant(
				result.kind === "decision"
					? result.candidateId === advice.choice
					: advice.choice === "abstain",
				"choice-result",
			);
		}
		if (row.arm === "manager-policy-jev" && result.kind !== "unavailable")
			requireInvariant(result.advice !== null, "missing-advice");
	}
	freezeTree(value);
	return value;
}
export function parseEvidence(
	campaign: ValidatedCampaign,
	input: unknown,
): ValidatedEvidence {
	const value = validateEvidence(campaign, input);
	return validateEvidence(campaign, {
		...value,
		observations: value.observations.map((row) => ({
			...row,
			origin: "simulation",
		})),
	});
}
export function importLiveEvidence(
	campaign: ValidatedCampaign,
	input: unknown,
	receipt: unknown,
): ValidatedEvidence {
	const checked = parse(
		z.object({ artifactDigest: Digest, producer: Id, reviewedBy: Id }).strict(),
		receipt,
	);
	requireInvariant(
		checked.producer !== checked.reviewedBy,
		"independent-import-review",
	);
	requireInvariant(digest(input) === checked.artifactDigest, "import-receipt");
	const value = validateEvidence(campaign, input);
	requireInvariant(
		value.observations.every(
			(row) => row.origin === "live" || row.origin === "imported-live",
		),
		"non-live-import",
	);
	return validateEvidence(campaign, {
		...value,
		receipts: [...value.receipts, checked],
		observations: value.observations.map((row) => ({
			...row,
			origin: "imported-live",
		})),
	});
}
export function observationBase(
	campaign: ValidatedCampaign,
	episode: Episode,
	arm: Arm,
) {
	const m = campaign.manifest;
	return {
		episodeId: episode.id,
		arm,
		packetDigest: digest(packetFor(campaign, episode)),
		campaignDigest: digest(m),
		policyVersion: m.policyVersion,
		rubricVersion: m.rubricVersion,
		managerModel: m.managerModel,
		managerPromptDigest: m.managerPromptDigest,
	};
}
export function mergeEvidence(
	campaign: ValidatedCampaign,
	...inputs: readonly ValidatedEvidence[]
): ValidatedEvidence {
	const rows = new Map<string, Observation>();
	for (const input of inputs)
		for (const row of input.observations) {
			const key = `${row.episodeId}/${row.arm}`;
			const previous = rows.get(key);
			requireInvariant(
				previous === undefined || digest(previous) === digest(row),
				"conflicting-evidence",
			);
			rows.set(key, row);
		}
	return validateEvidence(campaign, {
		schemaVersion: 1,
		campaignDigest: digest(campaign.manifest),
		receipts: inputs.flatMap((input) => [...input.receipts]),
		observations: [...rows.values()],
	});
}
