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
);
if (!scenario) throw new Error("Missing observed-failure scenario.");
const phrase = "passed on Linux, and independent review passed.";
function fixture(status: string) {
	const input = autoQualifiedOutcome("audit", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (!close) throw new Error("Missing native close response.");
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
	"confirming successful execution",
	"confirming skipped tests",
	"confirming partial observations",
	"confirming rewritten verification",
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

for (const status of [
	"passed",
	"passed with exit code 0",
	"passed, exit 0, host Linux",
]) {
	test(`existing status production accepts nominal adjunct ${status}`, () => {
		const facts = currentHandoffFacts(
			`${gate} ${status}, confirming range validation.`,
			[gate],
		);
		expect(facts.observations[0]?.qualification).toBe("claimed-pass");
		expect(facts.observations[0]?.exitCode).toBe(0);
		expect(facts.observations[0]?.integrity).toBe("not-claimed");
		expect(facts.unsupported).toEqual([]);
	});
}
test("explanation preserves explicit supported integrity qualifier", () => {
	expect(
		currentHandoffFacts(
			`${gate} passed on Linux, confirming null handling; its script was unchanged.`,
			[gate],
		).observations,
	).toEqual([
		{
			command: gate,
			exitCode: 0,
			qualification: "claimed-pass",
			integrity: "script-unchanged",
			hostPlatform: "linux",
		},
	]);
});
for (const status of [
	"passed on Linux, confirming null handling; its invocation was modified, and independent review passed.",
	"passed on Linux, confirming null handling, and independent review passed; its script was changed.",
	"passed on Linux, confirming null handling; its script remains unchanged if deployed.",
	"passed on Linux, confirming null handling, then failed.",
]) {
	test(`adjunct retains attached qualifier scope ${status}`, () => {
		expect(
			currentHandoffFacts(`${gate} ${status}`, [gate]).unsupported.length,
		).toBeGreaterThan(0);
	});
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Missing native fixture object.");
	return value as Record<string, unknown>;
}
for (const [field, value] of [
	["hostPlatform", "win32"],
	["outputComplete", false],
	["sourceDigest", `sha256:${"f".repeat(64)}`],
	["intent", "observe"],
	["exitCode", 1],
] as const) {
	test(`nominal explanation supplies no native ${field} proof`, () => {
		const input = fixture("passed on Linux, confirming null handling.");
		const runs = object(input.archives[0]).runs as unknown[];
		const validations = object(runs[0]).validations as unknown[];
		const validation = validations
			.map(object)
			.find((item) => item.command === gate);
		if (!validation) throw new Error("Missing native gate validation.");
		validation[field] = value;
		expect(scenario.check(input).length).toBeGreaterThan(0);
	});
}
test("nominal explanation supplies no accepted independent review", () => {
	const input = fixture("passed on Linux, confirming null handling.");
	const runs = object(input.archives[0]).runs as unknown[];
	object(runs[0]).reviews = [];
	expect(scenario.check(input).length).toBeGreaterThan(0);
});

for (const complement of [
	"passing checks",
	"failing checks",
	"passes all checks",
	"failures in checks",
	"successful checks",
	"succeeding checks",
	"successes in checks",
	"release approval",
	"release approvals",
	"approving release",
	"authorizing release",
	"release authorizations",
	"release permissions",
	"granting permission",
	"changing verification",
	"modifying verification",
	"editing verification",
]) {
	test(`explanation rejects assertion morphology ${complement}`, () => {
		expect(
			scenario.check(fixture(`passed on Linux, confirming ${complement}.`)),
		).toContain("Unsupported or conflicting current handoff assertions.");
	});
}
for (const complement of [
	"password handling",
	"failureless parsing",
	"passingword trimming",
]) {
	test(`reserved assertion morphology uses whole words ${complement}`, () => {
		expect(
			scenario.check(fixture(`passed on Linux, confirming ${complement}.`)),
		).toEqual([]);
	});
}
