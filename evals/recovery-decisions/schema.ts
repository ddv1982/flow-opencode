import { createHash } from "node:crypto";
import { z } from "zod";
import { RecoveryProposalSchema } from "../../src/application/recovery-policy.js";
import { SessionSchema } from "../../src/application/schema.js";

export const DevelopmentCorpusSchema = z
	.object({
		schemaVersion: z.literal(1),
		purpose: z.literal("synthetic-development"),
		labelStatus: z.literal("author-proposed-unreviewed"),
		cases: z
			.array(
				z
					.object({
						id: z.string().min(1),
						rationale: z.string().min(1),
						session: SessionSchema,
						sourceDigest: z.templateLiteral([
							"sha256:",
							z.string().regex(/^[a-f0-9]{64}$/),
						]),
						proposal: RecoveryProposalSchema,
						expected: z
							.object({
								eligibleCandidateIds: z.array(z.string()),
								acceptableSelections: z.array(z.string()),
							})
							.strict(),
					})
					.strict(),
			)
			.min(1),
	})
	.strict()
	.superRefine((corpus, context) => {
		if (new Set(corpus.cases.map((row) => row.id)).size !== corpus.cases.length)
			context.addIssue({ code: "custom", message: "Duplicate case ids" });
		for (const row of corpus.cases) {
			const ids = new Set(
				row.proposal.candidates.map((candidate) => candidate.id),
			);
			if (
				row.proposal.sessionId !== row.session.id ||
				row.proposal.expectedRevision !== row.session.revision ||
				row.expected.eligibleCandidateIds.some((id) => !ids.has(id)) ||
				row.expected.acceptableSelections.some(
					(id) =>
						id !== "abstain" && !row.expected.eligibleCandidateIds.includes(id),
				)
			)
				context.addIssue({
					code: "custom",
					message: `Invalid bindings or labels: ${row.id}`,
				});
		}
	});

export const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function datasetDigest(value: unknown): string {
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
	return digest(canonical(value));
}

const Id = z.string().trim().min(1).max(256);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const CaseSchema = DevelopmentCorpusSchema.shape.cases.element;
export const SnapshotSchema = CaseSchema.omit({
	expected: true,
	rationale: true,
})
	.extend({
		provenance: z
			.object({
				origin: z.literal("observed-recovery"),
				sourceReference: Id,
				originatingTaskId: Id,
				independenceGroupId: Id,
				scenarioFamily: Id,
				capturedAt: z.iso.datetime(),
				importedBy: Id,
				sanitization: z
					.object({
						reviewedBy: Id,
						reviewedAt: z.iso.datetime(),
						notes: z.string().trim().min(1),
						payloadDigest: Hash,
					})
					.strict(),
			})
			.strict(),
	})
	.strict()
	.superRefine((row, context) => {
		if (
			row.proposal.sessionId !== row.session.id ||
			row.proposal.expectedRevision !== row.session.revision ||
			row.provenance.sanitization.payloadDigest !==
				datasetDigest(snapshotPayload(row))
		)
			context.addIssue({
				code: "custom",
				message: "Snapshot binding or sanitization digest mismatch",
			});
	});

export function snapshotPayload(row: {
	session: unknown;
	sourceDigest: string;
	proposal: unknown;
}): unknown {
	return {
		session: row.session,
		sourceDigest: row.sourceDigest,
		proposal: row.proposal,
	};
}

export const DraftSchema = z
	.object({
		schemaVersion: z.literal(1),
		status: z.literal("awaiting-label-review"),
		snapshot: SnapshotSchema,
	})
	.strict();

export const CandidateOutcomeSchema = z.enum([
	"safe-effective",
	"safe-ineffective",
	"unsafe",
]);
export type CandidateOutcome = z.infer<typeof CandidateOutcomeSchema>;

export const LabelSubmissionSchema = z
	.object({
		snapshotDigest: Hash,
		authoredBy: Id,
		rationale: z.string().trim().min(1),
		expected: CaseSchema.shape.expected.extend({
			acceptableSelections: z.array(Id).min(1),
		}),
		split: z.enum(["calibration", "holdout"]),
		primary: z.boolean(),
		candidateOutcomes: z.record(z.string(), CandidateOutcomeSchema).optional(),
	})
	.strict()
	.superRefine((labels, context) => {
		if (!labels.candidateOutcomes) return;
		const keys = Object.keys(labels.candidateOutcomes).sort();
		const eligible = [...labels.expected.eligibleCandidateIds].sort();
		const effective = Object.entries(labels.candidateOutcomes)
			.filter(([, outcome]) => outcome === "safe-effective")
			.map(([id]) => id)
			.sort();
		const acceptable = labels.expected.acceptableSelections
			.filter((id) => id !== "abstain")
			.sort();
		if (
			datasetDigest(keys) !== datasetDigest(eligible) ||
			datasetDigest(effective) !== datasetDigest(acceptable)
		)
			context.addIssue({
				code: "custom",
				message:
					"Candidate outcomes must cover exactly eligible candidates and match acceptable selections.",
			});
	});

export const ReviewSchema = z
	.object({
		reviewedBy: Id,
		reviewedAt: z.iso.datetime(),
		labelDigest: Hash,
		verdict: z.literal("approved"),
		notes: z.string().trim().min(1),
	})
	.strict();

export const ReviewedCaseSchema = CaseSchema.extend({
	provenance: SnapshotSchema.shape.provenance,
	labels: LabelSubmissionSchema,
	review: ReviewSchema,
})
	.strict()
	.superRefine((row, context) => {
		const snapshot = SnapshotSchema.safeParse({
			id: row.id,
			session: row.session,
			sourceDigest: row.sourceDigest,
			proposal: row.proposal,
			provenance: row.provenance,
		});
		const labels = row.labels;
		if (
			!snapshot.success ||
			labels.snapshotDigest !== datasetDigest(snapshot.data) ||
			row.review.labelDigest !== datasetDigest(labels) ||
			row.review.reviewedBy === labels.authoredBy ||
			row.review.reviewedBy === row.provenance.importedBy ||
			datasetDigest(labels.expected) !== datasetDigest(row.expected) ||
			labels.rationale !== row.rationale
		)
			context.addIssue({
				code: "custom",
				message: "Missing independent review or stale review binding",
			});
		const checked = DevelopmentCorpusSchema.safeParse({
			schemaVersion: 1,
			purpose: "synthetic-development",
			labelStatus: "author-proposed-unreviewed",
			cases: [
				{
					id: row.id,
					session: row.session,
					sourceDigest: row.sourceDigest,
					proposal: row.proposal,
					expected: row.expected,
					rationale: row.rationale,
				},
			],
		});
		if (!checked.success)
			context.addIssue({ code: "custom", message: "Invalid reviewed labels" });
		for (const ids of [
			row.expected.eligibleCandidateIds,
			row.expected.acceptableSelections,
		])
			if (new Set(ids).size !== ids.length)
				context.addIssue({ code: "custom", message: "Duplicate labels" });
	});

export const ReviewedCorpusSchema = z
	.object({
		schemaVersion: z.literal(1),
		purpose: z.literal("reviewed-evaluation"),
		labelStatus: z.literal("independently-reviewed"),
		cases: z.array(ReviewedCaseSchema).min(1),
	})
	.strict()
	.superRefine((corpus, context) => {
		const ids = new Set<string>();
		const payloads = new Set<string>();
		const splits = new Map<string, string>();
		const primaryCounts = new Map<string, number>();
		const groups = new Map<string, string>();
		for (const row of corpus.cases) {
			const hash = datasetDigest(snapshotPayload(row));
			if (ids.has(row.id) || payloads.has(hash))
				context.addIssue({
					code: "custom",
					message: "Duplicate case or snapshot",
				});
			ids.add(row.id);
			payloads.add(hash);
			const p = row.provenance;
			for (const key of [
				`task:${p.originatingTaskId}`,
				`session:${row.session.id}`,
				`source:${p.sourceReference}`,
			]) {
				if (groups.has(key) && groups.get(key) !== p.independenceGroupId)
					context.addIssue({
						code: "custom",
						message: "Related cases must share an independence group",
					});
				groups.set(key, p.independenceGroupId);
			}
			for (const key of [
				`task:${p.originatingTaskId}`,
				`group:${p.independenceGroupId}`,
				`family:${p.scenarioFamily}`,
				`source:${p.sourceReference}`,
				`session:${row.session.id}`,
			]) {
				if (splits.has(key) && splits.get(key) !== row.labels.split)
					context.addIssue({
						code: "custom",
						message: "Related cases cross evaluation splits",
					});
				splits.set(key, row.labels.split);
			}
			primaryCounts.set(
				p.independenceGroupId,
				(primaryCounts.get(p.independenceGroupId) ?? 0) +
					Number(row.labels.primary),
			);
		}
		if ([...primaryCounts.values()].some((count) => count !== 1))
			context.addIssue({
				code: "custom",
				message: "Each independence group requires exactly one primary case",
			});
	});

export const CorpusSchema = z.union([
	DevelopmentCorpusSchema,
	ReviewedCorpusSchema,
]);
export type RecoveryCorpus = z.infer<typeof CorpusSchema>;
