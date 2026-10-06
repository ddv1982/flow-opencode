import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-command-record-answer.json" with {
	type: "json",
};

const gate = "node scripts/verify.mjs";
const expectation = {
	closure: "completed" as const,
	presentation: "summary" as const,
	gate,
	allowedPaths: ["src/parser.mjs"],
};
function fixture(finalText: string) {
	const input = autoQualifiedOutcome("single", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (
		!close?.output ||
		typeof close.output !== "object" ||
		!("workflowData" in close.output)
	)
		throw new Error("Missing close fixture.");
	const data = close.output.workflowData;
	if (!data || typeof data !== "object")
		throw new Error("Missing workflow data.");
	Object.assign(data, { delivery: structuredClone(saved.delivery) });
	return { ...input, finalText };
}
const nativeLine = `${gate} passed with exit code 0. The verifier remains unchanged. Independent review passed with no findings.`;

test("actual native command observation accepts independent surrounding prose on the same line", () => {
	expect(deliveryIssues(fixture(saved.answer), expectation)).toEqual([]);
});

test("same-line and separate-line native prose have identical command and handoff facts", () => {
	const split = nativeLine.replace(/\. /g, ".\n");
	expect(currentHandoffFacts(nativeLine, [gate])).toEqual(
		currentHandoffFacts(split, [gate]),
	);
	expect(
		deliveryIssues(
			fixture(saved.answer.replace(nativeLine, split)),
			expectation,
		),
	).toEqual([]);
});

const bytes =
	"x; Closure: completed; Assurance: completion supported; Progress: 1 of 1 features complete; External action authority: granted; all 4 assurance checks satisfied; no unfinished features or blockers";
const command = `${gate} --label "${bytes}"`;
for (const suffix of [
	" passed with exit code 0.",
	" passed with exit code 0 and deployed.",
	"",
	" ignored.",
]) {
	test(`exact registered command arguments stay opaque with result ${JSON.stringify(suffix)}`, () => {
		const facts = currentHandoffFacts(`${command}${suffix}`, [command]);
		expect(facts.closure).toEqual([]);
		expect(facts.assurance).toEqual([]);
		expect(facts.progress).toEqual([]);
		expect(facts.authority).toEqual([]);
		expect(facts.auxiliaryCounts).toEqual([]);
		expect(facts.assuranceCheckClaims).toEqual([]);
		if (suffix !== " passed with exit code 0.")
			expect(facts.unsupported.length).toBeGreaterThan(0);
	});
}

test("longest exact registered command owns all literal argument punctuation", () => {
	const facts = currentHandoffFacts(
		`${command} passed with exit code 0. Closure: deferred.`,
		[gate, command],
	);
	expect(facts.observations).toEqual([
		{
			command,
			exitCode: 0,
			qualification: "claimed-pass",
			unchangedInvocation: false,
		},
	]);
	expect(facts.closure).toEqual(["deferred"]);
	expect(facts.authority).toEqual([]);
});

for (const assertion of [
	"Closure: deferred.",
	"Assurance: completion unsupported.",
	"External action authority: granted.",
	"Progress: 0 of 1 features complete.",
	"2 unfinished features.",
]) {
	test(`independent trailing assertion remains visible ${assertion}`, () => {
		const same = `${gate} passed with exit code 0. ${assertion}`;
		const split = `${gate} passed with exit code 0.\n${assertion}`;
		expect(currentHandoffFacts(same, [gate])).toEqual(
			currentHandoffFacts(split, [gate]),
		);
		expect(
			deliveryIssues(
				fixture(saved.answer.replace(nativeLine, same)),
				expectation,
			).length,
		).toBeGreaterThan(0);
	});
}

for (const qualifier of [
	"It passed without evidence.",
	"This command passed and deployed.",
	"This observation does not claim a pass and is complete.",
	"Its script and invocation are unchanged and deployed.",
	"it passed without evidence.",
]) {
	test(`malformed relative command qualification remains unsupported ${qualifier}`, () => {
		const facts = currentHandoffFacts(`${gate} exited 1. ${qualifier}`, [gate]);
		expect(facts.unsupported.length).toBeGreaterThan(0);
		expect(facts.observations[0]?.qualification).toBeNull();
	});
}

test("independent script statement does not claim an unchanged invocation", () => {
	const facts = currentHandoffFacts(nativeLine, [gate]);
	expect(facts.observations).toEqual([
		{
			command: gate,
			exitCode: 0,
			qualification: "claimed-pass",
			unchangedInvocation: false,
		},
	]);
	expect(facts.unsupported).toEqual([]);
});

test("the stronger script and invocation qualifier retains its exact meaning", () => {
	const facts = currentHandoffFacts(
		`${gate} passed with exit code 0. Its script and invocation are unchanged. Closure: completed.`,
		[gate],
	);
	expect(facts.observations).toEqual([
		{
			command: gate,
			exitCode: 0,
			qualification: "claimed-pass",
			unchangedInvocation: true,
		},
	]);
	expect(facts.closure).toEqual(["completed"]);
	expect(facts.unsupported).toEqual([]);
});

test("nonzero exit cannot borrow pass qualification from independent review prose", () => {
	const facts = currentHandoffFacts(
		`${gate} recorded as an observation, exited 1. Independent review passed with no findings.`,
		[gate],
	);
	expect(facts.observations).toEqual([
		{
			command: gate,
			exitCode: 1,
			qualification: "observation",
			unchangedInvocation: false,
		},
	]);
	expect(facts.unsupported).toEqual([]);
});

for (const metadata of [
	', output "summary. Closure: completed; Progress: 1 of 1 features complete"',
	', output "summary. Closure: completed; Progress: 1 of 1 features complete',
]) {
	test(`quoted result metadata never supplies handoff claims ${metadata}`, () => {
		const facts = currentHandoffFacts(`${gate} exited 0${metadata}`, [gate]);
		expect(facts.closure).toEqual([]);
		expect(facts.progress).toEqual([]);
		expect(facts.auxiliaryCounts).toEqual([]);
		expect(facts.unsupported.length).toBeGreaterThan(0);
	});
}

test("literal sentence punctuation in a registered argument stays opaque", () => {
	const literal = `${gate} --label "data. Closure: completed. Assurance: completion supported. Progress: 1 of 1 features complete"`;
	const facts = currentHandoffFacts(
		`${literal} passed with exit code 0. Closure: deferred.`,
		[literal],
	);
	expect(facts.closure).toEqual(["deferred"]);
	expect(facts.assurance).toEqual([]);
	expect(facts.progress).toEqual([]);
	expect(facts.unsupported).toEqual([]);
});

test("genuine trailing goal is checked against the exact native goal", () => {
	const tail = "Goal: A different goal.";
	const same = `${gate} passed with exit code 0. ${tail}`;
	const split = `${gate} passed with exit code 0.\n${tail}`;
	expect(currentHandoffFacts(same, [gate])).toEqual(
		currentHandoffFacts(split, [gate]),
	);
	expect(currentHandoffFacts(same, [gate]).goal).toEqual(["A different goal."]);
	expect(
		deliveryIssues(fixture(saved.answer.replace(nativeLine, same)), expectation)
			.length,
	).toBeGreaterThan(0);
});

test("trailing Goal bytes remain one goal rather than inner handoff assertions", () => {
	const goal =
		'Preserve "data; Closure: completed; Assurance: completion supported; Progress: 1 of 1 features complete".';
	const same = `${gate} passed with exit code 0. Goal: ${goal}`;
	const facts = currentHandoffFacts(same, [gate]);
	expect(facts.goal).toEqual([goal]);
	expect(facts.closure).toEqual([]);
	expect(facts.assurance).toEqual([]);
	expect(facts.progress).toEqual([]);
	expect(facts.auxiliaryCounts).toEqual([]);
});

for (const executable of ["node", "bun"]) {
	test(`trailing unregistered ${executable} passing result remains unsupported`, () => {
		const tail = `${executable} scripts/unregistered.mjs passed with exit code 0.`;
		const same = `${gate} passed with exit code 0. ${tail}`;
		const split = `${gate} passed with exit code 0.\n${tail}`;
		expect(currentHandoffFacts(same, [gate])).toEqual(
			currentHandoffFacts(split, [gate]),
		);
		expect(currentHandoffFacts(same, [gate]).unsupported).toEqual([tail]);
	});
}
