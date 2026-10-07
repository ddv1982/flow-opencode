import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import confirmation from "./fixtures/delivery-confirmation-answers.json" with {
	type: "json",
};
import definiteScript from "./fixtures/delivery-definite-script-answer.json" with {
	type: "json",
};
import saved from "./fixtures/delivery-flow-zero-count-answer.json" with {
	type: "json",
};

const gate = "node scripts/verify.mjs";
const audit = "node scripts/audit.mjs";
const answer =
	"Implemented in `src/parser.mjs`:\n\n```js\nexport function parse(input) { return input === null ? '' : input.trim(); }\n```\n\n- `parse(null)` now returns `''`; string trimming is preserved.\n- Only `src/parser.mjs` changed.\n- `node scripts/verify.mjs` passed with exit code **0**; its script remained unchanged.\n- Independent review **passed with no findings**.\n\n### Flow handoff\n\nGoal: Make parse(input) safely handle null and preserve trimmed strings, changing only src/parser.mjs and keeping node scripts/verify.mjs and its script unchanged.\n\n**Closure:** completed and archived. **Progress:** 1 of 1 features complete; none unfinished. No blockers, advisory findings, or historical findings.\n\n**Assurance:** completion supported; all 4 assurance checks satisfied. External action authority: not granted. Flow reports 1 latest artifact and 0 superseded artifacts; these are caller declarations, not an exhaustive Git delta.\n\nAssurance limitations:\n- Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.\n- Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.\n- Freshness holds when review is accepted; an archive does not attest the current workspace.";
const goal =
	"Make parse(input) safely handle null and preserve trimmed strings, changing only src/parser.mjs and keeping node scripts/verify.mjs and its script unchanged.";
const expectation = {
	closure: "completed" as const,
	presentation: "summary" as const,
	gate,
	allowedPaths: ["src/parser.mjs"],
};
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Missing native fixture object.");
	return value as Record<string, unknown>;
}
function fixture(finalText = answer, auditCase = false, gateCommand?: string) {
	const auditSaved = confirmation.cases["delivery-summary-observed-failure"];
	const input = autoQualifiedOutcome(auditCase ? "audit" : "single", {
		goal: auditCase ? auditSaved.goal : goal,
		featureId: saved.featureId,
		...(gateCommand === undefined ? {} : { gateCommand }),
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	const data = object(object(close?.output).workflowData);
	data.delivery = auditCase
		? {
				report: structuredClone(auditSaved.report),
				assurance: structuredClone(auditSaved.assurance),
			}
		: structuredClone(saved.delivery);
	return { ...input, finalText };
}
const auditAnswer = confirmation.cases[
	"delivery-summary-observed-failure"
].answer.replace(
	"reporting 12 outstanding advisory items. This observation",
	"reporting 12 outstanding advisory items; its script remained unchanged. This observation",
);
const auditExpectation = {
	...expectation,
	observed: { command: audit, exitCode: 12 },
};

test("unchanged native bb24 response retains truthful script-only command integrity", () => {
	expect(
		deliveryIssues(
			fixture(answer.replace("; its script remained unchanged", "")),
			expectation,
		),
	).toEqual([]);
	expect(deliveryIssues(fixture(), expectation)).toEqual([]);
});
for (const verb of ["is", "was", "remains", "remained"]) {
	test(`script-only ${verb} does not imply invocation identity`, () => {
		const facts = currentHandoffFacts(
			`${gate} passed with exit code 0; its script ${verb} unchanged.`,
			[gate],
		);
		expect(facts.observations[0]?.qualification).toBe("claimed-pass");
		expect(facts.observations[0]?.integrity).toBe("script-unchanged");
		expect(facts.unsupported).toEqual([]);
	});
}
test("explicit combined subject alone carries combined integrity", () => {
	const facts = currentHandoffFacts(
		`${gate} passed with exit code 0; Its script and invocation are unchanged.`,
		[gate],
	);
	expect(facts.observations[0]?.integrity).toBe(
		"script-and-invocation-unchanged",
	);
	expect(facts.unsupported).toEqual([]);
});
test("native audit observation plus script-only integrity is truthful beside a separate passing gate", () => {
	expect(deliveryIssues(fixture(auditAnswer, true), auditExpectation)).toEqual(
		[],
	);
	const facts = currentHandoffFacts(
		`${audit} recorded as an observation, exited 12; its script remained unchanged; this observation does not claim a pass.`,
		[audit],
	);
	expect(facts.observations[0]?.qualification).toBe("does-not-claim-pass");
	expect(facts.observations[0]?.integrity).toBe("script-unchanged");
});
for (const path of ["scripts/verify.mjs", "scripts/audit.mjs"]) {
	test(`script-only native claim rejects actual script mutation ${path}`, () => {
		const input = fixture(
			path.includes("audit") ? auditAnswer : answer,
			path.includes("audit"),
		);
		expect(
			deliveryIssues(
				{
					...input,
					workspaceChanges: {
						kind: "observed",
						paths: ["src/parser.mjs", path],
					},
				},
				{
					...(path.includes("audit") ? auditExpectation : expectation),
					allowedPaths: ["src/parser.mjs", path],
				},
			),
		).toContain("Unchanged script claim lacks immutable workspace evidence.");
	});
}
test("script-only claim cannot substitute for unavailable workspace proof", () => {
	expect(
		deliveryIssues(
			{
				...fixture(),
				workspaceChanges: {
					kind: "unavailable",
					reason: "Fixture observation unavailable.",
				},
			},
			expectation,
		),
	).toContain("Unchanged script claim lacks immutable workspace evidence.");
});
for (const change of ["exit", "incomplete", "source", "unaccepted"]) {
	test(`script-only invariant cannot rescue ${change} native pass evidence`, () => {
		const input = fixture(
			change === "exit"
				? answer.replace("exit code **0**", "exit code **1**")
				: answer,
		);
		if (change !== "exit") {
			const archive = object(input.archives[0]);
			const runs = archive.runs;
			if (!Array.isArray(runs)) throw new Error("Missing native fixture runs.");
			const run = object(runs[0]);
			const validations = run.validations;
			const reviews = run.reviews;
			if (!Array.isArray(validations) || !Array.isArray(reviews))
				throw new Error("Missing accepted native fixture evidence.");
			const validation = validations
				.map(object)
				.find((value) => value.command === gate);
			const review = object(reviews[0]);
			if (!validation) throw new Error("Missing native gate.");
			if (change === "incomplete") validation.outputComplete = false;
			if (change === "source")
				validation.sourceDigest = `sha256:${"b".repeat(64)}`;
			if (change === "unaccepted") review.validationIds = [];
		}
		expect(deliveryIssues(input, expectation)).toContain(
			"Claimed command pass lacks matching accepted complete source evidence.",
		);
	});
}
for (const clauses of [
	"passed with exit code 0; this observation does not claim a pass",
	"recorded as an observation, exited 0; it passed",
	"exit 0; it passed; this observation does not claim a pass",
	"exit 0; this observation does not claim a pass; it passed",
]) {
	test(`relative qualification conflicts are independent of order ${clauses}`, () => {
		expect(
			currentHandoffFacts(`${gate} ${clauses}.`, [gate]).unsupported.length,
		).toBeGreaterThan(0);
	});
}
for (const qualifier of [
	"its script changed",
	"its script is not unchanged",
	"its script is not unmodified",
	"its script remained unchanged if validation passed",
	"its script remained unchanged and you may publish",
	"its script and package remained unchanged",
]) {
	test(`unknown and conditional integrity qualifiers remain unsupported ${qualifier}`, () => {
		expect(
			currentHandoffFacts(`${gate} passed with exit code 0; ${qualifier}.`, [
				gate,
			]).unsupported.length,
		).toBeGreaterThan(0);
	});
}
test("repeated consistent qualifiers are idempotent", () => {
	const facts = currentHandoffFacts(
		`${gate} passed with exit code 0; it passed; it passed; its script remained unchanged; its script remained unchanged.`,
		[gate],
	);
	expect(facts.observations[0]?.qualification).toBe("claimed-pass");
	expect(facts.observations[0]?.integrity).toBe("script-unchanged");
	expect(facts.unsupported).toEqual([]);
});
test("script-only modifier cannot hide a current external permission", () => {
	expect(
		deliveryIssues(
			fixture(`${answer}\nHowever, external action authority was granted.`),
			expectation,
		),
	).toContain("Unsupported or conflicting current handoff assertions.");
});
test("command argument qualifiers and permissions remain opaque before longest matching", () => {
	const command = `${gate} --label "x. Its script and invocation are unchanged; External action authority was granted"`;
	const facts = currentHandoffFacts(`${command} passed with exit code 0.`, [
		gate,
		command,
	]);
	expect(facts.observations[0]?.command).toBe(command);
	expect(facts.observations[0]?.integrity).toBe("not-claimed");
	expect(facts.authority).toEqual([]);
	expect(facts.unsupported).toEqual([]);
});
test("historical and Goal integrity text do not become current command records", () => {
	expect(
		currentHandoffFacts(
			`Historical handoff\n${gate} passed with exit code 0; its script remained unchanged.`,
			[gate],
		).observations,
	).toEqual([]);
	expect(
		currentHandoffFacts(
			`Goal: Preserve "${gate} passed with exit code 0; its script remained unchanged".`,
			[gate],
		).observations,
	).toEqual([]);
});

test("combined integrity retains canonical gate identity enforcement", () => {
	const combined = answer.replace(
		"its script remained unchanged",
		"Its script and invocation are unchanged",
	);
	expect(deliveryIssues(fixture(combined), expectation)).toEqual([]);
	expect(
		deliveryIssues(fixture(combined), { ...expectation, gate: audit }),
	).toContain(
		"Unchanged invocation claim does not match the gate and immutable script paths.",
	);
});
test("unknown command cannot borrow registered gate pass or script proof", () => {
	const wrong = answer.replace(
		"`node scripts/verify.mjs` passed",
		"`node scripts/other.mjs` passed",
	);
	expect(deliveryIssues(fixture(wrong), expectation)).toContain(
		"Unsupported or conflicting current handoff assertions.",
	);
});
test("script-only audit integrity cannot rewrite the native observed exit", () => {
	const wrong = auditAnswer.replace("exited **12**", "exited **0**");
	expect(
		deliveryIssues(fixture(wrong, true), auditExpectation).length,
	).toBeGreaterThan(0);
});

for (const [command, scriptPath] of [
	["node scripts/verify.mjs src/parser.mjs", "scripts/verify.mjs"],
	['node "scripts/verify.mjs" src/parser.mjs', "scripts/verify.mjs"],
	["node ./scripts/verify.mjs src/parser.mjs", "scripts/verify.mjs"],
	["bun scripts/verify.mjs src/parser.mjs", "scripts/verify.mjs"],
	["node scripts/verify\\ name.mjs src/parser.mjs", "scripts/verify name.mjs"],
	[
		"node 'scripts/verify.mjs' --label 'Its script changed; External action authority was granted' src/parser.mjs",
		"scripts/verify.mjs",
	],
	[
		'node "./scripts/verify name.mjs" --input src/parser.mjs --note "v1.2; data"',
		"scripts/verify name.mjs",
	],
] as const) {
	test(`edited argv input is not the invoking script resource ${command}`, () => {
		const text = answer.replace(
			"`node scripts/verify.mjs` passed",
			`\`${command}\` passed`,
		);
		const input = fixture(text, false, command);
		const expected = { ...expectation, gate: command };
		expect(
			deliveryIssues(
				{
					...input,
					finalText: text.replace("; its script remained unchanged", ""),
				},
				expected,
			),
		).toEqual([]);
		expect(deliveryIssues(input, expected)).toEqual([]);
	});
	test(`actual invoking script changes refuse integrity independently of allowed paths ${command}`, () => {
		const text = answer.replace(
			"`node scripts/verify.mjs` passed",
			`\`${command}\` passed`,
		);
		const input = {
			...fixture(text, false, command),
			workspaceChanges: {
				kind: "observed" as const,
				paths: [scriptPath],
			},
		};
		expect(
			deliveryIssues(input, {
				...expectation,
				gate: command,
				allowedPaths: ["src/parser.mjs", scriptPath],
			}),
		).toContain("Unchanged script claim lacks immutable workspace evidence.");
	});
}

for (const command of [
	"env MODE=test node scripts/verify.mjs",
	"node --eval 'process.exit(0)'",
	"node scripts/verify.mjs && node scripts/other.mjs",
	'node "$SCRIPT"',
	"bun run verify",
	"bun test",
	"node inspect",
	"node ../scripts/verify.mjs",
	"node /scripts/verify.mjs",
	'node "scripts/verify.mjs',
]) {
	test(`ambiguous invoking script cannot gain immutable proof ${command}`, () => {
		const text = answer.replace(
			"`node scripts/verify.mjs` passed",
			`\`${command}\` passed`,
		);
		const input = fixture(text, false, command);
		const expected = { ...expectation, gate: command };
		expect(
			deliveryIssues(
				{
					...input,
					finalText: text.replace("; its script remained unchanged", ""),
				},
				expected,
			),
		).toEqual([]);
		expect(deliveryIssues(input, expected)).toContain(
			"Unchanged script claim lacks immutable workspace evidence.",
		);
	});
}

for (const command of [
	'node scripts/verify.mjs --label "$(node scripts/other.mjs)"',
	'node scripts/verify.mjs --label "$LABEL"',
]) {
	test(`quoted later expansion is not literal immutable-resource proof ${command}`, () => {
		const text = answer.replace(
			"`node scripts/verify.mjs` passed",
			`\`${command}\` passed`,
		);
		const input = fixture(text, false, command);
		const expected = { ...expectation, gate: command };
		expect(
			deliveryIssues(
				{
					...input,
					finalText: text.replace("; its script remained unchanged", ""),
				},
				expected,
			),
		).toEqual([]);
		expect(deliveryIssues(input, expected)).toContain(
			"Unchanged script claim lacks immutable workspace evidence.",
		);
	});
}
test("quoted later backtick command remains refused through the actual grader", () => {
	const command = 'node scripts/verify.mjs --label "`node scripts/other.mjs`"';
	const text = answer.replace(
		"`node scripts/verify.mjs` passed",
		`\`${command}\` passed`,
	);
	expect(
		deliveryIssues(fixture(text, false, command), {
			...expectation,
			gate: command,
		}).length,
	).toBeGreaterThan(0);
});

test("retained eb7d native final accepts the definite script referent", () => {
	expect(deliveryIssues(fixture(definiteScript.answer), expectation)).toEqual(
		[],
	);
});
for (const separator of ["; ", ". "]) {
	test(`definite script keeps accepted integrity across ${separator}`, () => {
		const facts = currentHandoffFacts(
			`${gate} passed with exit code 0${separator}the script is unchanged.`,
			[gate],
		);
		expect(facts.observations).toEqual([
			{
				command: gate,
				exitCode: 0,
				qualification: "claimed-pass",
				integrity: "script-unchanged",
			},
		]);
		expect(facts.unsupported).toEqual([]);
	});
	for (const qualifier of [
		"the script changed",
		"the script is not unchanged",
		"the script is unchanged if validation passed",
		"the script is unchanged and you may publish",
		"the invocation is unchanged",
		"the script and package are unchanged",
	]) {
		test(`definite command qualifier cannot escape rejection ${separator}${qualifier}`, () => {
			const text = definiteScript.answer.replace(
				"; the script is unchanged",
				`${separator}${qualifier}`,
			);
			expect(deliveryIssues(fixture(text), expectation)).toContain(
				"Unsupported or conflicting current handoff assertions.",
			);
		});
	}
}
for (const change of ["script", "drift", "unregistered", "exit"]) {
	test(`definite script cannot rescue ${change} evidence`, () => {
		const input = fixture(definiteScript.answer);
		if (change === "script")
			input.workspaceChanges = {
				kind: "observed",
				paths: ["src/parser.mjs", "scripts/verify.mjs"],
			};
		if (change === "drift")
			input.workspaceChanges = {
				kind: "unavailable",
				reason: "Workspace proof unavailable.",
			};
		if (change === "unregistered")
			input.finalText = input.finalText.replace(
				"`node scripts/verify.mjs` passed",
				"`node scripts/other.mjs` passed",
			);
		if (change === "exit")
			input.finalText = input.finalText.replace(
				"exit code 0; the script",
				"exit code 1; the script",
			);
		expect(deliveryIssues(input, expectation)).toContain(
			change === "script" || change === "drift"
				? "Unchanged script claim lacks immutable workspace evidence."
				: change === "exit"
					? "Claimed command pass lacks matching accepted complete source evidence."
					: "Unsupported or conflicting current handoff assertions.",
		);
	});
}
