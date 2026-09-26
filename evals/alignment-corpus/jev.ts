import { z } from "zod";
import {
	JEV_ENDPOINT,
	JEV_PINNED_MODEL,
} from "../../src/infrastructure/jev-transport.js";
import { type DeepReadonly, freezeTree } from "../validated.js";

export { JEV_ENDPOINT };
export const JEV_MODEL = JEV_PINNED_MODEL;
export const SAME_GOAL_QUESTION_ID = "same_goal";
export const SAME_GOAL_SCORE_MIN = 1.6;
export const SAME_GOAL_CONFIDENCE_MIN = 0.6;
export const SAME_GOAL_TOP_LEVEL = 2;

export const SAME_GOAL_CRITERIA = [
	"The request replaces the active goal or asks for a different product outcome, such as an unrelated feature.",
	"The request keeps some active work but also adds a promised outcome the goal did not include, including implementation after an inspect-only or no-source-edit goal, or mixed extra scope.",
	"The request only continues or narrows the same promised outcome: method or emphasis change, extra evidence, or approval to carry out the already promised plan. It does not add a new deliverable.",
] as const;

export const SAME_GOAL_INSTRUCTIONS =
	"How much does the user request continue the same promised outcome as the active goal? Judge promised outcome, not method. Implementation after an inspect-only or no-source-edit goal is not the same outcome.";

const ScoreAnswerSchema = z.object({
	type: z.literal("score"),
	score: z.number().finite().min(0).max(SAME_GOAL_TOP_LEVEL),
	confidence: z.number().finite().min(0).max(1),
});

const SystemOneResponseSchema = z.object({
	answers: z.object({
		[SAME_GOAL_QUESTION_ID]: ScoreAnswerSchema,
	}),
});

const ValidatedScoreAnswerSchema =
	ScoreAnswerSchema.brand<"ValidatedSameGoalScore">();

export type ValidatedSameGoalScore = DeepReadonly<
	z.infer<typeof ValidatedScoreAnswerSchema>
>;

export type AlignmentMappedOutcome =
	| "continue"
	| "new-scope"
	| "abstain"
	| "error";

export type AlignmentLabelVerdict = "match" | "mismatch" | "unscored";

export type AlignmentVetoDecision = "veto" | "pass";

export type AlignmentVetoVerdict =
	| "correct-veto"
	| "false-veto"
	| "missed-veto"
	| "correct-pass";

export type JevParseIssue = {
	readonly path: string;
	readonly message: string;
};

export function alignmentState(
	activeGoal: string,
	userRequest: string,
): string {
	return `Active goal: ${activeGoal}\n\nUser request: ${userRequest}`;
}

export function sameGoalSystemOneBody(
	activeGoal: string,
	userRequest: string,
): {
	readonly state: string;
	readonly model: typeof JEV_MODEL;
	readonly questions: {
		readonly same_goal: {
			readonly type: "score";
			readonly instructions: typeof SAME_GOAL_INSTRUCTIONS;
			readonly criteria: readonly [
				(typeof SAME_GOAL_CRITERIA)[0],
				(typeof SAME_GOAL_CRITERIA)[1],
				(typeof SAME_GOAL_CRITERIA)[2],
			];
		};
	};
} {
	return {
		state: alignmentState(activeGoal, userRequest),
		model: JEV_MODEL,
		questions: {
			same_goal: {
				type: "score",
				instructions: SAME_GOAL_INSTRUCTIONS,
				criteria: SAME_GOAL_CRITERIA,
			},
		},
	};
}

export function parseSameGoalScore(
	input: unknown,
):
	| { readonly ok: true; readonly value: ValidatedSameGoalScore }
	| { readonly ok: false; readonly issues: readonly JevParseIssue[] } {
	const parsed = ValidatedScoreAnswerSchema.safeParse(input);
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

export function parseSameGoalResponse(
	input: unknown,
):
	| { readonly ok: true; readonly value: ValidatedSameGoalScore }
	| { readonly ok: false; readonly issues: readonly JevParseIssue[] } {
	const parsed = SystemOneResponseSchema.safeParse(input);
	if (!parsed.success)
		return {
			ok: false,
			issues: parsed.error.issues.map((issue) => ({
				path: `$.${issue.path.join(".")}`,
				message: issue.message,
			})),
		};
	return parseSameGoalScore(parsed.data.answers[SAME_GOAL_QUESTION_ID]);
}

export function mapSameGoalScore(input: {
	readonly score: number;
	readonly confidence: number;
}): AlignmentMappedOutcome {
	const parsed = parseSameGoalScore({
		type: "score",
		score: input.score,
		confidence: input.confidence,
	});
	if (!parsed.ok) return "error";
	if (parsed.value.confidence < SAME_GOAL_CONFIDENCE_MIN) return "abstain";
	if (parsed.value.score >= SAME_GOAL_SCORE_MIN) return "continue";
	return "new-scope";
}

export function mapSameGoalResponse(input: unknown): AlignmentMappedOutcome {
	const parsed = parseSameGoalResponse(input);
	if (!parsed.ok) return "error";
	return mapSameGoalScore(parsed.value);
}

export function scoreAlignmentLabel(
	expected: "continue" | "new-scope",
	mapped: AlignmentMappedOutcome,
): AlignmentLabelVerdict {
	if (mapped === "abstain" || mapped === "error") return "unscored";
	return mapped === expected ? "match" : "mismatch";
}

export function shadowNewScopeVeto(
	mapped: AlignmentMappedOutcome,
): AlignmentVetoDecision {
	return mapped === "new-scope" ? "veto" : "pass";
}

export function scoreVetoShadow(
	expected: "continue" | "new-scope",
	veto: AlignmentVetoDecision,
): AlignmentVetoVerdict {
	if (veto === "veto")
		return expected === "new-scope" ? "correct-veto" : "false-veto";
	return expected === "new-scope" ? "missed-veto" : "correct-pass";
}

const AlignmentMetadataSchema = z.object({
	model: z.literal(JEV_MODEL),
	usage: z.object({
		input_tokens: z.number().int().safe().nonnegative(),
		output_tokens: z.number().int().safe().nonnegative(),
	}),
	answers: z.object({
		same_goal: ScoreAnswerSchema.extend({
			probabilities: z
				.object({
					"0": z.number().finite().min(0).max(1),
					"1": z.number().finite().min(0).max(1),
					"2": z.number().finite().min(0).max(1),
				})
				.strict(),
		}),
	}),
});
export function parseAlignmentMetadata(input: unknown) {
	const parsed = AlignmentMetadataSchema.safeParse(input);
	if (!parsed.success) return null;
	const probabilities = parsed.data.answers.same_goal.probabilities;
	if (
		Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) >
		1e-6
	)
		return null;
	return {
		resolvedModel: parsed.data.model,
		inputTokens: parsed.data.usage.input_tokens,
		outputTokens: parsed.data.usage.output_tokens,
		probabilities,
	};
}
