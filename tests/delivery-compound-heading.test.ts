import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { checkReviewerEvidenceAccess } from "../evals/reviewer-access.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-combined-heading-answer.json" with {
	type: "json",
};

const goal = saved.goal;
const actualAnswer = saved.answer;
const heading = "**Completed and archived — 1 of 1 features complete.**";
const canonical = actualAnswer.replace(
	heading,
	"Closure: completed.\nProgress: 1 of 1 features complete.",
);
const expectation = {
	closure: "completed" as const,
	presentation: "summary" as const,
	gate: "node scripts/verify.mjs",
	allowedPaths: ["src/parser.mjs"],
};

function coherentNativeFixture() {
	const input = autoQualifiedOutcome("single", {
		goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (
		!close ||
		close.output === null ||
		typeof close.output !== "object" ||
		!("workflowData" in close.output)
	)
		throw new Error("Missing close fixture.");
	const data = close.output.workflowData;
	if (data === null || typeof data !== "object")
		throw new Error("Missing close workflow data.");
	Object.assign(data, { delivery: structuredClone(saved.delivery) });
	expect(checkReviewerEvidenceAccess(input, input.archives[0])).toEqual([]);
	expect(
		deliveryIssues({ ...input, finalText: canonical }, expectation),
	).toEqual([]);
	return input;
}

test("actual measured answer preserves closure and progress in one bold heading", () => {
	const input = coherentNativeFixture();
	expect(
		deliveryIssues({ ...input, finalText: actualAnswer }, expectation),
	).toEqual([]);
});

test("compound heading consumes both complete scalar clauses without requiring separate labels", () => {
	for (const value of [
		heading,
		"### Completed and archived – 1 / 1 features complete.",
	]) {
		const facts = currentHandoffFacts(value);
		expect(facts.closure).toEqual(["completed"]);
		expect(facts.progress).toEqual([{ completed: 1, total: 1 }]);
		expect(facts.unsupported).toEqual([]);
	}
});

test("compound headings cannot hide negation, contradictory facts or unsupported tails behind canonical facts", () => {
	const correct = "Closure: completed.\nProgress: 1 of 1 features complete.";
	for (const mutation of [
		"Not completed and archived — 1 of 1 features complete.",
		"Deferred and archived — 1 of 1 features complete.",
		"Completed and archived — 0 of 1 features complete.",
		"Completed and archived — 1 of 1 features not complete.",
		"Completed and archived and deployed — 1 of 1 features complete.",
		"Completed and archived — 1 of 1 features complete and deployed.",
		"Unknown current state — 1 of 1 features complete.",
	]) {
		const facts = currentHandoffFacts(`${correct}\n**${mutation}**`);
		expect(
			facts.closure.every((value) => value === "completed") &&
				facts.progress.every(
					(value) => value?.completed === 1 && value.total === 1,
				) &&
				facts.unsupported.length === 0,
		).toBe(false);
	}
});

test("historical compound headings cannot supply current closure or progress", () => {
	const historical = currentHandoffFacts(`## Historical handoff\n${heading}`);
	expect(historical.closure).toEqual([]);
	expect(historical.progress).toEqual([]);
	const current = currentHandoffFacts(
		`## Historical handoff\n${heading}\n## Current handoff\nClosure: deferred.\nProgress: 0 of 1 features complete.`,
	);
	expect(current.closure).toEqual(["deferred"]);
	expect(current.progress).toEqual([{ completed: 0, total: 1 }]);
});

test("combined presentation does not supply a missing scalar fact", () => {
	const input = coherentNativeFixture();
	for (const incomplete of [
		"**Completed and archived.**",
		"**1 of 1 features complete.**",
	]) {
		expect(
			deliveryIssues(
				{ ...input, finalText: actualAnswer.replace(heading, incomplete) },
				expectation,
			),
		).not.toEqual([]);
	}
});

test("compound-looking bytes in goals and registered commands remain their original records", () => {
	const goal =
		'Keep "Completed and archived — 1 of 1 features complete" as a label.';
	const goalFacts = currentHandoffFacts(`Goal: ${goal}`);
	expect(goalFacts.goal).toEqual([goal]);
	expect(goalFacts.closure).toEqual([]);
	expect(goalFacts.progress).toEqual([]);
	const command =
		'node scripts/verify.mjs --label "Completed and archived — 1 of 1 features complete"';
	const commandFacts = currentHandoffFacts(
		`${command} passed with exit code 0.`,
		[command],
	);
	expect(commandFacts.observations).toEqual([
		{
			command,
			exitCode: 0,
			unchangedInvocation: false,
			qualification: "claimed-pass",
		},
	]);
	expect(commandFacts.closure).toEqual([]);
	expect(commandFacts.progress).toEqual([]);
	expect(commandFacts.unsupported).toEqual([]);
});
