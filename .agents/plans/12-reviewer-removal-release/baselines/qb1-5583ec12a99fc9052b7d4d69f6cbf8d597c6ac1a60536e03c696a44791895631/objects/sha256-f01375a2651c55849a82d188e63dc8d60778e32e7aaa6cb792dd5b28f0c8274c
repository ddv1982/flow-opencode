import { z } from "zod";

const CountSchema = z.number().int().safe().nonnegative();
const CostSchema = z.number().finite().nonnegative();
const AvailabilitySchema = z.enum(["observed", "incomplete", "unobserved"]);
const TokensSchema = z
	.object({
		input: CountSchema,
		output: CountSchema,
		reasoning: CountSchema,
		cacheRead: CountSchema,
		cacheWrite: CountSchema,
	})
	.strict();
const tokenCategories = TokensSchema.keyof().options;

export const StudyUsageSchema = z
	.object({
		schemaVersion: z.literal(1),
		tokens: TokensSchema,
		costUsd: CostSchema.nullable(),
		costProvenance: z.literal("host-rate-estimate"),
		effectiveServiceTier: z.literal("unobserved"),
		roleAttribution: z.literal("not-recorded"),
		availability: AvailabilitySchema,
		upstreamBreakdown: z.literal("unobserved"),
		completeness: z.literal("unverified"),
	})
	.strict()
	.superRefine((usage, context) => {
		if (!Number.isSafeInteger(usage.tokens.output + usage.tokens.reasoning)) {
			context.addIssue({
				code: "custom",
				path: ["tokens"],
				message: "Generated output tokens exceed the safe integer range.",
			});
		}
		if (
			usage.costUsd === 0 &&
			Object.values(usage.tokens).some((count) => count > 0)
		) {
			context.addIssue({
				code: "custom",
				path: ["costUsd"],
				message: "Zero reported cost with token usage must be unknown.",
			});
		}
	});

export type StudyUsage = z.infer<typeof StudyUsageSchema>;

const StudyUsageInputSchema = z
	.object({
		tokens: TokensSchema.partial(),
		costUsd: CostSchema.nullable().optional(),
		availability: AvailabilitySchema.optional(),
	})
	.strict();

export function normalizeStudyUsage(input: {
	tokens: Partial<StudyUsage["tokens"]>;
	costUsd: number | null | undefined;
	availability?: StudyUsage["availability"];
}): StudyUsage {
	const observed = StudyUsageInputSchema.parse(input);
	const supplied = tokenCategories.filter(
		(category) => observed.tokens[category] !== undefined,
	).length;
	const inferred =
		supplied === 0
			? "unobserved"
			: supplied === tokenCategories.length
				? "observed"
				: "incomplete";
	const availability =
		inferred === "unobserved" || observed.availability === "unobserved"
			? "unobserved"
			: inferred === "incomplete" || observed.availability === "incomplete"
				? "incomplete"
				: "observed";
	const tokens = {
		input: observed.tokens.input ?? 0,
		output: observed.tokens.output ?? 0,
		reasoning: observed.tokens.reasoning ?? 0,
		cacheRead: observed.tokens.cacheRead ?? 0,
		cacheWrite: observed.tokens.cacheWrite ?? 0,
	};
	return StudyUsageSchema.parse({
		schemaVersion: 1,
		tokens,
		costUsd:
			observed.costUsd === 0 && Object.values(tokens).some((count) => count > 0)
				? null
				: (observed.costUsd ?? null),
		costProvenance: "host-rate-estimate",
		effectiveServiceTier: "unobserved",
		roleAttribution: "not-recorded",
		availability,
		upstreamBreakdown: "unobserved",
		completeness: "unverified",
	});
}

export function generatedOutputTokens(usage: StudyUsage): number {
	const { tokens } = StudyUsageSchema.parse(usage);
	return tokens.output + tokens.reasoning;
}

export function aggregateStudyUsage(usages: readonly StudyUsage[]): StudyUsage {
	const tokens = {
		input: 0,
		output: 0,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
	};
	let costUsd = 0;
	let unknownCost = usages.length === 0;
	const availabilities = new Set<StudyUsage["availability"]>();
	for (const usage of usages) {
		const observed = StudyUsageSchema.parse(usage);
		availabilities.add(observed.availability);
		for (const category of tokenCategories) {
			tokens[category] = CountSchema.parse(
				tokens[category] + observed.tokens[category],
			);
		}
		if (observed.costUsd === null) {
			unknownCost = true;
		} else {
			costUsd = CostSchema.parse(costUsd + observed.costUsd);
		}
	}
	const availability =
		availabilities.has("incomplete") || availabilities.size > 1
			? "incomplete"
			: availabilities.has("observed")
				? "observed"
				: "unobserved";
	return normalizeStudyUsage({
		tokens,
		costUsd: unknownCost ? null : costUsd,
		availability,
	});
}
