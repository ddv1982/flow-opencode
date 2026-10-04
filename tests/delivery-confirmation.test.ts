import { expect, test } from "bun:test";
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
	data.delivery = { report: saved.report, assurance: saved.assurance };
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
