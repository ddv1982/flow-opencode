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
			hostPlatform: "linux" as const,
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
test("unclaimed native host metadata retains existing native protocol rejection", () => {
	const input = fixture("passed. Independent review passed.");
	validation(input).hostPlatform = "other";
	expect(scenario.check(input)).toEqual([
		"parser-null: Accepted current-source validation and submitted review are missing.",
		"Independent review claim contradicts accepted native review evidence.",
	]);
});
test("an unrelated matching host cannot rescue the bound validation", () => {
	const input = fixture();
	validation(input).hostPlatform = "darwin";
	const validations = run(input).validations;
	if (!Array.isArray(validations)) throw new Error("Missing validations.");
	validations.push({
		...validation(input),
		id: "unaccepted-host-witness",
		hostPlatform: "linux" as const,
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
]) {
	test(`joined sibling preserves conflicting tail ${tail}`, () => {
		expect(scenario.check(fixture(`${phrase} ${tail}`))).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}
for (const change of ["native-host", "reported-host"]) {
	test(`numeric audit host binds to its own reviewed witness ${change}`, () => {
		const input = fixture("passed. Independent review passed.");
		if (change === "native-host") {
			const values = run(input).validations;
			if (!Array.isArray(values)) throw new Error("Missing validations.");
			const audit = values
				.map(object)
				.find((value) => value.command === "node scripts/audit.mjs");
			if (!audit) throw new Error("Missing audit validation.");
			audit.hostPlatform = "win32";
		} else
			input.finalText = input.finalText.replace(
				"exit 12, host linux",
				"exit 12, host Windows",
			);
		expect(scenario.check(input)).toContain(
			"Nonzero observation lacks accepted reviewed evidence.",
		);
	});
}
for (const tail of ["; its script changed.", "; this command exited 1."]) {
	test(`semicolon sibling tail remains checked ${tail}`, () => {
		expect(scenario.check(fixture(phrase.replace(/\.$/, tail)))).toContain(
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
			hostPlatform: "linux" as const,
		},
	];
	expect(facts.observations).toEqual(expected);
	expect(facts.independentReview).toEqual([]);
});
for (const prefix of [
	"Its script was modified to preserve trimming behavior.",
	"The script was modified to handle null input.",
]) {
	test(`unowned implementation prose remains context ${prefix}`, () => {
		const input = fixture();
		input.finalText = `${prefix}\n${input.finalText}`;
		expect(scenario.check(input)).toEqual([]);
	});
}
for (const separator of [". ", "; "]) {
	for (const qualifier of [
		"Its script was unchanged.",
		"Its script and invocation were unchanged.",
	]) {
		test(`joined review keeps truthful command qualifier ${separator}${qualifier}`, () => {
			const status = phrase.replace(/\.$/, `${separator}${qualifier}`);
			expect(scenario.check(fixture(status))).toEqual([]);
		});
	}
}
