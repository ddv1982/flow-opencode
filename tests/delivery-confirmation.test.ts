import { expect, test } from "bun:test";
import { currentHandoffFacts } from "../evals/delivery-presentation.js";
import {
	type DeliveryExpectation,
	deliveryIssues,
} from "../evals/delivery-scenario-checks.js";
import { checkReviewerEvidenceAccess } from "../evals/reviewer-access.js";
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";
import confirmation from "./fixtures/delivery-confirmation-answers.json" with {
	type: "json",
};

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Expected native fixture object.");
	return value as Record<string, unknown>;
}

function confirmationFixture(id: keyof typeof confirmation.cases) {
	const saved = confirmation.cases[id];
	const deferred = id === "delivery-summary-deferred";
	const audit = id === "delivery-summary-observed-failure";
	const input = autoQualifiedOutcome(audit ? "audit" : "single", {
		goal: saved.goal,
		featureId: saved.featureId,
	});
	const archive = object(input.archives[0]);
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (!close) throw new Error("Missing native fixture close.");
	const data = object(object(close.output).workflowData);
	if (deferred) {
		object(archive.closure).kind = "deferred";
		object(close.input.request).kind = "deferred";
		const plan = object(archive.plan);
		const evidence = plan.evidence;
		if (!Array.isArray(evidence))
			throw new Error("Missing native fixture evidence.");
		evidence.push({
			scope: "extra",
			command: "node scripts/platform-check.mjs",
			platform: "darwin",
		});
		const runs = archive.runs;
		if (!Array.isArray(runs)) throw new Error("Missing native fixture runs.");
		for (const run of runs) {
			object(run).state = "running";
			object(run).reviews = [];
		}
	}
	object(data.operation).entity = archive.closure;
	data.delivery = structuredClone({
		report: saved.report,
		assurance: saved.assurance,
	});
	const expectation: DeliveryExpectation = {
		closure: deferred ? "deferred" : "completed",
		presentation: "summary",
		gate: "node scripts/verify.mjs",
		allowedPaths: ["src/parser.mjs"],
		...(audit
			? { observed: { command: "node scripts/audit.mjs", exitCode: 12 } }
			: {}),
		...(deferred
			? { missingEvidenceCommand: "node scripts/platform-check.mjs" }
			: {}),
	};
	if (!deferred)
		expect(checkReviewerEvidenceAccess(input, input.archives[0])).toEqual([]);
	expect(
		deliveryIssues(
			{ ...input, finalText: saved.summary.join("\n") },
			expectation,
		),
	).toEqual([]);
	return { input, saved, expectation };
}

test("fresh completed handoff retains a real authority omission without rejecting its fraction", () => {
	const { input, saved, expectation } = confirmationFixture(
		"delivery-summary-completed",
	);
	expect(
		deliveryIssues({ ...input, finalText: saved.answer }, expectation),
	).toEqual([
		"External action authority was omitted, expanded, or contradicted.",
	]);
	expect(
		deliveryIssues(
			{
				...input,
				finalText: `${saved.answer}\nExternal action authority: not-granted`,
			},
			expectation,
		),
	).toEqual([]);
});

test("fresh deferred handoff honestly reports spaced authority and unavailable-proof cause", () => {
	const { input, saved, expectation } = confirmationFixture(
		"delivery-summary-deferred",
	);
	expect(
		deliveryIssues({ ...input, finalText: saved.answer }, expectation),
	).toEqual([]);
});

test("fresh audit handoff binds its exited value to the adjacent nonpass observation", () => {
	const { input, saved, expectation } = confirmationFixture(
		"delivery-summary-observed-failure",
	);
	expect(
		deliveryIssues({ ...input, finalText: saved.answer }, expectation),
	).toEqual([]);
});

test("Windows explanation maps to the native win32 platform without accepting undeclared proof", () => {
	expect(
		currentHandoffFacts(
			"Closure: deferred because Windows validation is unavailable.",
		).unavailableProofPlatforms,
	).toEqual(["win32"]);
	const { input, saved, expectation } = confirmationFixture(
		"delivery-summary-deferred",
	);
	expect(
		deliveryIssues(
			{
				...input,
				finalText: saved.answer.replace(
					"because macOS validation",
					"because Windows validation",
				),
			},
			expectation,
		),
	).not.toEqual([]);
});

test("malformed external passing record cannot discard its exit or unsupported tail", () => {
	const { input, saved, expectation } = confirmationFixture(
		"delivery-summary-deferred",
	);
	expect(
		deliveryIssues({ ...input, finalText: saved.answer }, expectation),
	).toEqual([]);
	const malformed = `${saved.answer}\nnode scripts/platform-check.mjs: exit 0; an unsupported trailing sentence.`;
	expect(
		deliveryIssues({ ...input, finalText: malformed }, expectation),
	).not.toEqual([]);
});

for (const [name, before, after] of [
	[
		"wrong assurance count",
		"all four assurance checks satisfied",
		"all three assurance checks satisfied",
	],
	[
		"compound assurance",
		"Completion is supported, with all four assurance checks satisfied",
		"Completion is supported, with all four assurance checks satisfied and completion is not claimed",
	],
	["wrong audit exit", "exited **12**", "exited **0**"],
	[
		"audit pass claim",
		"This observation does not claim a pass",
		"This observation passed",
	],
	[
		"changed observation command",
		"`node scripts/audit.mjs` exited",
		"`node scripts/verify.mjs` exited",
	],
] as const)
	test(`coherent confirmation facts reject ${name}`, () => {
		const { input, saved, expectation } = confirmationFixture(
			"delivery-summary-observed-failure",
		);
		expect(
			deliveryIssues({ ...input, finalText: saved.answer }, expectation),
		).toEqual([]);
		const changed = saved.answer.replace(before, after);
		expect(changed).not.toBe(saved.answer);
		expect(
			deliveryIssues({ ...input, finalText: changed }, expectation),
		).not.toEqual([]);
	});

test("check qualifier compares actual native check statuses", () => {
	const { input, saved, expectation } = confirmationFixture(
		"delivery-summary-observed-failure",
	);
	const close = input.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (!close) throw new Error("Missing native close.");
	const assurance = object(
		object(object(close.output).workflowData).delivery,
	).assurance;
	const checks = object(assurance).checks;
	if (!Array.isArray(checks) || !checks[0])
		throw new Error("Missing native checks.");
	object(checks[0]).status = "unsatisfied";
	expect(
		deliveryIssues({ ...input, finalText: saved.answer }, expectation),
	).not.toEqual([]);
});

test("observation cannot borrow a disclaimer or exit from another command or paragraph", () => {
	const { input, saved, expectation } = confirmationFixture(
		"delivery-summary-observed-failure",
	);
	const moved =
		saved.answer.replace(" This observation does not claim a pass.", "") +
		"\nnode scripts/verify.mjs: exit 12; this does not claim the command passed.";
	expect(
		deliveryIssues({ ...input, finalText: moved }, expectation),
	).not.toEqual([]);
	const split = saved.answer.replace(
		" This observation does not claim a pass.",
		"\n\nThis observation does not claim a pass.",
	);
	expect(
		deliveryIssues({ ...input, finalText: split }, expectation),
	).not.toEqual([]);
});

for (const claim of [
	"Progress: 0/1 features complete.",
	"External action authority: not ungranted.",
	"Closure: deferred because macOS validation is unavailable and completed.",
])
	test(`whole scalar confirmation rejects ${claim}`, () => {
		const { input, saved, expectation } = confirmationFixture(
			"delivery-summary-completed",
		);
		const corrected = `${saved.answer}\nExternal action authority: not-granted`;
		expect(
			deliveryIssues({ ...input, finalText: corrected }, expectation),
		).toEqual([]);
		expect(
			deliveryIssues(
				{ ...input, finalText: `${corrected}\n${claim}` },
				expectation,
			),
		).not.toEqual([]);
	});
