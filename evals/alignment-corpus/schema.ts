import { z } from "zod";
import { type DeepReadonly, freezeTree } from "../validated.js";

const TextSchema = z
	.string()
	.min(1)
	.max(4096)
	.regex(/\S/)
	.refine((value) => value.isWellFormed() && !value.includes("\u0000"));
const IdSchema = TextSchema.max(256);

const AlignmentChoiceSchema = z.enum(["continue", "new-scope"]);
const AlignmentCategorySchema = z.enum([
	"continuation",
	"replacement",
	"additive",
	"mixed-scope",
]);

const AlignmentCaseSchema = z
	.object({
		id: IdSchema,
		version: z.number().int().safe().positive(),
		activeGoal: TextSchema,
		userRequest: TextSchema,
		expectedChoice: AlignmentChoiceSchema,
		category: AlignmentCategorySchema,
		rationale: TextSchema,
	})
	.strict()
	.superRefine((entry, context) => {
		if (
			entry.category === "mixed-scope" &&
			entry.expectedChoice !== "new-scope"
		) {
			context.addIssue({
				code: "custom",
				path: ["expectedChoice"],
				message: "Mixed-scope cases must be labeled new-scope.",
			});
		}
	});

export const AlignmentCorpusSchema = z
	.object({
		schemaVersion: z.literal(1),
		corpusId: IdSchema,
		cases: z.array(AlignmentCaseSchema).min(1).max(10_000),
	})
	.strict()
	.superRefine((record, context) => {
		const seen = new Set<string>();
		for (const [index, entry] of record.cases.entries()) {
			const key = `${entry.id}\u0000${entry.version}`;
			if (seen.has(key)) {
				context.addIssue({
					code: "custom",
					path: ["cases", index],
					message: "Case ID and version must be unique.",
				});
			}
			seen.add(key);
		}
	});

const ValidatedAlignmentCorpusSchema =
	AlignmentCorpusSchema.brand<"ValidatedAlignmentCorpus">();
export type ValidatedAlignmentCorpus = DeepReadonly<
	z.infer<typeof ValidatedAlignmentCorpusSchema>
>;

export type AlignmentCorpusIssue = {
	readonly path: string;
	readonly message: string;
};

export function parseAlignmentCorpus(
	input: unknown,
):
	| { readonly ok: true; readonly value: ValidatedAlignmentCorpus }
	| { readonly ok: false; readonly issues: readonly AlignmentCorpusIssue[] } {
	const parsed = ValidatedAlignmentCorpusSchema.safeParse(input);
	if (!parsed.success)
		return {
			ok: false,
			issues: parsed.error.issues.map((issue) => ({
				path: `$.${issue.path.join(".")}`,
				message: issue.message,
			})),
		};
	freezeTree(parsed.data);
	return { ok: true, value: parsed.data };
}
