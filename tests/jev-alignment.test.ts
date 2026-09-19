import { describe, expect, test } from "bun:test";
import {
	mapSameGoalResponse,
	mapSameGoalScore,
	parseSameGoalResponse,
	SAME_GOAL_CONFIDENCE_MIN,
	SAME_GOAL_SCORE_MIN,
	sameGoalSystemOneBody,
	scoreAlignmentLabel,
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
				mapSameGoalScore({ score: 2, confidence: 0.79 }),
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
});
