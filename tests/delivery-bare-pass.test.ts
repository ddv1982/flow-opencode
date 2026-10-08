import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { DELIVERY_SCENARIOS } from "../evals/delivery-scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-bare-pass-answer.json" with {
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
function fixture() {
	const input = autoQualifiedOutcome("single", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	object(object(close?.output).workflowData).delivery = structuredClone(
		saved.delivery,
	);
	return { ...input, finalText: saved.answer };
}
test("native 4c7c answer with bare command pass succeeds through the whole completed scenario", () => {
	expect(scenario.check(fixture())).toEqual([]);
});
for (const change of [
	"nonzero",
	"unknown-exit",
	"incomplete",
	"source",
	"unaccepted",
	"observe",
]) {
	test(`bare pass cannot rescue ${change} native proof`, () => {
		const input = fixture();
		const archive = object(input.archives[0]);
		const runs = archive.runs;
		if (!Array.isArray(runs)) throw new Error("Missing native runs.");
		const run = object(runs[0]);
		if (!Array.isArray(run.validations) || !Array.isArray(run.reviews))
			throw new Error("Missing native evidence.");
		const validation = run.validations
			.map(object)
			.find((value) => value.command === gate);
		if (!validation) throw new Error("Missing native gate.");
		const review = object(run.reviews[0]);
		if (change === "nonzero") validation.exitCode = 1;
		if (change === "unknown-exit") validation.exitCode = null;
		if (change === "incomplete") validation.outputComplete = false;
		if (change === "source")
			validation.sourceDigest = `sha256:${"b".repeat(64)}`;
		if (change === "unaccepted") review.validationIds = [];
		if (change === "observe") validation.intent = "observe";
		expect(scenario.check(input)).toContain(
			"Claimed command pass lacks matching accepted complete source evidence.",
		);
	});
}
test("bare pass does not substitute for an omitted assurance limitation", () => {
	const input = fixture();
	input.finalText = input.finalText.replace(
		"Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
		"",
	);
	expect(scenario.check(input).length).toBeGreaterThan(0);
});
for (const status of [
	"passed if it ran",
	"passed and deployed",
	"passed; this observation does not claim a pass",
	"passed; exit unavailable",
	"passed; exited 1",
	"passed; recorded as an observation",
	"passed; its script changed",
]) {
	test(`bare pass refuses conflicting or unknown qualification ${status}`, () => {
		const input = fixture();
		input.finalText = input.finalText.replace(
			"`node scripts/verify.mjs` passed.",
			`\`${gate}\` ${status}.`,
		);
		expect(scenario.check(input)).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}
test("unknown command cannot borrow the registered gate's bare pass proof", () => {
	const input = fixture();
	input.finalText = input.finalText.replace(
		"`node scripts/verify.mjs` passed.",
		"`node scripts/other.mjs` passed.",
	);
	expect(scenario.check(input)).toContain(
		"Unsupported or conflicting current handoff assertions.",
	);
});
for (const text of [
	`Goal: Preserve '${gate} passed.'`,
	`Historical handoff\n${gate} passed.`,
	`Example: ${gate} passed.`,
	`Example: ${gate} passed with exit code 0.`,
]) {
	test(`scoped text cannot supply a bare current command pass ${text}`, () => {
		expect(currentHandoffFacts(text, [gate]).observations).toEqual([]);
	});
}
for (const qualifier of [
	"its script remained unchanged",
	"its script and invocation are unchanged",
	"it passed",
]) {
	test(`bare pass retains the closed allowed qualifier ${qualifier}`, () => {
		const input = fixture();
		input.finalText = input.finalText.replace(
			"`node scripts/verify.mjs` passed.",
			`\`${gate}\` passed; ${qualifier}.`,
		);
		expect(scenario.check(input)).toEqual([]);
	});
}
test("bare command pass preserves quoted arguments as opaque command identity", () => {
	const command = `${gate} --label "retained, and the Linux gate bun fake.mjs passed with exit code 9"`;
	const facts = currentHandoffFacts(`${command} passed.`, [command]);
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
