import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import { DELIVERY_SCENARIOS } from "../evals/delivery-scenarios.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import saved from "./fixtures/delivery-review-blockers-answer.json" with {
	type: "json",
};

const phrase = "Independent review passed with no blockers.";
const scenario = DELIVERY_SCENARIOS.find(
	(item) => item.id === "delivery-summary-observed-failure",
);
if (!scenario) throw new Error("Missing observed-failure scenario.");
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Missing fixture object.");
	return value as Record<string, unknown>;
}
function fixture(review = phrase) {
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
	return { ...input, finalText: saved.answer.replace(phrase, review) };
}
function run(input: ReturnType<typeof fixture>) {
	return object((object(input.archives[0]).runs as unknown[])[0]);
}
function delivery(input: ReturnType<typeof fixture>) {
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	return object(object(close?.output).workflowData)
		.delivery as typeof saved.delivery;
}

test("actual delivery with no blockers and an advisory retains truthful review", () => {
	expect(scenario.check(fixture())).toEqual([]);
});
for (const status of ["passed", "has passed", "was passed"]) {
	for (const zero of ["no", "none", "zero", "0"]) {
		for (const noun of [
			"blocker",
			"blockers",
			"blocking finding",
			"blocking findings",
		]) {
			const review = `Independent review ${status} with ${zero} ${noun}.`;
			test(`zero blocking claim permits advisory evidence ${review}`, () => {
				expect(scenario.check(fixture(review))).toEqual([]);
			});
			test(`zero blocking claim rejects live blocker ${review}`, () => {
				const input = fixture(review);
				const finding = delivery(input).findingsDigest[0];
				if (!finding) throw new Error("Missing finding.");
				finding.severity = "blocking";
				expect(scenario.check(input)).toContain(
					"Independent review claim contradicts accepted native review evidence.",
				);
			});
		}
	}
}
for (const noun of [
	"blocker",
	"blockers",
	"blocking finding",
	"blocking findings",
]) {
	for (const any of ["", "any "]) {
		const review = `Independent review passed without ${any}${noun}.`;
		test(`implicit zero blocking scope permits advisory ${review}`, () => {
			expect(scenario.check(fixture(review))).toEqual([]);
		});
	}
}
for (const absence of [
	"with no",
	"with none",
	"with zero",
	"with 0",
	"without",
	"without any",
]) {
	for (const noun of ["finding", "findings"]) {
		const review = `Independent review passed ${absence} ${noun}.`;
		test(`all findings absence contradicts current advisory ${review}`, () => {
			expect(currentHandoffFacts(review).independentReview).toEqual([
				{ kind: "passed", findings: "none" },
			]);
			expect(scenario.check(fixture(review))).toContain(
				"Independent review claim contradicts accepted native review evidence.",
			);
			const input = fixture(review);
			delivery(input).findingsDigest = [];
			expect(scenario.check(input)).not.toContain(
				"Independent review claim contradicts accepted native review evidence.",
			);
		});
	}
}
for (const change of [
	"missing-review",
	"failed-review",
	"access",
	"source",
	"incomplete",
	"observe",
	"unlinked",
]) {
	test(`parsed no blockers cannot manufacture ${change} evidence`, () => {
		const input = fixture();
		const native = run(input);
		const accepted = object((native.reviews as unknown[])[0]);
		const validation = (native.validations as unknown[])
			.map(object)
			.find((value) => value.command === "node scripts/verify.mjs");
		if (!validation) throw new Error("Missing validation.");
		if (change === "missing-review") native.reviews = [];
		if (change === "failed-review") object(accepted.result).verdict = "failed";
		if (change === "access") input.packetBytes = [];
		if (change === "source")
			validation.sourceDigest = `sha256:${"b".repeat(64)}`;
		if (change === "incomplete") validation.outputComplete = false;
		if (change === "observe") validation.intent = "observe";
		if (change === "unlinked") accepted.validationIds = [];
		expect(scenario.check(input)).not.toEqual([]);
	});
}
for (const tail of [
	" and deployed",
	" with release clearance",
	" from unavailable source",
	" and no advisory findings",
	" despite one blocker",
	" reported",
	" remaining",
	" and external action authority granted",
	" or no findings",
]) {
	test(`zero review noun owns and rejects unknown tail ${tail}`, () => {
		expect(scenario.check(fixture(phrase.replace(".", `${tail}.`)))).toContain(
			"Unsupported or conflicting current handoff assertions.",
		);
	});
}
for (const qualifier of [
	"with one blocker",
	"with no unfinished features",
	"with no blocked features",
	"with no blocked",
	"with no advisory findings",
	"with no issues",
	"without 0 blockers",
	"with no blockers or findings",
	"and no blockers",
]) {
	test(`review scope rejects unsupported qualifier ${qualifier}`, () => {
		expect(
			scenario.check(fixture(`Independent review passed ${qualifier}.`)),
		).toContain("Unsupported or conflicting current handoff assertions.");
	});
}
for (const prefix of ["Goal: ", "Historical handoff\n", "Example: "]) {
	test(`zero review phrase remains outside current ownership ${prefix}`, () => {
		expect(currentHandoffFacts(prefix + phrase).independentReview).toEqual([]);
	});
}
test("zero blocking review works as command sibling without swallowing changed script", () => {
	const input = fixture();
	input.finalText = input.finalText.replace(
		"passed.\n- Independent review",
		"passed, and independent review",
	);
	expect(scenario.check(input)).toEqual([]);
	input.finalText = input.finalText.replace(
		"with no blockers.",
		"with no blockers. Its script changed.",
	);
	expect(scenario.check(input)).toContain(
		"Unsupported or conflicting current handoff assertions.",
	);
});
for (const [text, counts] of [
	[
		"no unfinished features or blockers",
		[
			{ kind: "unfinished", count: 0 },
			{ kind: "blocking", count: 0 },
		],
	],
	[
		"none advisory findings and unfinished features",
		[
			{ kind: "advisory", count: 0 },
			{ kind: "unfinished", count: 0 },
		],
	],
	["1 advisory findings", [{ kind: "advisory", count: 1 }]],
	["2 blocked features", [{ kind: "blocked-feature", count: 2 }]],
	["two unfinished features or blockers", []],
	["no blocked", []],
	["no findings", []],
] as const) {
	test(`literal auxiliary migration control ${text}`, () => {
		expect(currentHandoffFacts(text + ".").auxiliaryCounts).toEqual([
			...counts,
		]);
	});
}
for (const zero of ["no", "none"]) {
	test(`counted zero alias does not broaden assurance grammar ${zero}`, () => {
		expect(
			currentHandoffFacts(
				`Assurance: completion supported, with all ${zero} checks satisfied.`,
			).assurance,
		).toEqual([null]);
		expect(
			currentHandoffFacts(`Progress: ${zero} of 1 features complete.`).progress,
		).toEqual([null]);
	});
}
test("feature zero blocked shorthand keeps feature context", () => {
	expect(
		currentHandoffFacts("Progress: 1 of 1 features complete, no blocked.")
			.auxiliaryCounts,
	).toEqual([{ kind: "blocked-feature", count: 0 }]);
	expect(
		currentHandoffFacts("Progress: 1 of 1 features complete, one blocked.")
			.progress,
	).toEqual([null]);
});
