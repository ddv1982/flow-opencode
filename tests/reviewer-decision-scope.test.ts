import { describe, expect, test } from "bun:test";
import { createSession } from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import { samplePlan } from "./runtime-test-helpers";

function startedSession() {
	const applied = applyPlan(
		createSession("Build a workflow plugin"),
		samplePlan(),
	);
	expect(applied.ok).toBe(true);
	if (!applied.ok) throw new Error("applyPlan failed");

	const approved = approvePlan(applied.value);
	expect(approved.ok).toBe(true);
	if (!approved.ok) throw new Error("approvePlan failed");

	const started = startRun(approved.value);
	expect(started.ok).toBe(true);
	if (!started.ok) throw new Error("startRun failed");

	return started.value.session;
}

describe("recordReviewerDecision scope validation", () => {
	test("rejects final scope when featureId is provided", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "final",
			featureId: "setup-runtime",
			status: "approved",
			summary: "Final review looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("featureId");
		expect(result.message).toContain("must not include");
	});

	test.each([
		undefined,
		"",
		"   ",
	])("requires featureId for feature scope (%p)", (featureId) => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "feature",
			featureId,
			status: "approved",
			summary: "Looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("featureId");
	});

	test("infers execution_gate reviewPurpose for feature scope", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "feature",
			featureId: "setup-runtime",
			status: "approved",
			summary: "Looks good.",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.execution.lastReviewerDecision?.reviewPurpose).toBe(
			"execution_gate",
		);
	});

	test("rejects mismatched reviewPurpose for final scope", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "final",
			reviewPurpose: "execution_gate",
			status: "approved",
			summary: "Final review looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("reviewPurpose");
	});
});
