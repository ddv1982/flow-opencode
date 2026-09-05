import { describe, expect, test } from "bun:test";
import { CampaignCancelled } from "../evals/campaign-stop.js";
import {
	attemptFailure,
	EvaluationPersistenceError,
	evaluateScenario,
	evaluationPhase,
	evaluatorFailure,
	failureOutcome,
	isEvaluatorFailure,
	persistEvaluation,
	preservePrimaryFailure,
	providerFailure,
	strongestFailureOrigin,
} from "../evals/failure-origin.js";

describe("eval failure origins", () => {
	test("preserves operator cancellation through phase wrappers", async () => {
		const reason = new CampaignCancelled(143);
		await expect(
			evaluationPhase("host", "command-aborted", true, async () => {
				throw reason;
			}),
		).rejects.toBe(reason);
	});

	test("cleanup failure takes precedence over operator cancellation", async () => {
		const cleanup = new EvaluationPersistenceError("credentials", "disk full");
		await expect(
			preservePrimaryFailure(
				async () => {
					throw new CampaignCancelled(130);
				},
				async () => {
					throw cleanup;
				},
			),
		).rejects.toBe(cleanup);
	});
	test("turns every grader throw into a non-retryable evaluator failure", () => {
		for (const thrown of [new Error("grader exploded"), "grader exploded"]) {
			const evaluated = evaluateScenario(
				() => {
					throw thrown;
				},
				{ durable: true },
			);
			expect(evaluated).toEqual({
				kind: "failure",
				failure: {
					origin: "evaluator",
					code: "scenario-check-threw",
					detail: "grader exploded",
					retryable: false,
				},
			});
		}
	});

	test("returns grader issues without manufacturing a failure", () => {
		expect(evaluateScenario(() => ["missing closure"], {})).toEqual({
			kind: "evaluated",
			issues: ["missing closure"],
		});
	});

	test("preserves every failure origin in the durable outcome", () => {
		for (const origin of ["provider", "host", "evaluator"] as const) {
			expect(
				failureOutcome(attemptFailure(origin, "fixture", origin, false)),
			).toEqual({
				kind: "failure",
				origin,
				code: "fixture",
				retryable: false,
			});
		}
	});

	test("attributes assistant-message errors to the provider boundary", () => {
		expect(
			providerFailure({ name: "APIError", providerID: "xai" }),
		).toMatchObject({
			origin: "provider",
			code: "provider-rejected-turn",
		});
	});

	test("keeps tagged host failures external and defaults unknown code to evaluator", async () => {
		let tagged: unknown;
		try {
			await evaluationPhase("host", "session-create-failed", true, () =>
				Promise.reject(new Error("connection lost")),
			);
		} catch (error) {
			tagged = error;
		}
		expect(evaluatorFailure(tagged)).toMatchObject({
			origin: "host",
			code: "session-create-failed",
			retryable: true,
		});
		expect(evaluatorFailure(new Error("parser bug"))).toMatchObject({
			origin: "evaluator",
			code: "evaluator-transform-threw",
			retryable: false,
		});
	});

	test("stops on one persistence failure without retrying the write", async () => {
		let writes = 0;
		await expect(
			persistEvaluation("attempt", async () => {
				writes += 1;
				throw new Error("disk full");
			}),
		).rejects.toMatchObject({
			failure: {
				origin: "persistence",
				code: "attempt-write-failed",
				detail: "disk full",
				retryable: false,
			},
		});
		expect(writes).toBe(1);
	});

	test("preserves a primary persistence failure when cleanup also fails", async () => {
		let caught: unknown;
		try {
			await preservePrimaryFailure(
				() => Promise.reject(new EvaluationPersistenceError("attempt", "disk")),
				() => Promise.reject(new Error("cleanup")),
			);
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({
			failure: { origin: "persistence", code: "attempt-write-failed" },
		});
		expect(caught).toBeInstanceOf(EvaluationPersistenceError);
		expect(caught instanceof Error ? caught.cause : null).toBeInstanceOf(
			AggregateError,
		);
	});

	test("uses the strongest campaign stop independent of attempt order", () => {
		expect(strongestFailureOrigin(["provider", "evaluator", "host"])).toBe(
			"evaluator",
		);
		expect(strongestFailureOrigin(["host", "persistence"])).toBe("persistence");
		expect(strongestFailureOrigin([])).toBeNull();
	});

	test("marks only evaluator failures as paid-work stop signals", () => {
		expect(isEvaluatorFailure("evaluator")).toBe(true);
		expect(isEvaluatorFailure("provider")).toBe(false);
		expect(isEvaluatorFailure("host")).toBe(false);
		expect(isEvaluatorFailure("persistence")).toBe(false);
	});
});
