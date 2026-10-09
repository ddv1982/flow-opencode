import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { DELIVERY_SCENARIOS } from "../evals/delivery-scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-platform-pass-answer.json" with {
	type: "json",
};

const gate = "node scripts/verify.mjs";
const phrase = "passed on Linux, and independent review passed.";
const scenario = DELIVERY_SCENARIOS.find(
	(item) => item.id === "delivery-summary-observed-failure",
);
if (!scenario) throw new Error("Missing observed-failure scenario.");
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Missing fixture object.");
	return value as Record<string, unknown>;
}
function fixture(status = phrase) {
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
	return { ...input, finalText: saved.answer.replace(phrase, status) };
}
function run(input: ReturnType<typeof fixture>) {
	const runs = object(input.archives[0]).runs;
	if (!Array.isArray(runs)) throw new Error("Missing runs.");
	return object(runs[0]);
}
function validation(input: ReturnType<typeof fixture>) {
	const validations = run(input).validations;
	if (!Array.isArray(validations)) throw new Error("Missing validations.");
	const value = validations.map(object).find((item) => item.command === gate);
	if (!value) throw new Error("Missing gate validation.");
	return value;
}
for (const status of [
	phrase,
	"passed on Linux. Independent review passed.",
	"passed, and independent review passed.",
	"passed. Independent review passed.",
	"passed, exit 0, host Linux. Independent review passed.",
]) {
	test(`organic host and review clauses succeed ${status}`, () => {
		expect(scenario.check(fixture(status))).toEqual([]);
	});
}
test("host and joined review remain separate typed facts", () => {
	const facts = currentHandoffFacts(`${gate} ${phrase}`, [gate]);
	const expected = [
		{
			command: gate,
			exitCode: 0,
			qualification: "claimed-pass" as const,
			integrity: "not-claimed" as const,
			hostPlatform: "linux",
		},
	];
	expect(facts.observations).toEqual(expected);
	expect(facts.independentReview).toEqual([
		{ kind: "passed", findings: "not-claimed" },
	]);
});
for (const host of ["darwin", "win32", "other", null, "unknown"]) {
	test(`asserted Linux host rejects mismatched native witness ${host}`, () => {
		const input = fixture();
		validation(input).hostPlatform = host;
		expect(scenario.check(input)).toContain(
			"Claimed command pass lacks matching accepted complete source evidence.",
		);
	});
}
test("unclaimed native host metadata retains prior compatibility", () => {
	const input = fixture("passed. Independent review passed.");
	validation(input).hostPlatform = { opaque: "historical metadata" };
	expect(scenario.check(input)).toEqual([]);
});
test("an unrelated matching host cannot rescue the bound validation", () => {
	const input = fixture();
	validation(input).hostPlatform = "darwin";
	const validations = run(input).validations;
	if (!Array.isArray(validations)) throw new Error("Missing validations.");
	validations.push({
		...validation(input),
		id: "unaccepted-host-witness",
		hostPlatform: "linux",
	});
	expect(scenario.check(input)).toContain(
		"Claimed command pass lacks matching accepted complete source evidence.",
	);
});
for (const change of [
	"nonzero",
	"incomplete",
	"source",
	"unaccepted",
	"observe",
]) {
	test(`platform claim cannot rescue ${change} native proof`, () => {
		const input = fixture();
		const value = validation(input);
		if (change === "nonzero") value.exitCode = 1;
		if (change === "incomplete") value.outputComplete = false;
		if (change === "source") value.sourceDigest = `sha256:${"b".repeat(64)}`;
		if (change === "observe") value.intent = "observe";
		if (change === "unaccepted") {
			const reviews = run(input).reviews;
			if (!Array.isArray(reviews)) throw new Error("Missing reviews.");
			object(reviews[0]).validationIds = [];
		}
		expect(scenario.check(input)).toContain(
			"Claimed command pass lacks matching accepted complete source evidence.",
		);
	});
}
for (const tail of [
	"This command failed.",
	"This observation does not claim a pass.",
	"Its script changed.",
	"and deployed.",
]) {
	test(`joined sibling preserves conflicting tail ${tail}`, () => {
		expect(scenario.check(fixture(`${phrase} ${tail}`))).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}
for (const status of [
	"passed on Mars. Independent review passed.",
	"passed, exit 0, host Mars. Independent review passed.",
	"passed, exit 0, host Windows. Independent review passed.",
	"passed on Linux, and independent review passed and deployed.",
]) {
	test(`invalid host or review suffix cannot pass ${status}`, () => {
		expect(scenario.check(fixture(status)).length).toBeGreaterThan(0);
	});
}
test("unregistered compound command cannot borrow native proof", () => {
	const input = fixture();
	input.finalText = input.finalText.replace(
		`\`${gate}\` ${phrase}`,
		`\`node scripts/other.mjs\` ${phrase}`,
	);
	expect(scenario.check(input)).toContain(
		"Unsupported or conflicting current handoff assertions.",
	);
});
for (const text of [
	`Goal: Preserve '${gate} ${phrase}'`,
	`Historical handoff\n${gate} ${phrase}`,
	`Example: ${gate} ${phrase}`,
]) {
	test(`compound proof retains scope ${text}`, () => {
		const facts = currentHandoffFacts(text, [gate]);
		expect(facts.observations).toEqual([]);
		expect(facts.independentReview).toEqual([]);
	});
}
test("quoted command arguments cannot become review siblings", () => {
	const command = `${gate} --label "retained, and independent review passed with no findings"`;
	const facts = currentHandoffFacts(`${command} passed on Linux.`, [command]);
	const expected = [
		{
			command,
			exitCode: 0,
			qualification: "claimed-pass" as const,
			integrity: "not-claimed" as const,
			hostPlatform: "linux",
		},
	];
	expect(facts.observations).toEqual(expected);
	expect(facts.independentReview).toEqual([]);
});
