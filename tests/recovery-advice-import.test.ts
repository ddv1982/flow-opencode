import { expect, test } from "bun:test";
import { AdviceSchema } from "../evals/recovery-decisions/compare.js";
import development from "../evals/recovery-decisions/development.json" with {
	type: "json",
};
import { evaluateRecoveryCorpus } from "../evals/recovery-decisions/evaluate.js";
import { CorpusSchema } from "../evals/recovery-decisions/schema.js";
import { createJevDecisionProvider } from "../src/infrastructure/jev-decision-provider.js";

async function packet() {
	const prepared = await evaluateRecoveryCorpus(
		CorpusSchema.parse(development),
	);
	const value = prepared.rows.find((row) => row.packet !== null)?.packet;
	if (!value) throw new Error("Missing eligible synthetic packet.");
	return value;
}
const options = () => ({
	signal: new AbortController().signal,
	reserveAttempt: () => true,
});

test("import schema retains production missing-key telemetry without a transport call", async () => {
	let calls = 0;
	const provider = createJevDecisionProvider(
		() => undefined,
		async () => {
			calls++;
			throw new Error("Transport must not run.");
		},
	);
	const advice = await provider.assess(await packet(), options());
	expect(calls).toBe(0);
	expect(AdviceSchema.parse(advice)).toEqual(advice);
});

test("import schema retains validated response telemetry from the production adapter", async () => {
	const value = await packet();
	const choice = value.candidates[0]?.id;
	if (!choice) throw new Error("Missing candidate.");
	const answers: Record<string, unknown> = {
		choice: {
			type: "choice",
			choice,
			confidence: 1,
			probabilities: Object.fromEntries([
				...value.candidates.map((candidate) => [
					candidate.id,
					candidate.id === choice ? 1 : 0,
				]),
				["abstain", 0],
			]),
		},
	};
	for (const [index] of value.candidates.entries()) {
		answers[`goal_${index}`] = { type: "noul", noul: 1 };
		answers[`fit_${index}`] = { type: "noul", noul: 1 };
	}
	const provider = createJevDecisionProvider(
		() => "local-test-placeholder",
		async () =>
			Response.json({
				model: "jev-1.13.0",
				answers,
				usage: { input_tokens: 17, output_tokens: 5 },
			}),
	);
	const advice = await provider.assess(value, options());
	expect(advice.kind).toBe("answered");
	expect(advice.telemetry?.responseUsage).toEqual({
		inputTokens: 17,
		outputTokens: 5,
	});
	expect(AdviceSchema.parse(advice)).toEqual(advice);
});

test("import schema retains unavailable resolved model and unknown response usage", async () => {
	const provider = createJevDecisionProvider(
		() => "local-test-placeholder",
		async () => Response.json({ model: "jev-1.14.0" }),
	);
	const advice = await provider.assess(await packet(), options());
	expect(advice).toMatchObject({
		kind: "unavailable",
		reason: "model-mismatch",
		resolvedModel: "jev-1.14.0",
		telemetry: { transportAttempts: 1, responseUsage: null },
	});
	expect(AdviceSchema.parse(advice)).toEqual(advice);
});
