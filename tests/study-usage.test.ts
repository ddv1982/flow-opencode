import { describe, expect, test } from "bun:test";
import {
	aggregateStudyUsage,
	generatedOutputTokens,
	normalizeStudyUsage,
	type StudyUsage,
	StudyUsageSchema,
} from "../evals/study-usage.js";

const categories: (keyof StudyUsage["tokens"])[] = [
	"input",
	"output",
	"reasoning",
	"cacheRead",
	"cacheWrite",
];
const emptyTokens = {
	input: 0,
	output: 0,
	reasoning: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

describe("study usage normalization", () => {
	test("retains disjoint token categories and host estimate limitations", () => {
		const usage = normalizeStudyUsage({
			tokens: {
				input: 17,
				output: 3,
				reasoning: 5,
				cacheRead: 7,
				cacheWrite: 11,
			},
			costUsd: 0.125,
		});
		expect(usage).toEqual({
			schemaVersion: 1,
			tokens: {
				input: 17,
				output: 3,
				reasoning: 5,
				cacheRead: 7,
				cacheWrite: 11,
			},
			costUsd: 0.125,
			costProvenance: "host-rate-estimate",
			effectiveServiceTier: "unobserved",
			roleAttribution: "not-recorded",
			availability: "observed",
			upstreamBreakdown: "unobserved",
			completeness: "unverified",
		});
		expect(generatedOutputTokens(usage)).toBe(8);
	});

	test.each(categories)(
		"zero reported cost is unknown for %s-only usage",
		(category) => {
			const usage = normalizeStudyUsage({
				tokens: { [category]: 1 },
				costUsd: 0,
			});
			expect(usage.costUsd).toBeNull();
			expect(usage.tokens).toEqual({ ...emptyTokens, [category]: 1 });
			expect(usage.availability).toBe("incomplete");
		},
	);

	test("missing counts become zero without asserting complete accounting", () => {
		const usage = normalizeStudyUsage({ tokens: {}, costUsd: undefined });
		expect(usage.tokens).toEqual(emptyTokens);
		expect(usage.costUsd).toBeNull();
		expect(usage.availability).toBe("unobserved");
		expect(usage.upstreamBreakdown).toBe("unobserved");
		expect(usage.completeness).toBe("unverified");
	});

	test("distinguishes reported zero counters from missing host fields", () => {
		const usage = normalizeStudyUsage({ tokens: emptyTokens, costUsd: 0 });
		expect(usage.tokens).toEqual(emptyTokens);
		expect(usage.availability).toBe("observed");
		expect(usage.upstreamBreakdown).toBe("unobserved");
		expect(usage.completeness).toBe("unverified");
	});

	test("undefined fields cannot establish observed availability", () => {
		const usage = Reflect.apply(normalizeStudyUsage, undefined, [
			{ tokens: { ...emptyTokens, cacheWrite: undefined }, costUsd: 0 },
		]);
		expect(usage.availability).toBe("incomplete");
		expect(usage.tokens).toEqual(emptyTokens);
		const missing = Reflect.apply(normalizeStudyUsage, undefined, [
			{
				tokens: Object.fromEntries(
					categories.map((category) => [category, undefined]),
				),
				costUsd: undefined,
			},
		]);
		expect(missing.availability).toBe("unobserved");
	});

	test("an observed override cannot upgrade partial or missing counters", () => {
		for (const input of [
			{ tokens: {}, expected: "unobserved" },
			{ tokens: { input: 0 }, expected: "incomplete" },
			{
				tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0 },
				expected: "incomplete",
			},
		] satisfies {
			tokens: Partial<StudyUsage["tokens"]>;
			expected: StudyUsage["availability"];
		}[]) {
			expect(
				normalizeStudyUsage({
					tokens: input.tokens,
					costUsd: 0,
					availability: "observed",
				}).availability,
			).toBe(input.expected);
		}
	});

	test("caller coverage can downgrade computed totals", () => {
		for (const availability of ["incomplete", "unobserved"] as const) {
			const usage = normalizeStudyUsage({
				tokens: { ...emptyTokens, output: 3 },
				costUsd: 0.5,
				availability,
			});
			expect(usage.availability).toBe(availability);
			expect(usage.tokens.output).toBe(3);
			expect(usage.costUsd).toBe(0.5);
		}
		expect(
			normalizeStudyUsage({
				tokens: { input: 1 },
				costUsd: null,
				availability: "unobserved",
			}).availability,
		).toBe("unobserved");
		expect(
			normalizeStudyUsage({
				tokens: {},
				costUsd: null,
				availability: "incomplete",
			}).availability,
		).toBe("unobserved");
	});

	test("distinguishes explicit zero estimates from unknown costs", () => {
		for (const costUsd of [0, null, undefined]) {
			expect(
				normalizeStudyUsage({ tokens: emptyTokens, costUsd }).costUsd,
			).toBe(costUsd ?? null);
		}
	});

	test("accepts the safe integer boundary without subtracting cached input", () => {
		const usage = normalizeStudyUsage({
			tokens: {
				input: Number.MAX_SAFE_INTEGER,
				output: Number.MAX_SAFE_INTEGER - 1,
				reasoning: 1,
				cacheRead: 9,
				cacheWrite: 10,
			},
			costUsd: null,
		});
		expect(usage.tokens.input).toBe(Number.MAX_SAFE_INTEGER);
		expect(generatedOutputTokens(usage)).toBe(Number.MAX_SAFE_INTEGER);
	});

	test.each(categories)("rejects invalid %s counts", (category) => {
		for (const count of [
			-1,
			0.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			expect(() =>
				normalizeStudyUsage({ tokens: { [category]: count }, costUsd: null }),
			).toThrow();
		}
	});

	test("rejects invalid reported costs", () => {
		for (const costUsd of [
			-0.01,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]) {
			expect(() => normalizeStudyUsage({ tokens: {}, costUsd })).toThrow();
		}
	});

	test("rejects generated output overflow even when individual counts are safe", () => {
		expect(() =>
			normalizeStudyUsage({
				tokens: { output: Number.MAX_SAFE_INTEGER, reasoning: 1 },
				costUsd: null,
			}),
		).toThrow("Generated output tokens exceed the safe integer range.");
	});
});

describe("canonical study usage schema", () => {
	test("requires explicit counters and uncertainty metadata", () => {
		const usage = normalizeStudyUsage({ tokens: {}, costUsd: null });
		for (const invalid of [
			{ ...usage, tokens: {} },
			{ ...usage, schemaVersion: 2 },
			{ ...usage, costProvenance: "invoice" },
			{ ...usage, effectiveServiceTier: "priority" },
			{ ...usage, roleAttribution: "recorded" },
			{ ...usage, roleAttribution: undefined },
			{ ...usage, availability: "measured" },
			{ ...usage, availability: undefined },
			{ ...usage, upstreamBreakdown: "observed" },
			{ ...usage, upstreamBreakdown: undefined },
			{ ...usage, completeness: "verified" },
			{ ...usage, extra: true },
			{ ...usage, tokens: { ...usage.tokens, total: 0 } },
		]) {
			expect(StudyUsageSchema.safeParse(invalid).success).toBe(false);
		}
	});

	test.each(categories)(
		"rejects zero-cost records with nonzero %s",
		(category) => {
			const usage = normalizeStudyUsage({
				tokens: { [category]: 1 },
				costUsd: null,
			});
			expect(StudyUsageSchema.safeParse({ ...usage, costUsd: 0 }).success).toBe(
				false,
			);
		},
	);

	test("generated output rejects invalid records instead of cancelling bad counts", () => {
		const usage = normalizeStudyUsage({ tokens: { output: 2 }, costUsd: null });
		expect(() =>
			generatedOutputTokens({
				...usage,
				tokens: { ...usage.tokens, reasoning: -1 },
			}),
		).toThrow();
		expect(() =>
			generatedOutputTokens({
				...usage,
				tokens: {
					...usage.tokens,
					output: Number.MAX_SAFE_INTEGER,
					reasoning: 1,
				},
			}),
		).toThrow("Generated output tokens exceed the safe integer range.");
	});
});

describe("study usage aggregation", () => {
	test("sums all five categories once and preserves estimate metadata", () => {
		const usages = [
			normalizeStudyUsage({
				tokens: {
					input: 10,
					output: 2,
					reasoning: 3,
					cacheRead: 4,
					cacheWrite: 5,
				},
				costUsd: 0.1,
			}),
			normalizeStudyUsage({
				tokens: {
					input: 20,
					output: 7,
					reasoning: 11,
					cacheRead: 13,
					cacheWrite: 17,
				},
				costUsd: 0.2,
			}),
		];
		const before = structuredClone(usages);
		const total = aggregateStudyUsage(usages);
		expect(total.tokens).toEqual({
			input: 30,
			output: 9,
			reasoning: 14,
			cacheRead: 17,
			cacheWrite: 22,
		});
		expect(total.costUsd).toBeCloseTo(0.3);
		expect(generatedOutputTokens(total)).toBe(23);
		expect(total.costProvenance).toBe("host-rate-estimate");
		expect(total.effectiveServiceTier).toBe("unobserved");
		expect(total.roleAttribution).toBe("not-recorded");
		expect(total.availability).toBe("observed");
		expect(total.upstreamBreakdown).toBe("unobserved");
		expect(total.completeness).toBe("unverified");
		expect(usages).toEqual(before);
	});

	test("an empty aggregate has no observed cost estimate", () => {
		const usage = aggregateStudyUsage([]);
		expect(usage.tokens).toEqual(emptyTokens);
		expect(usage.costUsd).toBeNull();
		expect(usage.availability).toBe("unobserved");
		expect(usage.upstreamBreakdown).toBe("unobserved");
		expect(usage.completeness).toBe("unverified");
		expect(generatedOutputTokens(usage)).toBe(0);
	});

	test("explicit zero estimates remain zero when every observed category is zero", () => {
		expect(
			aggregateStudyUsage([
				normalizeStudyUsage({ tokens: emptyTokens, costUsd: 0 }),
				normalizeStudyUsage({ tokens: emptyTokens, costUsd: 0 }),
			]).costUsd,
		).toBe(0);
	});

	test.each([
		{ left: "observed", right: "observed", expected: "observed" },
		{ left: "observed", right: "incomplete", expected: "incomplete" },
		{ left: "observed", right: "unobserved", expected: "incomplete" },
		{ left: "incomplete", right: "observed", expected: "incomplete" },
		{ left: "incomplete", right: "incomplete", expected: "incomplete" },
		{ left: "incomplete", right: "unobserved", expected: "incomplete" },
		{ left: "unobserved", right: "observed", expected: "incomplete" },
		{ left: "unobserved", right: "incomplete", expected: "incomplete" },
		{ left: "unobserved", right: "unobserved", expected: "unobserved" },
	] satisfies {
		left: StudyUsage["availability"];
		right: StudyUsage["availability"];
		expected: StudyUsage["availability"];
	}[])(
		"combines $left and $right coverage as $expected",
		({ left, right, expected }) => {
			const usage = aggregateStudyUsage(
				[left, right].map((availability) =>
					normalizeStudyUsage({
						tokens: emptyTokens,
						costUsd: 0,
						availability,
					}),
				),
			);
			expect(usage.availability).toBe(expected);
			expect(usage.tokens).toEqual(emptyTokens);
		},
	);

	test("missing message coverage survives later complete observations", () => {
		const observed = normalizeStudyUsage({
			tokens: { ...emptyTokens, output: 3 },
			costUsd: 0.1,
		});
		const unobserved = normalizeStudyUsage({ tokens: {}, costUsd: null });
		for (const usages of [
			[unobserved, observed, observed],
			[observed, unobserved, observed],
			[observed, observed, unobserved],
		]) {
			const usage = aggregateStudyUsage(usages);
			expect(usage.availability).toBe("incomplete");
			expect(usage.tokens.output).toBe(6);
			expect(usage.costUsd).toBeNull();
		}
	});

	test("unknown cost survives known estimates in any position", () => {
		const known = normalizeStudyUsage({ tokens: { output: 3 }, costUsd: 0.1 });
		const unknown = normalizeStudyUsage({
			tokens: { reasoning: 2 },
			costUsd: 0,
		});
		for (const usages of [
			[unknown, known, known],
			[known, unknown, known],
			[known, known, unknown],
		]) {
			const usage = aggregateStudyUsage(usages);
			expect(usage.costUsd).toBeNull();
			expect(generatedOutputTokens(usage)).toBe(8);
		}
		expect(aggregateStudyUsage([unknown, unknown]).costUsd).toBeNull();
	});

	test.each(categories)("rejects %s aggregation overflow", (category) => {
		const full = normalizeStudyUsage({
			tokens: { [category]: Number.MAX_SAFE_INTEGER },
			costUsd: null,
		});
		const extra = normalizeStudyUsage({
			tokens: { [category]: 1 },
			costUsd: null,
		});
		expect(() => aggregateStudyUsage([full, extra])).toThrow();
	});

	test("rejects generated total overflow across separate output and reasoning records", () => {
		const output = normalizeStudyUsage({
			tokens: { output: Number.MAX_SAFE_INTEGER },
			costUsd: null,
		});
		const reasoning = normalizeStudyUsage({
			tokens: { reasoning: 1 },
			costUsd: null,
		});
		expect(() => aggregateStudyUsage([output, reasoning])).toThrow(
			"Generated output tokens exceed the safe integer range.",
		);
	});

	test("rejects cost overflow", () => {
		const usage = normalizeStudyUsage({
			tokens: {},
			costUsd: Number.MAX_VALUE,
		});
		expect(() => aggregateStudyUsage([usage, usage])).toThrow();
	});

	test("unknown estimates cannot hide cost overflow in any position", () => {
		const known = normalizeStudyUsage({
			tokens: {},
			costUsd: Number.MAX_VALUE,
		});
		const unknown = normalizeStudyUsage({ tokens: {}, costUsd: null });
		for (const usages of [
			[unknown, known, known],
			[known, unknown, known],
			[known, known, unknown],
		]) {
			expect(() => aggregateStudyUsage(usages)).toThrow();
		}
	});

	test("rejects malformed records before summing", () => {
		const usage = normalizeStudyUsage({ tokens: {}, costUsd: null });
		const invalid = { ...usage, tokens: { ...usage.tokens, cacheRead: -1 } };
		expect(() => aggregateStudyUsage([invalid, usage])).toThrow();
	});
});
