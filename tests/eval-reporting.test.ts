import { describe, expect, test } from "bun:test";
import { onlyAwaitingAnswer, reportedCost } from "../evals/harness.js";

// Running the harness needs credentials and money, so the two rules that decide
// what a run *means* are proven here. Both were wrong in recorded runs: unpriced
// spend printed as `$0.0000`, and a session blocked on an unanswerable question
// burned its full twenty-minute timeout before being scored as a failure.
describe("eval run classification", () => {
	test("ends the wait when a question is the only incomplete call", () => {
		expect(onlyAwaitingAnswer(["question:running"])).toBe(true);
		expect(onlyAwaitingAnswer(["question:pending", "question:running"])).toBe(
			true,
		);
	});

	test("keeps waiting while any other call could still make progress", () => {
		// A long command is progress waiting to happen, including beside a question.
		expect(onlyAwaitingAnswer(["bash:running"])).toBe(false);
		expect(onlyAwaitingAnswer(["question:running", "bash:running"])).toBe(
			false,
		);
		expect(onlyAwaitingAnswer([])).toBe(false);
	});
});

describe("eval cost reporting", () => {
	test("reports a priced run", () => {
		expect(reportedCost(1.25, 4_000)).toBe(1.25);
	});

	test("treats an absent cost as unknown", () => {
		expect(reportedCost(null, 4_000)).toBeNull();
	});

	test("treats zero against real output as unknown, not free", () => {
		// The recorded failure: the provider reports `cost: 0` rather than omitting
		// the field, so an absent-only check summarised real spend as $0.0000.
		expect(reportedCost(0, 4_000)).toBeNull();
	});

	test("reports zero for a run that produced no output", () => {
		expect(reportedCost(0, 0)).toBe(0);
	});
});
