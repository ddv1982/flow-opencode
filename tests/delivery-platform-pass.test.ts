import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { DELIVERY_SCENARIOS } from "../evals/delivery-scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import {
	validation as capturedValidation,
	deferredCaptureOutcome,
	externalCommand,
	localCommand,
	nativeTrace,
} from "./fixtures/deferred-capture-outcome.js";
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
for (const metadata of [
	"host Linux, source current",
	"host Linux, report retained",
	"host Linux, output recorded",
	"host Linux, source current, report retained",
	'host Linux, report "retained, host Windows"',
]) {
	test(`numeric host preserves supported metadata ${metadata}`, () => {
		expect(
			scenario.check(
				fixture(`passed, exit 0, ${metadata}. Independent review passed.`),
			),
		).toEqual([]);
	});
}
for (const host of ["Linux", "Windows"]) {
	test(`nonpass observation host binds to genuine deferred capture ${host}`, () => {
		const input = deferredCaptureOutcome();
		const finalText = `${input.finalText}\nObserved "${localCommand}": exit 0, host ${host}; this does not claim the command passed.`;
		const issues = deliveryIssues(
			{ ...input, finalText },
			{
				closure: "deferred",
				presentation: "summary",
				gate: localCommand,
				missingEvidenceCommand: externalCommand,
				allowedPaths: ["src/parser.mjs"],
			},
		);
		if (host === "Linux") expect(issues).toEqual([]);
		else
			expect(issues).toContain(
				"Claimed command host lacks matching accepted complete source evidence.",
			);
	});
}
for (const prose of [
	"It preserves trimming behavior.",
	"Its implementation preserves trimmed string inputs.",
	"The script handles null safely.",
]) {
	test(`ordinary post-review prose remains intact ${prose}`, () => {
		expect(scenario.check(fixture(`${phrase} ${prose}`))).toEqual([]);
	});
}
test("canonical win32 platform becomes a typed host claim", () => {
	const expected = [
		{
			command: gate,
			exitCode: 0,
			qualification: "claimed-pass" as const,
			integrity: "not-claimed" as const,
			hostPlatform: "win32" as const,
		},
	];
	expect(
		currentHandoffFacts(`${gate} passed on win32.`, [gate]).observations,
	).toEqual(expected);
});
test("unregistered win32 platform claim remains unsupported", () => {
	const input = fixture();
	input.finalText = input.finalText.replace(
		`\`${gate}\` ${phrase}`,
		"`node scripts/other.mjs` passed on win32. Independent review passed.",
	);
	expect(scenario.check(input)).toContain(
		"Unsupported or conflicting current handoff assertions.",
	);
});
test("recognized win32 claim still fails the Linux native witness", () => {
	expect(
		scenario.check(fixture("passed on win32. Independent review passed.")),
	).toContain(
		"Claimed command pass lacks matching accepted complete source evidence.",
	);
});
for (const change of ["nonzero", "incomplete", "source", "intent"]) {
	test(`nonpass host cannot rescue corrupt deferred capture ${change}`, () => {
		const input = deferredCaptureOutcome();
		const value = capturedValidation(input);
		if (change === "nonzero") value.exitCode = 1;
		if (change === "incomplete") value.outputComplete = false;
		if (change === "source") value.sourceDigest = `sha256:${"b".repeat(64)}`;
		if (change === "intent") value.intent = "observe";
		const finalText = `${input.finalText}\nObserved "${localCommand}": exit 0, host Linux; this does not claim the command passed.`;
		expect(
			deliveryIssues(
				{ ...input, finalText },
				{
					closure: "deferred",
					presentation: "summary",
					gate: localCommand,
					missingEvidenceCommand: externalCommand,
					allowedPaths: ["src/parser.mjs"],
				},
			),
		).toContain(
			"Claimed command host lacks matching accepted complete source evidence.",
		);
	});
}
for (const metadata of [
	"host Windows, source current",
	"host Solaris, source current",
	"host Linux, host Windows",
]) {
	test(`numeric metadata cannot hide conflicting host ${metadata}`, () => {
		expect(
			scenario.check(
				fixture(`passed, exit 0, ${metadata}. Independent review passed.`),
			).length,
		).toBeGreaterThan(0);
	});
}
function capturedHosts(first: string, second?: string, pinned = false) {
	const input = deferredCaptureOutcome();
	const archive = object(input.archives[0]);
	const plan = object(archive.plan);
	if (!pinned) {
		if (!Array.isArray(plan.evidence))
			throw new Error("Missing plan evidence.");
		for (const entry of plan.evidence.map(object))
			if (entry.command === localCommand) delete entry.platform;
		if (!Array.isArray(plan.features))
			throw new Error("Missing plan features.");
		for (const feature of plan.features.map(object))
			if (Array.isArray(feature.checks))
				for (const check of feature.checks.map(object))
					if (check.command === localCommand) delete check.platform;
	}
	capturedValidation(input).hostPlatform = first;
	const calls = [...input.allCalls];
	const arm = calls.find((call) => call.tool === "flow_validation_start");
	const bash = calls.find((call) => call.tool === "bash");
	const status = calls.find((call) => call.tool === "flow_status");
	const close = calls.find((call) => call.tool === "flow_session_close");
	if (!arm || !bash || !status || !close)
		throw new Error("Missing capture calls.");
	const firstProjection = object(
		object(object(status.output).workflowData).projection,
	);
	firstProjection.plan = structuredClone(plan);
	const firstRuns = firstProjection.runs;
	if (!Array.isArray(firstRuns)) throw new Error("Missing status runs.");
	const firstValidations = object(firstRuns[0]).validations;
	if (!Array.isArray(firstValidations))
		throw new Error("Missing status validation.");
	object(firstValidations[0]).hostPlatform = first;
	Object.assign(status, { rawOutput: JSON.stringify(status.output) });
	if (second !== undefined) {
		const next = {
			...capturedValidation(input),
			id: "capture-second",
			recordedRevision: 5,
			hostPlatform: second,
		};
		const archiveRuns = archive.runs;
		if (!Array.isArray(archiveRuns)) throw new Error("Missing archive runs.");
		const values = object(archiveRuns[0]).validations;
		if (!Array.isArray(values)) throw new Error("Missing archive validations.");
		values.push(next);
		const secondArm = structuredClone(arm);
		const secondBash = structuredClone(bash);
		const secondStatus = structuredClone(status);
		for (const [index, call] of [secondArm, secondBash, secondStatus].entries())
			Object.assign(object(call.native), {
				messageId: `msg_second${index}`,
				partId: `prt_second${index}`,
				callId: `call_second${index}`,
				startedAt: 26 + index * 2,
				completedAt: 27 + index * 2,
			});
		object(secondArm.input.request).expectedRevision = 4;
		object(object(object(secondArm.output).workflowData).capture).captureId =
			next.id;
		Object.assign(secondArm, { rawOutput: JSON.stringify(secondArm.output) });
		const marker = `[flow-validation] ${JSON.stringify({ id: next.id, scope: "broad", intent: "pass", passed: true, observed: false, recordedRevision: 5 })}`;
		Object.assign(secondBash, {
			output: `(no output)\n\n${marker}`,
			rawOutput: `(no output)\n\n${marker}`,
		});
		const projection = object(
			object(object(secondStatus.output).workflowData).projection,
		);
		projection.revision = 5;
		projection.runs = [
			{ ...structuredClone(object(archiveRuns[0])), state: "active" },
		];
		Object.assign(secondStatus, {
			rawOutput: JSON.stringify(secondStatus.output),
		});
		archive.revision = 6;
		object(archive.closure).recordedRevision = 6;
		object(close.input.request).expectedRevision = 5;
		object(object(object(close.output).workflowData).operation).revision = 6;
		calls.splice(calls.indexOf(close), 0, secondArm, secondBash, secondStatus);
	}
	return {
		...input,
		allCalls: calls,
		flowCalls: calls.filter((call) => call.tool.startsWith("flow_")),
		hostTrace: nativeTrace(calls),
	};
}
const deferredExpectation = {
	closure: "deferred" as const,
	presentation: "summary" as const,
	gate: localCommand,
	missingEvidenceCommand: externalCommand,
	allowedPaths: ["src/parser.mjs"],
};
test("canonical other category is retained as a host claim", () => {
	const claim = currentHandoffFacts(`${gate} passed on Other.`, [gate])
		.observations[0];
	expect(String(claim?.hostPlatform)).toBe("other");
});
test("unconstrained genuinely captured Other supports an Other claim", () => {
	const input = capturedHosts("other");
	const finalText =
		input.finalText
			.replace(/^- \*\*Linux validation:\*\*.*\n/m, "")
			.replace(/^- \*\*Outstanding proof:\*\*.*\n/m, "") +
		`\n${localCommand} passed, exit 0, host other.`;
	expect(deliveryIssues({ ...input, finalText }, deferredExpectation)).toEqual(
		[],
	);
});
test("other never infers an unknown Solaris category", () => {
	const input = capturedHosts("other");
	const finalText =
		input.finalText
			.replace(/^- \*\*Linux validation:\*\*.*\n/m, "")
			.replace(/^- \*\*Outstanding proof:\*\*.*\n/m, "") +
		`\n${localCommand} passed, exit 0, host Solaris.`;
	expect(
		deliveryIssues({ ...input, finalText }, deferredExpectation),
	).toContain("Unsupported or conflicting current handoff assertions.");
});
