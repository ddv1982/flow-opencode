import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { deliveryIssues } from "../evals/delivery-scenario-checks.js";
import { checkReviewerEvidenceAccess } from "../evals/reviewer-access.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-abbreviated-assurance-answer.json" with {
	type: "json",
};

const originalClaim =
	"Assurance: **completion supported**, with all 4 checks satisfied.";
const canonicalClaim =
	"Assurance: completion supported, with all 4 assurance checks satisfied.";
const expectation = {
	closure: "completed" as const,
	presentation: "summary" as const,
	gate: "node scripts/verify.mjs",
	allowedPaths: ["src/parser.mjs"],
};

function fixture() {
	const input = autoQualifiedOutcome("single", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (
		!close?.output ||
		typeof close.output !== "object" ||
		!("workflowData" in close.output)
	)
		throw new Error("Missing native close fixture.");
	const data = close.output.workflowData;
	if (!data || typeof data !== "object")
		throw new Error("Missing native workflow data.");
	Object.assign(data, { delivery: structuredClone(saved.delivery) });
	expect(checkReviewerEvidenceAccess(input, input.archives[0])).toEqual([]);
	return input;
}

function answer(claim: string) {
	return saved.answer.replace(originalClaim, claim);
}

test("actual paid answer preserves its native conclusion and all four satisfied checks", () => {
	const input = fixture();
	expect(
		deliveryIssues(
			{ ...input, finalText: answer(canonicalClaim) },
			expectation,
		),
	).toEqual([]);
	expect(
		deliveryIssues({ ...input, finalText: saved.answer }, expectation),
	).toEqual([]);
});

for (const count of ["4", "four"]) {
	for (const noun of ["checks", "assurance checks"]) {
		for (const suffix of [
			`by all ${count} ${noun}`,
			`, with all ${count} ${noun} satisfied`,
		]) {
			const claim = `Assurance: completion supported${suffix.startsWith(",") ? "" : " "}${suffix}.`;
			test(`typed assurance consumes ${claim}`, () => {
				const facts = currentHandoffFacts(claim);
				expect(facts.assurance).toEqual(["completion-supported"]);
				expect(facts.assuranceCheckClaims).toEqual([
					{ count: 4, status: "satisfied" },
				]);
				expect(
					deliveryIssues(
						{ ...fixture(), finalText: answer(claim) },
						expectation,
					),
				).toEqual([]);
			});
		}
	}
}

test("short assurance conclusion supplies no invented check count", () => {
	const facts = currentHandoffFacts("Assurance: supported.");
	expect(facts.assurance).toEqual(["completion-supported"]);
	expect(facts.assuranceCheckClaims).toEqual([]);
});

for (const [count, expectedCount] of [
	["3", 3],
	["three", 3],
	["5", 5],
	["five", 5],
] as const) {
	test(`counted assurance cannot contradict native checks with ${count}`, () => {
		const claim = `Assurance: completion supported, with all ${count} checks satisfied.`;
		expect(currentHandoffFacts(claim).assuranceCheckClaims).toEqual([
			{
				count: expectedCount,
				status: "satisfied",
			},
		]);
		expect(
			deliveryIssues({ ...fixture(), finalText: answer(claim) }, expectation),
		).toContain(
			"Assurance check qualifier contradicts the native check records.",
		);
	});
}

for (const value of [
	"completion unsupported, with all 4 checks satisfied",
	"completion unsupported by all four checks",
	"completion not claimed by all 4 checks",
	"completion supported, with not all 4 checks satisfied",
	"completion supported by not all four checks",
	"completion not claimed, with all four checks satisfied",
	"completion not supported, with all 4 checks satisfied",
	"completion supported, with all 4 checks not satisfied",
	"completion supported, with all unknown checks satisfied",
	"completion supported, with all 4 checks satisfied and deployed",
	"completion supported by all 4 checks and deployed",
	"completion supported, with all 4 checks satisfied but completion unsupported",
]) {
	test(`full assurance clause rejects ${value}`, () => {
		const claim = `Assurance: ${value}.`;
		expect(currentHandoffFacts(claim).assurance).toEqual([null]);
		expect(
			deliveryIssues(
				{ ...fixture(), finalText: `${answer(canonicalClaim)}\n${claim}` },
				expectation,
			),
		).toContain(
			"Native assurance conclusion was omitted, misstated, or contradicted.",
		);
	});
}

test("missing current assurance and historical assurance cannot establish current facts", () => {
	const missing = answer("");
	expect(
		deliveryIssues({ ...fixture(), finalText: missing }, expectation),
	).toContain(
		"Native assurance conclusion was omitted, misstated, or contradicted.",
	);
	const historical = `## Historical handoff\n${originalClaim}\n## Current handoff\n${missing}`;
	expect(currentHandoffFacts(historical).assurance).toEqual([]);
	expect(
		deliveryIssues({ ...fixture(), finalText: historical }, expectation),
	).toContain(
		"Native assurance conclusion was omitted, misstated, or contradicted.",
	);
});

test("assurance-like quoted goal and registered command arguments remain in their own scope", () => {
	const goal =
		'Preserve "Assurance: completion supported, with all 4 checks satisfied" as a label.';
	const facts = currentHandoffFacts(`Goal: ${goal}`);
	expect(facts.goal).toEqual([goal]);
	expect(facts.assurance).toEqual([]);
	expect(facts.assuranceCheckClaims).toEqual([]);
	const command =
		'node scripts/verify.mjs --label "Assurance: completion supported, with all four checks satisfied"';
	const commandFacts = currentHandoffFacts(
		`${command} passed with exit code 0.`,
		[command],
	);
	expect(commandFacts.observations).toEqual([
		{
			command,
			exitCode: 0,
			integrity: "not-claimed",
			qualification: "claimed-pass",
		},
	]);
	expect(commandFacts.assurance).toEqual([]);
	expect(commandFacts.assuranceCheckClaims).toEqual([]);
});
