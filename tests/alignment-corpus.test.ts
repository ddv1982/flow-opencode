import { describe, expect, test } from "bun:test";
import { parseAlignmentCorpus } from "../evals/alignment-corpus/schema.js";
import v1 from "../evals/alignment-corpus/v1.json" with { type: "json" };

describe("alignment corpus", () => {
	test("parses v1 and freezes the checked-in fixture", () => {
		const parsed = parseAlignmentCorpus(v1);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		expect(parsed.value.schemaVersion).toBe(1);
		expect(Object.isFrozen(parsed.value)).toBe(true);
		expect(Object.isFrozen(parsed.value.cases[0])).toBe(true);
	});

	test("requires continue, new-scope, and mixed-scope labeled new-scope", () => {
		const parsed = parseAlignmentCorpus(v1);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		const choices = new Set(
			parsed.value.cases.map((entry) => entry.expectedChoice),
		);
		const mixed = parsed.value.cases.filter(
			(entry) => entry.category === "mixed-scope",
		);
		expect(choices.has("continue")).toBe(true);
		expect(choices.has("new-scope")).toBe(true);
		expect(mixed.length).toBeGreaterThan(0);
		expect(mixed.every((entry) => entry.expectedChoice === "new-scope")).toBe(
			true,
		);
	});

	test("rejects malformed versions, unknown fields, duplicates, and mixed-scope continue", () => {
		const base = structuredClone(v1);
		const first = base.cases[0];
		if (!first) throw new Error("Expected a v1 case.");
		for (const input of [
			{ ...base, schemaVersion: 2 },
			{ ...base, extra: true },
			{ ...base, cases: [] },
			{ ...base, cases: [first, { ...first }] },
			{
				...base,
				cases: [
					{
						...first,
						id: "mixed-continue",
						category: "mixed-scope",
						expectedChoice: "continue",
					},
				],
			},
			{
				...base,
				cases: [{ ...first, expectedChoice: "uncertain" }],
			},
		])
			expect(parseAlignmentCorpus(input).ok).toBe(false);
	});
});
