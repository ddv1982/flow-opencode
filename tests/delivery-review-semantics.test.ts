import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { DELIVERY_SCENARIOS } from "../evals/delivery-scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-review-semantics-answer.json" with {
	type: "json",
};

const gate = "node scripts/verify.mjs";
const status = "passed on Linux with exit 0";
const review = "passed with no blocking findings";
const scenario = DELIVERY_SCENARIOS.find(
	(item) => item.id === "delivery-summary-observed-failure",
);
if (!scenario) throw new Error("Missing observed-failure scenario.");
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Missing fixture object.");
	return value as Record<string, unknown>;
}
function fixture(commandStatus = status, reviewStatus = review) {
	const input = autoQualifiedOutcome("audit", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	object(object(close?.output).workflowData).delivery = structuredClone(
		saved.delivery,
	);
	return {
		...input,
		finalText: saved.answer
			.replace(status, commandStatus)
			.replace(review, reviewStatus),
	};
}
function run(input: ReturnType<typeof fixture>) {
	return object((object(input.archives[0]).runs as unknown[])[0]);
}
function validation(input: ReturnType<typeof fixture>) {
	return (run(input).validations as unknown[])
		.map(object)
		.find((item) => item.command === gate)!;
}
for (const commandStatus of [status, "passed with exit 0, host Linux"]) {
	test(`retained accurate severity and command details pass ${commandStatus}`, () => {
		expect(scenario.check(fixture(commandStatus))).toEqual([]);
	});
}
for (const text of [
	"Independent review passed with no blocking findings.",
	`${gate} passed on Linux with exit 0, and independent review passed with no blocking findings.`,
]) {
	test(`review severity remains a distinct owned claim ${text}`, () => {
		expect(currentHandoffFacts(text, [gate]).independentReview).toEqual([
			{ kind: "passed", findings: "no-blocking" },
		]);
	});
}
test("explicit nonzero exit remains nonzero beside a passing verb", () => {
	expect(
		currentHandoffFacts(`${gate} passed on Linux with exit 9.`, [gate])
			.observations,
	).toEqual([
		{
			command: gate,
			exitCode: 9,
			qualification: "claimed-pass",
			integrity: "not-claimed",
			hostPlatform: "linux",
		},
	]);
	expect(scenario.check(fixture("passed on Linux with exit 9"))).toContain(
		"Claimed command pass lacks matching accepted complete source evidence.",
	);
});
