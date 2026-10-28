import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { DELIVERY_SCENARIOS } from "../evals/delivery-scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-passed-unchanged-answer.json" with {
	type: "json",
};

const gate = "node scripts/verify.mjs";
const scenario = DELIVERY_SCENARIOS.find(
	(item) => item.id === "delivery-summary-completed",
);
if (!scenario) throw new Error("Missing completed delivery scenario.");
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Missing native fixture object.");
	return value as Record<string, unknown>;
}
function fixture(command = gate) {
	const input = autoQualifiedOutcome("single", {
		goal: saved.goal,
		featureId: saved.featureId,
		gateCommand: command,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	object(object(close?.output).workflowData).delivery = structuredClone(
		saved.delivery,
	);
	return {
		...input,
		finalText: saved.answer.replace(
			"`node scripts/verify.mjs` passed unchanged.",
			`\`${command}\` passed unchanged.`,
		),
	};
}
test("organic passed unchanged handoff succeeds with its native proof", () => {
	expect(scenario.check(fixture())).toEqual([]);
});
test("passed unchanged claims both script and invocation integrity", () => {
	expect(
		currentHandoffFacts(`${gate} passed unchanged.`, [gate]).observations,
	).toEqual([
		{
			command: gate,
			exitCode: 0,
			qualification: "claimed-pass",
			integrity: "script-and-invocation-unchanged",
		},
	]);
});

function compoundFixture(separator = "; independent review") {
	const input = fixture();
	input.finalText = input.finalText.replace(
		"passed unchanged.",
		`passed unchanged${separator} passed with no findings.`,
	);
	return input;
}

test("supported separators preserve command integrity and independent review evidence", () => {
	for (const separator of [
		"; independent review",
		";Independent review:",
		"; Independent review",
		", and Independent review",
		". Independent review",
	]) {
		const facts = currentHandoffFacts(
			`${gate} passed unchanged${separator} passed with no findings.`,
			[gate],
		);
		expect(facts.unsupported).toEqual([]);
		expect(facts.observations).toEqual([
			{
				command: gate,
				exitCode: 0,
				qualification: "claimed-pass",
				integrity: "script-and-invocation-unchanged",
			},
		]);
		expect(facts.independentReview).toEqual([
			{ kind: "passed", findings: "none" },
		]);
		expect(scenario.check(compoundFixture(separator))).toEqual([]);
	}
});

for (const suffix of [
	"independent review passed if it ran",
	"independent review passed and deployed",
	"independent review passed with no findings; exited 1",
	"independent review passed with no findings; its script changed",
	"independent review passed with no findings; this observation does not claim a pass",
]) {
	test(`semicolon review composition still rejects ${suffix}`, () => {
		const input = compoundFixture();
		input.finalText = input.finalText.replace(
			"independent review passed with no findings.",
			`${suffix}.`,
		);
		expect(scenario.check(input)).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}

for (const change of ["nonzero", "incomplete", "source", "unsubmitted"]) {
	test(`a semicolon review claim cannot rescue ${change} native evidence`, () => {
		const input = compoundFixture();
		const runs = object(input.archives[0]).runs;
		if (!Array.isArray(runs)) throw new Error("Missing native runs.");
		const run = object(runs[0]);
		if (!Array.isArray(run.validations) || !Array.isArray(run.reviews))
			throw new Error("Missing native proof.");
		const validation = run.validations
			.map(object)
			.find((value) => value.command === gate);
		if (!validation) throw new Error("Missing gate.");
		if (change === "nonzero") validation.exitCode = 1;
		if (change === "incomplete") validation.outputComplete = false;
		if (change === "source")
			validation.sourceDigest = `sha256:${"b".repeat(64)}`;
		if (change === "unsubmitted") object(run.reviews[0]).result = null;
		expect(scenario.check(input)).not.toEqual([]);
	});
}

for (const paths of [null, ["src/parser.mjs", "scripts/verify.mjs"]]) {
	test(`passed unchanged requires immutable script evidence ${paths}`, () => {
		const input = fixture();
		const workspaceChanges =
			paths === null
				? { kind: "unavailable" as const, reason: "No workspace capture" }
				: { kind: "observed" as const, paths };
		expect(scenario.check({ ...input, workspaceChanges })).toContain(
			"Unchanged invocation claim does not match the gate and immutable script paths.",
		);
	});
}
test("another registered command cannot claim the canonical invocation is unchanged", () => {
	expect(scenario.check(fixture("node scripts/other.mjs"))).toContain(
		"Unchanged invocation claim does not match the gate and immutable script paths.",
	);
});
for (const change of [
	"nonzero",
	"unknown-exit",
	"incomplete",
	"source",
	"unaccepted",
	"observe",
]) {
	test(`passed unchanged cannot rescue ${change} native proof`, () => {
		const input = fixture();
		const runs = object(input.archives[0]).runs;
		if (!Array.isArray(runs)) throw new Error("Missing native runs.");
		const run = object(runs[0]);
		if (!Array.isArray(run.validations) || !Array.isArray(run.reviews))
			throw new Error("Missing native evidence.");
		const validation = run.validations
			.map(object)
			.find((value) => value.command === gate);
		if (!validation) throw new Error("Missing native gate.");
		if (change === "nonzero") validation.exitCode = 1;
		if (change === "unknown-exit") validation.exitCode = null;
		if (change === "incomplete") validation.outputComplete = false;
		if (change === "source")
			validation.sourceDigest = `sha256:${"b".repeat(64)}`;
		if (change === "unaccepted") object(run.reviews[0]).validationIds = [];
		if (change === "observe") validation.intent = "observe";
		expect(scenario.check(input)).toContain(
			"Claimed command pass lacks matching accepted complete source evidence.",
		);
	});
}
for (const status of [
	"passed unchanged if it ran",
	"passed unchanged and deployed",
	"passed unchanged; exited 1",
	"passed unchanged; its script changed",
	"passed unchanged; this observation does not claim a pass",
]) {
	test(`passed unchanged rejects conflicting or unknown suffix ${status}`, () => {
		const input = fixture();
		input.finalText = input.finalText.replace(
			"passed unchanged.",
			`${status}.`,
		);
		expect(scenario.check(input)).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}
test("unknown command cannot borrow passed unchanged proof", () => {
	const input = fixture();
	input.finalText = input.finalText.replace(
		"`node scripts/verify.mjs` passed unchanged.",
		"`node scripts/other.mjs` passed unchanged.",
	);
	expect(scenario.check(input)).toContain(
		"Unsupported or conflicting current handoff assertions.",
	);
});
for (const text of [
	`Goal: Preserve '${gate} passed unchanged.'`,
	`Historical handoff\n${gate} passed unchanged.`,
	`Example: ${gate} passed unchanged.`,
]) {
	test(`scoped wording cannot supply passed unchanged proof ${text}`, () => {
		expect(currentHandoffFacts(text, [gate]).observations).toEqual([]);
	});
}
for (const runtime of ["Node version 24", "Bun version 1.4"]) {
	test(`runtime compatibility prose remains context for ${runtime}`, () => {
		const input = fixture();
		input.finalText = input.finalText.replace("passed unchanged.", "passed.");
		input.finalText += `\n${runtime} passed our compatibility tests.`;
		expect(scenario.check(input)).toEqual([]);
	});
}
