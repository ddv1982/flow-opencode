import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import { REVIEWER_CASES, type ReviewerCase } from "./reviewer-cases.js";
import { type DeepReadonly, freezeTree } from "./validated.js";

const TextSchema = z
	.string()
	.min(1)
	.max(4096)
	.regex(/\S/)
	.refine((value) => value.isWellFormed() && !value.includes("\u0000"));
const IdSchema = TextSchema.max(256);
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const JudgmentSchema = z
	.object({
		raterId: IdSchema,
		truth: z.enum(["defect", "clean"]),
		defectIds: z.array(IdSchema).max(256),
		rationale: TextSchema,
	})
	.strict()
	.superRefine((judgment, context) => {
		if ((judgment.truth === "defect") !== judgment.defectIds.length > 0) {
			context.addIssue({
				code: "custom",
				path: ["defectIds"],
				message:
					"Defect judgments require defect IDs; clean judgments require none.",
			});
		}
		if (new Set(judgment.defectIds).size !== judgment.defectIds.length) {
			context.addIssue({
				code: "custom",
				path: ["defectIds"],
				message: "Defect IDs must be unique.",
			});
		}
		if (/^synthetic(?:$|[-_:])/i.test(judgment.raterId)) {
			context.addIssue({
				code: "custom",
				path: ["raterId"],
				message: "Synthetic raters cannot provide independent human labels.",
			});
		}
	});
const IndependentJudgmentSchema = JudgmentSchema.safeExtend({
	independent: z.literal(true),
	blindedToReviewer: z.literal(true),
});
const CaseLabelsSchema = z
	.object({
		caseId: IdSchema,
		caseVersion: z.number().int().safe().positive(),
		truthSha256: DigestSchema,
		labels: z.array(IndependentJudgmentSchema).min(2).max(100),
		adjudication: IndependentJudgmentSchema.nullable(),
	})
	.strict()
	.superRefine((entry, context) => {
		const raters = new Set(entry.labels.map((label) => label.raterId));
		if (raters.size !== entry.labels.length) {
			context.addIssue({
				code: "custom",
				path: ["labels"],
				message: "Every case requires distinct independent raters.",
			});
		}
		const judgments = new Set(entry.labels.map(judgmentKey));
		if (judgments.size > 1 && entry.adjudication === null) {
			context.addIssue({
				code: "custom",
				path: ["adjudication"],
				message: "Disagreements require an independent adjudication.",
			});
		}
		if (entry.adjudication && raters.has(entry.adjudication.raterId)) {
			context.addIssue({
				code: "custom",
				path: ["adjudication", "raterId"],
				message: "The adjudicator must be distinct from the case raters.",
			});
		}
	});

export const ReviewerLabelImportSchema = z
	.object({
		schemaVersion: z.literal(1),
		labelSource: z.literal("human"),
		collectionId: IdSchema,
		recordedAt: z.string().datetime({ offset: true }),
		cases: z.array(CaseLabelsSchema).min(1).max(10_000),
	})
	.strict()
	.superRefine((record, context) => {
		const cases = new Set<string>();
		for (const [index, entry] of record.cases.entries()) {
			const key = `${entry.caseId}\u0000${entry.caseVersion}`;
			if (cases.has(key)) {
				context.addIssue({
					code: "custom",
					path: ["cases", index],
					message: "Case ID and version must be unique.",
				});
			}
			cases.add(key);
		}
	});

const ValidatedReviewerLabelImportSchema =
	ReviewerLabelImportSchema.brand<"ValidatedReviewerLabelImport">();
export type ValidatedReviewerLabelImport = DeepReadonly<
	z.infer<typeof ValidatedReviewerLabelImportSchema>
>;

export type ReviewerLabelIssue = {
	readonly path: string;
	readonly message: string;
};

function judgmentKey(judgment: {
	readonly truth: string;
	readonly defectIds: readonly string[];
}): string {
	return canonicalJson({
		truth: judgment.truth,
		defectIds: [...judgment.defectIds].sort(),
	});
}

export function parseReviewerLabelImport(
	input: unknown,
	cases: readonly ReviewerCase[] = REVIEWER_CASES,
):
	| { readonly ok: true; readonly value: ValidatedReviewerLabelImport }
	| { readonly ok: false; readonly issues: readonly ReviewerLabelIssue[] } {
	const parsed = ValidatedReviewerLabelImportSchema.safeParse(input);
	if (!parsed.success)
		return {
			ok: false,
			issues: parsed.error.issues.map((issue) => ({
				path: `$.${issue.path.join(".")}`,
				message: issue.message,
			})),
		};
	const issues: ReviewerLabelIssue[] = [];
	for (const [index, entry] of parsed.data.cases.entries()) {
		const fixture = cases.find(
			(candidate) =>
				candidate.caseId === entry.caseId &&
				candidate.caseVersion === entry.caseVersion,
		);
		const path = `$.cases.${index}`;
		if (!fixture || fixture.truthSha256 !== entry.truthSha256) {
			issues.push({
				path,
				message:
					"Human labels must identify an unchanged registered case and truth digest.",
			});
			continue;
		}
		const judgment = entry.adjudication ?? entry.labels[0];
		if (
			!judgment ||
			judgmentKey(judgment) !==
				judgmentKey({
					truth: fixture.truth,
					defectIds: fixture.defects.map((defect) => defect.defectId),
				})
		) {
			issues.push({
				path,
				message:
					"The agreed or adjudicated truth must match the registered defects.",
			});
		}
	}
	if (issues.length > 0) return { ok: false, issues };
	freezeTree(parsed.data);
	return { ok: true, value: parsed.data };
}

export function reviewerLabelImportSha256(
	record: ValidatedReviewerLabelImport,
): string {
	return canonicalSha256("flow-reviewer-human-label-import-v1", {
		...record,
		cases: [...record.cases]
			.sort((left, right) =>
				compareText(
					`${left.caseId}\u0000${left.caseVersion}`,
					`${right.caseId}\u0000${right.caseVersion}`,
				),
			)
			.map((entry) => ({
				...entry,
				labels: [...entry.labels]
					.sort((left, right) => compareText(left.raterId, right.raterId))
					.map((label) => ({
						...label,
						defectIds: [...label.defectIds].sort(),
					})),
				adjudication: entry.adjudication
					? {
							...entry.adjudication,
							defectIds: [...entry.adjudication.defectIds].sort(),
						}
					: null,
			})),
	});
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
