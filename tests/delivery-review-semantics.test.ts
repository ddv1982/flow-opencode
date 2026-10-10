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
	const value = (run(input).validations as unknown[])
		.map(object)
		.find((item) => item.command === gate);
	if (!value) throw new Error("Missing gate validation.");
	return value;
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
function delivery(input: ReturnType<typeof fixture>) {
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	return object(object(close?.output).workflowData)
		.delivery as typeof saved.delivery;
}
function liveFinding(input: ReturnType<typeof fixture>) {
	const value = delivery(input).findingsDigest[0];
	if (!value) throw new Error("Missing live finding.");
	return value;
}
test("no blocking findings permits current advisory but no findings does not", () => {
	expect(scenario.check(fixture())).toEqual([]);
	expect(scenario.check(fixture(status, "passed with no findings"))).toContain(
		"Independent review claim contradicts accepted native review evidence.",
	);
});
test("no blocking findings rejects a current live blocker", () => {
	const input = fixture();
	const finding = liveFinding(input);
	Object.assign(finding, { severity: "blocking" });
	expect(scenario.check(input)).toContain(
		"Independent review claim contradicts accepted native review evidence.",
	);
});
test("cleared historical blocker is outside the current review claim", () => {
	const input = fixture();
	delivery(input).findingsDigest.push({
		...liveFinding(input),
		findingId: "historical-blocker",
		severity: "blocking",
		live: false,
	});
	expect(scenario.check(input)).not.toContain(
		"Independent review claim contradicts accepted native review evidence.",
	);
});
for (const change of [
	"nonzero",
	"missing-exit",
	"incomplete",
	"source",
	"observe",
	"detached-validation",
	"rejected-review",
	"missing-review",
	"inaccessible-review",
]) {
	test(`truthful prose cannot replace ${change} native proof`, () => {
		const input = fixture();
		const value = validation(input);
		const reviews = run(input).reviews as unknown[];
		const accepted = object(reviews[0]);
		if (change === "nonzero") value.exitCode = 1;
		if (change === "missing-exit") value.exitCode = null;
		if (change === "incomplete") value.outputComplete = false;
		if (change === "source") value.sourceDigest = `sha256:${"b".repeat(64)}`;
		if (change === "observe") value.intent = "observe";
		if (change === "detached-validation") accepted.validationIds = [];
		if (change === "rejected-review")
			object(accepted.result).verdict = "failed";
		if (change === "missing-review") run(input).reviews = [];
		if (change === "inaccessible-review") input.packetBytes = [];
		expect(scenario.check(input)).toContain(
			change === "inaccessible-review"
				? "Independent review claim contradicts accepted native review evidence."
				: "Claimed command pass lacks matching accepted complete source evidence.",
		);
	});
}
for (const tail of [
	", host Windows",
	", host Solaris",
	", exit 9",
	", exit 0",
	", host Linux, host Windows",
	"; this command exited 9",
	"; its script changed",
	"; its invocation changed",
	", source current, release clearance granted",
	", source current, deployment consent granted",
]) {
	test(`host-before-exit preserves unsupported or contradictory tail ${tail}`, () => {
		expect(scenario.check(fixture(status + tail))).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}
for (const metadata of [
	", source current",
	", report retained",
	', report "retained, host Windows"',
	", host linux, source current",
]) {
	test(`host-before-exit retains supported metadata ${metadata}`, () => {
		expect(scenario.check(fixture(status + metadata))).toEqual([]);
	});
}
for (const host of ["Windows", "macOS", "Solaris", "Other"]) {
	test(`host-before-exit claim cannot borrow Linux proof for ${host}`, () => {
		expect(scenario.check(fixture(status.replace("Linux", host)))).not.toEqual(
			[],
		);
	});
}
for (const [alias, native] of [
	["Linux", "linux"],
	["macOS", "darwin"],
	["Windows", "win32"],
	["Other", "other"],
] as const) {
	test(`host-before-exit retains canonical alias ${alias}`, () => {
		expect(
			currentHandoffFacts(`${gate} passed on ${alias} with exit 0.`, [gate])
				.observations,
		).toEqual([
			{
				command: gate,
				exitCode: 0,
				qualification: "claimed-pass",
				integrity: "not-claimed",
				hostPlatform: native,
			},
		]);
	});
}
for (const suffix of [
	" and deployed",
	" with release clearance",
	" and no advisory findings",
]) {
	test(`review qualifier cannot swallow extra assertion ${suffix}`, () => {
		expect(scenario.check(fixture(status, review + suffix))).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}
for (const prefix of ["Goal: ", "Example: ", "Historical handoff\n"]) {
	test(`owned claim scope excludes ${prefix}`, () => {
		const facts = currentHandoffFacts(
			`${prefix}${gate} ${status}, and independent review ${review}.`,
			[gate],
		);
		expect(facts.observations).toEqual([]);
		expect(facts.independentReview).toEqual([]);
	});
}
test("quoted command counterfeit fields remain arguments", () => {
	const command = `${gate} --label "host Windows, exit 9, and independent review passed with no blocking findings"`;
	const facts = currentHandoffFacts(`${command} ${status}.`, [command]);
	expect(facts.independentReview).toEqual([]);
	expect(facts.observations).toEqual([
		{
			command,
			exitCode: 0,
			qualification: "claimed-pass",
			integrity: "not-claimed",
			hostPlatform: "linux",
		},
	]);
});
for (const tail of ["Its script changed.", "Its invocation changed."]) {
	test(`review sibling preserves command integrity continuation ${tail}`, () => {
		expect(
			scenario.check(
				fixture(`${status}. Independent review ${review}. ${tail}`, "passed"),
			),
		).toContain("Unsupported or conflicting current handoff assertions.");
	});
}
for (const separator of ["\n", ", and "]) {
	test(`no-blocking review owns its native constraint with separator ${separator}`, () => {
		const input = fixture();
		input.finalText = input.finalText.replace(
			". Independent review",
			`${separator}Independent review`,
		);
		expect(scenario.check(input)).toEqual([]);
		Object.assign(liveFinding(input), { severity: "blocking" });
		expect(scenario.check(input)).toContain(
			"Independent review claim contradicts accepted native review evidence.",
		);
	});
}
for (const exit of ["unavailable", "9007199254740992"]) {
	test(`host-before-exit cannot invent a usable exit from ${exit}`, () => {
		expect(
			scenario.check(fixture(status.replace("exit 0", `exit ${exit}`))),
		).not.toEqual([]);
	});
}
for (const position of ["before", "after"]) {
	test(`valid claim cannot hide an independent contradiction ${position}`, () => {
		const input = fixture();
		const falseClaim = `${gate} passed on Linux with exit 9.\n`;
		input.finalText =
			position === "before"
				? falseClaim + input.finalText
				: `${input.finalText}\n${falseClaim}`;
		expect(scenario.check(input)).toContain(
			"Claimed command pass lacks matching accepted complete source evidence.",
		);
	});
}
test("ordinary runtime compatibility prose remains context", () => {
	const input = fixture();
	input.finalText +=
		"\nThe implementation preserves Node and Bun compatibility on Windows.";
	expect(scenario.check(input)).toEqual([]);
});
test("unregistered command cannot borrow accepted verification", () => {
	const input = fixture();
	input.finalText = input.finalText.replace(
		`\`${gate}\``,
		"`node scripts/other.mjs`",
	);
	expect(scenario.check(input)).toContain(
		"Unsupported or conflicting current handoff assertions.",
	);
});
for (const tail of [
	" and source verified",
	" and its script changed",
	" with verifier unchanged",
	" and deployment consent granted",
]) {
	for (const position of ["replacement", "before", "after"]) {
		test(`unregistered numeric pass retains coordinated tail ${position}${tail}`, () => {
			const input = fixture();
			const claim = `node scripts/unregistered.mjs ${status}${tail}.`;
			input.finalText =
				position === "replacement"
					? input.finalText.replace(`\`${gate}\` ${status}.`, claim)
					: position === "before"
						? `${claim}\n${input.finalText}`
						: `${input.finalText}\n${claim}`;
			expect(scenario.check(input)).toContain(
				"Unsupported or conflicting current handoff assertions.",
			);
		});
	}
}
