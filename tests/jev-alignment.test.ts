import { describe, expect, test } from "bun:test";
import {
	mapSameGoalResponse,
	mapSameGoalScore,
	parseSameGoalResponse,
	SAME_GOAL_CONFIDENCE_MIN,
	SAME_GOAL_SCORE_MIN,
	sameGoalSystemOneBody,
	scoreAlignmentLabel,
	scoreVetoShadow,
	shadowNewScopeVeto,
} from "../evals/alignment-corpus/jev.js";
import { parseAlignmentCorpus } from "../evals/alignment-corpus/schema.js";
import v1 from "../evals/alignment-corpus/v1.json" with { type: "json" };

function scoreAnswer(score: number, confidence: number) {
	return {
		answers: {
			same_goal: {
				type: "score",
				score,
				confidence,
			},
		},
	};
}

describe("jev alignment mapping", () => {
	test("maps high same_goal score and confidence to continue", () => {
		expect(
			mapSameGoalScore({
				score: SAME_GOAL_SCORE_MIN,
				confidence: SAME_GOAL_CONFIDENCE_MIN,
			}),
		).toBe("continue");
		expect(mapSameGoalResponse(scoreAnswer(2, 0.9))).toBe("continue");
	});

	test("maps a confident score below the continue threshold to new-scope", () => {
		expect(
			mapSameGoalScore({
				score: SAME_GOAL_SCORE_MIN - 0.01,
				confidence: 0.9,
			}),
		).toBe("new-scope");
	});

	test("abstains when confidence is below the pin", () => {
		expect(
			mapSameGoalScore({
				score: 2,
				confidence: SAME_GOAL_CONFIDENCE_MIN - 0.01,
			}),
		).toBe("abstain");
		expect(
			scoreAlignmentLabel(
				"continue",
				mapSameGoalScore({
					score: 2,
					confidence: SAME_GOAL_CONFIDENCE_MIN - 0.01,
				}),
			),
		).toBe("unscored");
	});

	test("records malformed and out-of-range payloads as error, never continue", () => {
		for (const input of [
			{},
			{ answers: { same_goal: { type: "noul", noul: 1 } } },
			scoreAnswer(3, 0.9),
			scoreAnswer(1, 1.2),
			{ answers: { other: { type: "score", score: 2, confidence: 1 } } },
		]) {
			expect(parseSameGoalResponse(input).ok).toBe(false);
			expect(mapSameGoalResponse(input)).toBe("error");
			expect(scoreAlignmentLabel("continue", mapSameGoalResponse(input))).toBe(
				"unscored",
			);
		}
		expect(mapSameGoalScore({ score: 3, confidence: 0.9 })).toBe("error");
		expect(mapSameGoalScore({ score: 2, confidence: Number.NaN })).toBe(
			"error",
		);
		expect(
			scoreAlignmentLabel(
				"continue",
				mapSameGoalScore({ score: 2, confidence: Number.NaN }),
			),
		).toBe("unscored");
	});

	test("inspect-to-implement corpus case cannot count as a correct continuation", () => {
		const parsed = parseAlignmentCorpus(v1);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		const inspect = parsed.value.cases.find(
			(entry) => entry.id === "inspect-vs-implement",
		);
		if (!inspect) throw new Error("Expected inspect-vs-implement v1 case.");
		expect(inspect.expectedChoice).toBe("new-scope");
		expect(
			scoreAlignmentLabel("new-scope", mapSameGoalResponse(scoreAnswer(2, 1))),
		).toBe("mismatch");
	});

	test("mixed-scope corpus case cannot count as a correct continuation", () => {
		const parsed = parseAlignmentCorpus(v1);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
		const mixed = parsed.value.cases.find(
			(entry) => entry.category === "mixed-scope",
		);
		if (!mixed) throw new Error("Expected a mixed-scope v1 case.");
		expect(mixed.expectedChoice).toBe("new-scope");
		const body = sameGoalSystemOneBody(mixed.activeGoal, mixed.userRequest);
		expect(body.questions.same_goal.criteria).toHaveLength(3);
		expect(body.state).toContain(mixed.activeGoal);
		expect(body.state).toContain(mixed.userRequest);
		expect(
			scoreAlignmentLabel("new-scope", mapSameGoalResponse(scoreAnswer(2, 1))),
		).toBe("mismatch");
		expect(
			scoreAlignmentLabel(
				mixed.expectedChoice,
				mapSameGoalResponse(scoreAnswer(1, 0.9)),
			),
		).toBe("match");
	});

	test("shadow veto fires only on mapped new-scope", () => {
		expect(shadowNewScopeVeto("new-scope")).toBe("veto");
		expect(shadowNewScopeVeto("continue")).toBe("pass");
		expect(shadowNewScopeVeto("abstain")).toBe("pass");
		expect(shadowNewScopeVeto("error")).toBe("pass");
		expect(scoreVetoShadow("new-scope", "veto")).toBe("correct-veto");
		expect(scoreVetoShadow("continue", "veto")).toBe("false-veto");
		expect(scoreVetoShadow("new-scope", "pass")).toBe("missed-veto");
		expect(scoreVetoShadow("continue", "pass")).toBe("correct-pass");
		expect(
			scoreVetoShadow(
				"new-scope",
				shadowNewScopeVeto(mapSameGoalResponse(scoreAnswer(1, 0.9))),
			),
		).toBe("correct-veto");
		expect(
			scoreVetoShadow(
				"continue",
				shadowNewScopeVeto(
					mapSameGoalScore({
						score: 2,
						confidence: SAME_GOAL_CONFIDENCE_MIN - 0.01,
					}),
				),
			),
		).toBe("correct-pass");
	});
});
