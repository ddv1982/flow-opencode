import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-flow-zero-count-answer.json" with {
	type: "json",
};

const answer =
	"Completed and archived. Only `src/parser.mjs` was changed:\n\n```js\nexport function parse(input) { return input === null ? '' : input.trim(); }\n```\n\n- `parse(null)` returns `''`; strings remain trimmed.\n- Unchanged `node scripts/verify.mjs` passed with exit code **0**.\n- Independent review passed with **no findings**.\n- **1 of 1 features complete**; no unfinished work or blockers.\n\nGoal: Make parse(input) safely handle null and preserve trimmed strings. Change only src/parser.mjs. Keep node scripts/verify.mjs and its script unchanged.\n\n**Flow assurance:** completion supported; all four assurance checks satisfied. External action authority was not granted.\n\nAssurance limitations:\n- Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.\n- Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.\n- Freshness holds when review is accepted; an archive does not attest the current workspace.";
const goal =
	"Make parse(input) safely handle null and preserve trimmed strings. Change only src/parser.mjs. Keep node scripts/verify.mjs and its script unchanged.";
const expectation = {
	closure: "completed" as const,
	presentation: "summary" as const,
	gate: "node scripts/verify.mjs",
	allowedPaths: ["src/parser.mjs"],
};
function fixture(finalText: string) {
	const input = autoQualifiedOutcome("single", {
		goal,
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

test("unchanged native final response accepts past-tense not-granted authority", () => {
	expect(
		deliveryIssues(
			fixture(
				answer.replace("authority was not granted", "authority is not granted"),
			),
			expectation,
		),
	).toEqual([]);
	expect(deliveryIssues(fixture(answer), expectation)).toEqual([]);
});
for (const copula of ["", "is ", "has been ", "was "]) {
	for (const value of ["not granted", "not-granted"]) {
		test(`finite authority proposition retains ${copula}${value}`, () => {
			expect(
				currentHandoffFacts(`External action authority ${copula}${value}.`)
					.authority,
			).toEqual(["not-granted"]);
		});
	}
	test(`granting proposition remains a conflicting native authority ${copula}granted`, () => {
		const proposition = `External action authority ${copula}granted.`;
		expect(currentHandoffFacts(proposition).authority).toEqual(["granted"]);
		expect(
			deliveryIssues(
				fixture(
					answer.replace(
						"External action authority was not granted.",
						proposition,
					),
				),
				expectation,
			),
		).toContain(
			"External action authority was omitted, expanded, or contradicted.",
		);
	});
}
for (const value of [
	"was not ungranted",
	"was not granted unless you publish",
	"was not granted if the review passes",
	"was not granted and you may publish now",
	"was not granted; authorized to deploy now",
	"was granted; External action authority: not granted",
]) {
	test(`authority retains strict whole proposition and contradictory permissions ${value}`, () => {
		const proposition = `External action authority ${value}.`;
		expect(
			deliveryIssues(
				fixture(
					answer.replace(
						"External action authority was not granted.",
						proposition,
					),
				),
				expectation,
			),
		).toContain(
			"External action authority was omitted, expanded, or contradicted.",
		);
	});
}
test("a later granting claim cannot be hidden behind truthful past-tense authority", () => {
	expect(
		currentHandoffFacts(
			"External action authority was not granted. External action authority was granted.",
		).authority,
	).toEqual(["not-granted", "granted"]);
	expect(
		deliveryIssues(
			fixture(`${answer}\nExternal action authority was granted.`),
			expectation,
		),
	).toContain(
		"External action authority was omitted, expanded, or contradicted.",
	);
});
test("historical authority cannot supply a current past-tense authority claim", () => {
	expect(
		currentHandoffFacts(
			"Historical handoff\nExternal action authority was not granted.",
		).authority,
	).toEqual([]);
});
for (const quote of ['"', "'"]) {
	test(`quoted past-tense authority text remains opaque ${quote}`, () => {
		expect(
			currentHandoffFacts(
				`${quote}External action authority was not granted.${quote}`,
			).authority,
		).toEqual([]);
	});
}
test("Goal and registered command argument authority bytes remain opaque", () => {
	const literal = "External action authority was granted";
	expect(
		currentHandoffFacts(`Goal: Preserve "${literal}" in labels.`).authority,
	).toEqual([]);
	const command = `node scripts/verify.mjs --label "${literal}"`;
	expect(
		currentHandoffFacts(`${command} passed with exit code 0.`, [command])
			.authority,
	).toEqual([]);
});

for (const copula of ["is", "was", "has been"]) {
	for (const subject of [
		"external action authority",
		"external-action authority",
	]) {
		test(`prefixed current granting assertion cannot hide behind a native denial ${subject} ${copula}`, () => {
			const contradiction = `However, ${subject} ${copula} granted.`;
			expect(
				deliveryIssues(fixture(`${answer}\n${contradiction}`), expectation),
			).toContain("Unsupported or conflicting current handoff assertions.");
		});
	}
}

test("historical prefixed grant remains outside current handoff authority", () => {
	const history = "Earlier external action authority was granted.";
	expect(currentHandoffFacts(history).authority).toEqual([]);
	expect(currentHandoffFacts(history).unsupported).toEqual([]);
	expect(deliveryIssues(fixture(`${answer}\n${history}`), expectation)).toEqual(
		[],
	);
});

test("Goal and registered command arguments cannot supply prefixed granting assertions", () => {
	const contradiction = "However, external action authority was granted.";
	const goalFacts = currentHandoffFacts(
		`Goal: Preserve "${contradiction}" in labels.`,
	);
	expect(goalFacts.authority).toEqual([]);
	expect(goalFacts.unsupported).toEqual([]);
	const command = `node scripts/verify.mjs --label "${contradiction}"`;
	const commandFacts = currentHandoffFacts(
		`${command} passed with exit code 0.`,
		[command],
	);
	expect(commandFacts.authority).toEqual([]);
	expect(commandFacts.unsupported).toEqual([]);
});
