import { expect, spyOn, test } from "bun:test";
import type { DecisionPacket } from "../src/application/ports/decision-provider.js";
import { createJevDecisionProvider } from "../src/infrastructure/jev-decision-provider.js";

const packet: DecisionPacket = {
	sessionId: "s",
	revision: 3,
	sourceDigest: "sha256:abc",
	goal: "Fix parser",
	planDigest: "abc",
	rubric: "recovery-v1",
	findings: [{ id: "f", summary: "Null input", evidence: "parser.ts" }],
	candidates: [
		{
			id: "repair",
			action: "retry",
			featureId: "parser",
			remedy: "Guard null",
			changedFromPreviousAttempt: "Check before coercion",
			findingIds: ["f"],
		},
	],
};
const response = () => ({
	model: "jev-1.13.0",
	answers: {
		choice: {
			type: "choice",
			choice: "repair",
			probabilities: { repair: 0.99, abstain: 0.01 },
			confidence: 0.9,
		},
		goal_0: { type: "noul", noul: 0.99 },
		fit_0: { type: "noul", noul: 0.98 },
	},
	usage: { input_tokens: 100, output_tokens: 10 },
});
test("runtime adapter validates pinned atomic judgments through shared bounded transport", async () => {
	const spy = spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json(response()),
	);
	try {
		const result = await createJevDecisionProvider(() => "credential").assess(
			packet,
			{ signal: new AbortController().signal, reserveAttempt: () => true },
		);
		expect(result).toMatchObject({
			kind: "answered",
			model: "jev-1.13.0",
			choice: "repair",
			assessments: { repair: { goal: 0.99, suitability: 0.98 } },
			inputTokens: 100,
		});
		expect(spy.mock.calls[0]?.[0]).toBe("https://api.typesafe.ai/v1/systemone");
		expect(spy.mock.calls[0]?.[1]?.redirect).toBe("error");
	} finally {
		spy.mockRestore();
	}
});
test("runtime adapter refuses absent keys and sensitive packets before transport", async () => {
	const spy = spyOn(globalThis, "fetch").mockRejectedValue(
		new Error("must not fetch"),
	);
	try {
		const options = {
			signal: new AbortController().signal,
			reserveAttempt: () => true,
		};
		expect(
			await createJevDecisionProvider(() => undefined).assess(packet, options),
		).toEqual({ kind: "unavailable", reason: "missing-key" });
		expect(
			await createJevDecisionProvider(() => "credential").assess(
				{ ...packet, goal: "password=credential" },
				options,
			),
		).toEqual({ kind: "unavailable", reason: "sensitive-packet" });
		expect(spy).toHaveBeenCalledTimes(0);
	} finally {
		spy.mockRestore();
	}
});
test("runtime adapter rejects unknown model and invalid distributions", async () => {
	for (const payload of [
		{ ...response(), model: "jev-latest" },
		{ ...response(), answers: {} },
		{
			...response(),
			answers: {
				...response().answers,
				choice: {
					...response().answers.choice,
					probabilities: { repair: 0.9, abstain: 0.9 },
				},
			},
		},
	]) {
		const spy = spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json(payload),
		);
		try {
			expect(
				(
					await createJevDecisionProvider(() => "credential").assess(packet, {
						signal: new AbortController().signal,
						reserveAttempt: () => true,
					})
				).kind,
			).toBe("unavailable");
		} finally {
			spy.mockRestore();
		}
	}
});
