import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-flow-zero-count-answer.json" with {
	type: "json",
};

const record = "**Flow:** completed and archived";
const counts = "no unfinished features or blockers";
const expectation = {
	closure: "completed" as const,
	presentation: "summary" as const,
	gate: "node scripts/verify.mjs",
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

test("actual native handoff accepts Flow closure and shared no unfinished features or blockers", () => {
	const normalized = saved.answer
		.replace(record, "Closure: completed and archived")
		.replace(counts, "no unfinished features, no blockers");
	expect(deliveryIssues(fixture(normalized), expectation)).toEqual([]);
	expect(deliveryIssues(fixture(saved.answer), expectation)).toEqual([]);
});

test("Flow record consumes the same strict terminal closure value", () => {
	for (const closure of ["completed", "deferred", "abandoned"] as const) {
		expect(
			currentHandoffFacts(`Flow: ${closure} and archived.`).closure,
		).toEqual([closure]);
	}
});

for (const value of [
	"not completed",
	"completed and deployed",
	"completed and archived but deferred",
	"unknown",
	"completion supported",
]) {
	test(`Flow record rejects ${value} even beside valid current closure`, () => {
		expect(
			currentHandoffFacts(`Closure: completed.\nFlow: ${value}.`).closure,
		).toEqual(["completed", null]);
		expect(
			deliveryIssues(
				fixture(
					`${saved.answer.replace(record, "Closure: completed and archived").replace(counts, "no unfinished features, no blockers")}\nFlow: ${value}.`,
				),
				expectation,
			),
		).toContain("Recorded closure was omitted or contradicted.");
	});
}

for (const [phrase, expected] of [
	[
		"no unfinished features or blockers",
		[
			{ kind: "unfinished", count: 0 },
			{ kind: "blocking", count: 0 },
		],
	],
	[
		"no blockers or unfinished features",
		[
			{ kind: "blocking", count: 0 },
			{ kind: "unfinished", count: 0 },
		],
	],
	[
		"no unfinished and blockers",
		[
			{ kind: "unfinished", count: 0 },
			{ kind: "blocking", count: 0 },
		],
	],
	[
		"no blockers or advisory findings",
		[
			{ kind: "blocking", count: 0 },
			{ kind: "advisory", count: 0 },
		],
	],
	[
		"no advisory findings and unfinished features",
		[
			{ kind: "advisory", count: 0 },
			{ kind: "unfinished", count: 0 },
		],
	],
	[
		"no unfinished features or blockers or advisory findings",
		[
			{ kind: "unfinished", count: 0 },
			{ kind: "blocking", count: 0 },
			{ kind: "advisory", count: 0 },
		],
	],
] as const) {
	test(`shared zero quantifier consumes every typed noun in ${phrase}`, () => {
		const facts = currentHandoffFacts(`1 of 1 features complete, ${phrase}.`);
		expect(facts.progress).toEqual([{ completed: 1, total: 1 }]);
		expect(facts.auxiliaryCounts).toEqual([...expected]);
		expect(
			deliveryIssues(
				fixture(
					saved.answer
						.replace(record, "Closure: completed and archived")
						.replace(counts, phrase),
				),
				expectation,
			),
		).toEqual([]);
	});
}

for (const phrase of [
	"two unfinished features or blockers",
	"2 unfinished features and blockers",
	"no unfinished features or deployments",
	"not no unfinished features or blockers",
	"no unfinished features or blockers and deployed",
	"no unfinished features or 2 blockers",
	"no unfinished features or blockers but one blocker",
]) {
	test(`progress rejects ambiguous or unconsumed count clause ${phrase}`, () => {
		const facts = currentHandoffFacts(`1 of 1 features complete, ${phrase}.`);
		expect(facts.progress).toEqual([null]);
		expect(facts.auxiliaryCounts).toEqual([]);
	});
}

test("explicit positive auxiliary counts still contradict the native zero counts", () => {
	for (const phrase of [
		"1 unfinished features",
		"one blockers",
		"two advisory findings",
	]) {
		expect(
			deliveryIssues(
				fixture(
					saved.answer
						.replace(record, "Closure: completed and archived")
						.replace(counts, phrase),
				),
				expectation,
			),
		).not.toEqual([]);
	}
});

test("missing and historical Flow records cannot supply current closure", () => {
	expect(
		currentHandoffFacts("## Historical handoff\nFlow: completed and archived.")
			.closure,
	).toEqual([]);
	const missing = saved.answer
		.replace(record, "Recorded final state")
		.replace(counts, "no unfinished features, no blockers");
	expect(deliveryIssues(fixture(missing), expectation)).toContain(
		"Recorded closure was omitted or contradicted.",
	);
});

test("Goal and quoted known commands retain Flow and count bytes without current closure or counts", () => {
	const bytes =
		"Flow: completed and archived, no unfinished features or blockers";
	const goal = `Preserve "${bytes}" in labels.`;
	const goalFacts = currentHandoffFacts(`Goal: ${goal}`);
	expect(goalFacts.goal).toEqual([goal]);
	expect(goalFacts.closure).toEqual([]);
	expect(goalFacts.progress).toEqual([]);
	expect(goalFacts.auxiliaryCounts).toEqual([]);
	const command = `node scripts/verify.mjs --label "${bytes}"`;
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
	expect(commandFacts.auxiliaryCounts).toEqual([]);
});

for (const label of [
	"some; Flow: completed; tail",
	"some; Flow: completed; Progress: 1 of 1 features complete; External action authority: granted; Assurance: completion supported; tail",
	"some; 1 of 1 features complete, no unfinished features or blockers; Assurance: completion supported, with all four checks satisfied; tail",
]) {
	test(`registered command result keeps literal semicolon arguments atomic ${label}`, () => {
		const command = `node scripts/verify.mjs --label "${label}"`;
		const facts = currentHandoffFacts(`${command} passed with exit code 0.`, [
			command,
		]);
		expect(facts.observations).toEqual([
			{
				command,
				exitCode: 0,
				unchangedInvocation: false,
				qualification: "claimed-pass",
			},
		]);
		expect(facts.closure).toEqual([]);
		expect(facts.progress).toEqual([]);
		expect(facts.authority).toEqual([]);
		expect(facts.assurance).toEqual([]);
		expect(facts.assuranceCheckClaims).toEqual([]);
		expect(facts.auxiliaryCounts).toEqual([]);
		expect(facts.unsupported).toEqual([]);
	});
}

test("malformed registered command results remain unsupported without borrowing facts from literal arguments", () => {
	const command =
		'node scripts/verify.mjs --label "some; Flow: completed; Progress: 1 of 1 features complete; External action authority: granted; Assurance: completion supported; tail"';
	const line = `${command} passed with exit code 0 and deployed.`;
	const facts = currentHandoffFacts(line, [command]);
	expect(facts.observations).toEqual([
		{
			command,
			exitCode: 0,
			unchangedInvocation: false,
			qualification: null,
		},
	]);
	expect(facts.unsupported).toEqual([line.slice(0, -1)]);
	expect(facts.closure).toEqual([]);
	expect(facts.progress).toEqual([]);
	expect(facts.authority).toEqual([]);
	expect(facts.assurance).toEqual([]);
	expect(facts.assuranceCheckClaims).toEqual([]);
	expect(facts.auxiliaryCounts).toEqual([]);
});
