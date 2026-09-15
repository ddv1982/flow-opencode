import { z } from "zod";
import { type DeepReadonly, freezeTree } from "./validated.js";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CaseIdSchema = z
	.string()
	.min(1)
	.max(256)
	.regex(/\S/)
	.refine((value) => value.isWellFormed());
const CaseVersionSchema = z.number().int().safe().positive();
const CountSchema = z.number().int().safe().nonnegative();
const RateSchema = z.number().finite().min(0).max(1);

export const EvidenceClassSchema = z.enum([
	"conformance",
	"regression",
	"capability",
	"compatibility",
	"reviewer-only",
	"paired-value",
]);

export const CasePolicySchema = z
	.object({
		caseId: CaseIdSchema,
		caseVersion: CaseVersionSchema,
		evidenceClass: EvidenceClassSchema,
		oracle: z.enum([
			"durable-state",
			"hidden-executable",
			"trajectory",
			"fixed-review-label",
		]),
		release: z.enum(["required", "report-only"]),
		minProviders: CountSchema.positive(),
		minScoredAttempts: CountSchema.positive(),
		minPassRate: RateSchema.nullable(),
		reviewerPromotionRecordSha256: DigestSchema.nullable(),
	})
	.strict()
	.superRefine((policy, context) => {
		const reviewerPolicy = policy.evidenceClass === "reviewer-only";
		if (reviewerPolicy !== (policy.oracle === "fixed-review-label")) {
			context.addIssue({
				code: "custom",
				path: ["oracle"],
				message:
					"Fixed-review-label oracles are required exactly for reviewer-only cases.",
			});
		}
		if (
			policy.evidenceClass === "paired-value" &&
			policy.oracle !== "hidden-executable"
		) {
			context.addIssue({
				code: "custom",
				path: ["oracle"],
				message: "Paired-value cases require a hidden-executable oracle.",
			});
		}
		if (policy.release === "required" && policy.minPassRate === null) {
			context.addIssue({
				code: "custom",
				path: ["minPassRate"],
				message: "Required release cases require a minimum pass rate.",
			});
		}
		if (
			reviewerPolicy &&
			policy.release === "required" &&
			policy.reviewerPromotionRecordSha256 === null
		) {
			context.addIssue({
				code: "custom",
				path: ["reviewerPromotionRecordSha256"],
				message:
					"Required reviewer-only cases require a promotion record digest.",
			});
		}
		if (!reviewerPolicy && policy.reviewerPromotionRecordSha256 !== null) {
			context.addIssue({
				code: "custom",
				path: ["reviewerPromotionRecordSha256"],
				message:
					"Only reviewer-only cases may declare a promotion record digest.",
			});
		}
	});

export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;
export type CasePolicy = z.infer<typeof CasePolicySchema>;

export type CatalogIssue = {
	readonly path: string;
	readonly code: "schema" | "missing" | "duplicate" | "policy";
	readonly message: string;
};

export const CaseCatalogSchema = z
	.array(CasePolicySchema)
	.min(1)
	.superRefine((catalog, context) => {
		const known = new Set<string>();
		for (const [index, policy] of catalog.entries()) {
			const key = `${policy.caseId}\u0000${policy.caseVersion}`;
			if (known.has(key)) {
				context.addIssue({
					code: "custom",
					path: [index],
					message: "Case id and version must be unique.",
				});
			}
			known.add(key);
		}
	});

const ValidatedCaseCatalogSchema =
	CaseCatalogSchema.brand<"ValidatedCaseCatalog">();
export type ValidatedCaseCatalog = DeepReadonly<
	z.infer<typeof ValidatedCaseCatalogSchema>
>;

function pathText(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "$" : `$.${path.join(".")}`;
}

function hasPath(input: unknown, path: readonly PropertyKey[]): boolean {
	let current = input;
	for (const segment of path) {
		if (current === null || typeof current !== "object") return false;
		if (!Object.hasOwn(current, segment)) return false;
		current = Reflect.get(current, segment);
	}
	return true;
}

function catalogIssue(input: unknown, issue: z.core.$ZodIssue): CatalogIssue {
	const missing = issue.code === "invalid_type" && !hasPath(input, issue.path);
	return {
		path: pathText(issue.path),
		code: missing
			? "missing"
			: issue.message === "Case id and version must be unique."
				? "duplicate"
				: issue.code === "custom"
					? "policy"
					: "schema",
		message:
			issue.message === "Case id and version must be unique." ||
			issue.code === "custom"
				? issue.message
				: missing
					? "Missing required value."
					: "Invalid catalog value.",
	};
}

export function parseCaseCatalog(
	input: unknown,
):
	| { readonly ok: true; readonly value: ValidatedCaseCatalog }
	| { readonly ok: false; readonly issues: readonly CatalogIssue[] } {
	const parsed = CaseCatalogSchema.safeParse(input);
	if (!parsed.success) {
		return {
			ok: false,
			issues: parsed.error.issues.map((item) => catalogIssue(input, item)),
		};
	}
	const value = ValidatedCaseCatalogSchema.parse(parsed.data);
	freezeTree(value);
	return { ok: true, value };
}
