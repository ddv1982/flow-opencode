import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import {
	deferredCaptureOutcome,
	externalCommand,
	localCommand,
	record,
} from "./fixtures/deferred-capture-outcome.js";
import saved from "./fixtures/delivery-compound-review-disclaimer.json" with {
	type: "json",
};
import completed from "./fixtures/delivery-flow-zero-count-answer.json" with {
	type: "json",
};

const disclaimer = "No independent review or completion is claimed.";
const prefix = "The parser implementation is retained, and the Linux gate ";
const expected = {
	closure: "deferred" as const,
	presentation: "summary" as const,
	gate: localCommand,
	missingEvidenceCommand: externalCommand,
	allowedPaths: ["src/parser.mjs"],
};
function fixture(finalText: string) {
	const input = deferredCaptureOutcome(finalText);
	record(input.archives[0]).goal = saved.goal;
	return input;
}

test("actual compound disclaimer and prefaced captured gate retain a truthful deferred handoff", () => {
	expect(deliveryIssues(fixture(saved.answer), expected)).toEqual([]);
});

test("removing or separating the denial isolates its unsupported assertion", () => {
	for (const replacement of ["", "Completion is not claimed."]) {
		expect(
			deliveryIssues(
				fixture(saved.answer.replace(disclaimer, replacement)),
				expected,
			),
		).toEqual([]);
	}
});

test("denying a review claim does not assert that review was not performed", () => {
	const facts = currentHandoffFacts(disclaimer);
	expect(facts.assurance).toEqual(["completion-not-claimed"]);
	expect(facts.independentReview).toEqual([]);
	expect(facts.unsupported).toEqual([]);
});

test("prefaced gate parses the same bound command result as a standalone gate", () => {
	const result = `${localCommand} passed with exit code 0.`;
	expect(currentHandoffFacts(prefix + result, [localCommand])).toEqual(
		currentHandoffFacts(result, [localCommand]),
	);
});

for (const [name, replacement] of [
	["nonzero exit", "node scripts/verify.mjs` passed with exit code 9"],
	["unregistered command", "node scripts/foreign.mjs` passed with exit code 0"],
	[
		"contradictory result tail",
		"node scripts/verify.mjs` passed with exit code 0 and failed",
	],
] as const) {
	test(`actual prefaced gate rejects ${name}`, () => {
		const answer = saved.answer
			.replace(disclaimer, "Completion is not claimed.")
			.replace("node scripts/verify.mjs` passed with exit code 0", replacement);
		expect(deliveryIssues(fixture(answer), expected)).not.toEqual([]);
	});
}

for (const tail of [
	" if checks pass",
	" and completion is supported",
	" but review passed",
]) {
	test(`compound denial rejects conflicting tail ${tail}`, () => {
		const answer = saved.answer.replace(
			disclaimer,
			`${disclaimer.slice(0, -1)}${tail}.`,
		);
		expect(deliveryIssues(fixture(answer), expected)).not.toEqual([]);
	});
}

test("compound completion denial still contradicts a native completed handoff", () => {
	const input = autoQualifiedOutcome("single", {
		goal: completed.goal,
		featureId: completed.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (!close) throw new Error("Missing completed close fixture.");
	record(record(close.output).workflowData).delivery = structuredClone(
		completed.delivery,
	);
	expect(
		deliveryIssues(
			{ ...input, finalText: `${completed.answer}\n${disclaimer}` },
			{
				closure: "completed",
				presentation: "summary",
				gate: localCommand,
				allowedPaths: ["src/parser.mjs"],
			},
		),
	).toContain(
		"Native assurance conclusion was omitted, misstated, or contradicted.",
	);
});

for (const assertion of [
	"The current workflow completed",
	"External action authority granted",
	"Independent review passed",
]) {
	test(`gate segmentation preserves preceding current assertion ${assertion}`, () => {
		const text = saved.answer.replace(
			prefix,
			`${assertion}, and the Linux gate `,
		);
		expect(deliveryIssues(fixture(text), expected)).not.toEqual([]);
	});
}

test("prefaced false invocation integrity cannot hide behind retained implementation prose", () => {
	const text = saved.answer.replace(
		"passed with exit code 0.",
		"passed with exit code 0; its script and invocation are unchanged.",
	);
	const input = fixture(text);
	expect(
		deliveryIssues(
			{
				...input,
				workspaceChanges: {
					kind: "observed",
					paths: ["scripts/verify.mjs", "src/parser.mjs"],
				},
			},
			expected,
		),
	).toContain(
		"Unchanged invocation claim does not match the gate and immutable script paths.",
	);
});

for (const text of [
	`Goal: ${prefix}${localCommand} passed with exit code 9.`,
	`Historical: ${prefix}${localCommand} passed with exit code 9.`,
	`Example: ${prefix}${localCommand} passed with exit code 9.`,
	`"${prefix}${localCommand} passed with exit code 9."`,
]) {
	test(`scoped gate prose creates no current observation ${text}`, () => {
		expect(currentHandoffFacts(text, [localCommand]).observations).toEqual([]);
	});
}

test("registered quoted arguments remain opaque before gate-role segmentation", () => {
	const command = `${localCommand} --label "retained, and the Linux gate bun fake.mjs passed with exit code 9"`;
	const facts = currentHandoffFacts(`${command} passed with exit code 0.`, [
		command,
		localCommand,
	]);
	expect(facts.observations).toEqual([
		{
			command,
			exitCode: 0,
			qualification: "claimed-pass",
			integrity: "not-claimed",
		},
	]);
	expect(facts.unsupported).toEqual([]);
});
