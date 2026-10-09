import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { DELIVERY_SCENARIOS } from "../evals/delivery-scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-platform-pass-answer.json" with {
	type: "json",
};

const gate = "node scripts/verify.mjs";
const scenario = DELIVERY_SCENARIOS.find(
	(item) => item.id === "delivery-summary-observed-failure",
)!;
const phrase = "passed on Linux, and independent review passed.";
function fixture(status: string) {
	const input = autoQualifiedOutcome("audit", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	)!;
	const output = close.output as { workflowData: { delivery: unknown } };
	output.workflowData.delivery = structuredClone(saved.delivery);
	return { ...input, finalText: saved.answer.replace(phrase, status) };
}
for (const explanation of [
	"confirming null handling and string trimming",
	"verifying empty input normalization",
	"demonstrating Unicode parsing",
	"confirming correctness",
]) {
	test(`behavior explanation preserves native pass ${explanation}`, () => {
		const text = `${gate} passed on Linux, ${explanation}.`;
		expect(currentHandoffFacts(text, [gate]).observations).toEqual([
			{
				command: gate,
				exitCode: 0,
				qualification: "claimed-pass",
				integrity: "not-claimed",
				hostPlatform: "linux",
			},
		]);
		expect(currentHandoffFacts(text, [gate]).unsupported).toEqual([]);
		expect(scenario.check(fixture(`passed on Linux, ${explanation}.`))).toEqual(
			[],
		);
	});
}
for (const tail of [
	"confirming the command failed",
	"confirming incomplete output",
	"confirming its script was modified",
	"confirming authority was granted",
	"confirming completion without evidence",
	"confirming review passed",
	"confirming null handling, host Windows",
	"confirming null handling; its script was modified",
	"confirming null handling. It failed",
	"confirming null handling. Independent review passed; its invocation was modified",
	"confirming 'the command failed'",
	"confirming null handling and node scripts/audit.mjs passed",
	"not confirming null handling",
	"confirming null handling if its script remains unchanged",
]) {
	test(`command-owned adverse explanation is rejected ${tail}`, () => {
		expect(
			currentHandoffFacts(`${gate} passed on Linux, ${tail}.`, [
				gate,
				"node scripts/audit.mjs",
			]).unsupported.length,
		).toBeGreaterThan(0);
	});
}
for (const status of [
	"did not pass on Linux",
	"passed on Unknown",
	"passed on Linux, host Windows",
	"passed with exit code 1",
]) {
	test(`explanation cannot repair unsupported status ${status}`, () => {
		expect(
			scenario.check(fixture(`${status}, confirming null handling.`)).length,
		).toBeGreaterThan(0);
	});
}
test("opaque report metadata retains quoted explanation text", () => {
	const facts = currentHandoffFacts(
		`${gate} passed, exit 0, host Linux, report "sample, confirming host Windows".`,
		[gate],
	);
	expect(facts.observations).toEqual([
		{
			command: gate,
			exitCode: 0,
			qualification: "claimed-pass",
			integrity: "not-claimed",
			hostPlatform: "linux",
		},
	]);
	expect(facts.unsupported).toEqual([]);
});
