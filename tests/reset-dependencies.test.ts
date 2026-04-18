import { describe, expect, test } from "bun:test";

import {
	applyPlan,
	approvePlan,
	resetFeature,
} from "../src/runtime/transitions";
import { createSampleSession } from "./fixtures";

function createLinearPlan(edgeType: "dependsOn" | "blockedBy") {
	return {
		summary: `Linear plan via ${edgeType}`,
		overview: "Three-step dependency chain.",
		requirements: ["Keep dependency order"],
		architectureDecisions: ["Reset should propagate transitively"],
		goalMode: "implementation" as const,
		decompositionPolicy: "atomic_feature" as const,
		features: [
			{
				id: "feature-a",
				title: "Feature A",
				summary: "First feature",
				fileTargets: ["src/a.ts"],
				verification: ["bun test"],
				status: "completed" as const,
			},
			{
				id: "feature-b",
				title: "Feature B",
				summary: "Second feature",
				fileTargets: ["src/b.ts"],
				verification: ["bun test"],
				status: "completed" as const,
				[edgeType]: ["feature-a"],
			},
			{
				id: "feature-c",
				title: "Feature C",
				summary: "Third feature",
				fileTargets: ["src/c.ts"],
				verification: ["bun test"],
				status: "completed" as const,
				[edgeType]: ["feature-b"],
			},
		],
	};
}

function createApprovedSession(edgeType: "dependsOn" | "blockedBy") {
	const applied = applyPlan(createSampleSession(), createLinearPlan(edgeType));
	expect(applied.ok).toBe(true);
	if (!applied.ok) {
		throw new Error("Expected plan application to succeed");
	}

	const approved = approvePlan(applied.value);
	expect(approved.ok).toBe(true);
	if (!approved.ok) {
		throw new Error("Expected plan approval to succeed");
	}

	return approved.value;
}

describe("resetFeature dependency propagation", () => {
	test.each([
		"dependsOn",
		"blockedBy",
	] as const)("transitively resets downstream features through %s edges", (edgeType) => {
		const session = createApprovedSession(edgeType);

		const reset = resetFeature(session, "feature-a");
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;

		expect(reset.value.plan?.features.map((feature) => feature.status)).toEqual(
			["pending", "pending", "pending"],
		);
	});

	test("clears activeFeatureId only when the active feature is affected", () => {
		const affectedSession = createApprovedSession("dependsOn");
		affectedSession.execution.activeFeatureId = "feature-b";

		const affectedReset = resetFeature(affectedSession, "feature-a");
		expect(affectedReset.ok).toBe(true);
		if (!affectedReset.ok) return;
		expect(affectedReset.value.execution.activeFeatureId).toBeNull();

		const unaffectedSession = createApprovedSession("dependsOn");
		unaffectedSession.plan?.features.push({
			id: "feature-d",
			title: "Feature D",
			summary: "Independent feature",
			fileTargets: ["src/d.ts"],
			verification: ["bun test"],
			status: "completed",
		});
		unaffectedSession.execution.activeFeatureId = "feature-d";

		const unaffectedReset = resetFeature(unaffectedSession, "feature-a");
		expect(unaffectedReset.ok).toBe(true);
		if (!unaffectedReset.ok) return;
		expect(unaffectedReset.value.execution.activeFeatureId).toBe("feature-d");
	});

	test("clears last-run projections only when lastFeatureId is affected", () => {
		const affectedSession = createApprovedSession("dependsOn");
		affectedSession.execution.lastFeatureId = "feature-c";
		affectedSession.execution.lastOutcome = {
			kind: "needs_operator_input",
			summary: "Need operator input",
			retryable: false,
			autoResolvable: false,
		};
		affectedSession.execution.lastValidationRun = [
			{ command: "bun test", status: "passed", summary: "All clear" },
		];
		affectedSession.execution.lastReviewerDecision = {
			scope: "feature",
			featureId: "feature-c",
			status: "approved",
			summary: "Looks good",
			blockingFindings: [],
			followUps: [],
			suggestedValidation: [],
		};
		affectedSession.artifacts = [{ path: "src/c.ts" }];
		affectedSession.notes = ["Keep projection details"];

		const affectedReset = resetFeature(affectedSession, "feature-a");
		expect(affectedReset.ok).toBe(true);
		if (!affectedReset.ok) return;
		expect(affectedReset.value.execution.lastFeatureId).toBeNull();
		expect(affectedReset.value.execution.lastOutcome).toBeNull();
		expect(affectedReset.value.execution.lastValidationRun).toEqual([]);
		expect(affectedReset.value.execution.lastReviewerDecision).toBeNull();
		expect(affectedReset.value.artifacts).toEqual([]);
		expect(affectedReset.value.notes).toEqual([]);

		const unaffectedSession = createApprovedSession("dependsOn");
		unaffectedSession.plan?.features.push({
			id: "feature-d",
			title: "Feature D",
			summary: "Independent feature",
			fileTargets: ["src/d.ts"],
			verification: ["bun test"],
			status: "completed",
		});
		unaffectedSession.execution.lastFeatureId = "feature-d";
		unaffectedSession.execution.lastOutcome = {
			kind: "needs_operator_input",
			summary: "Need operator input",
			retryable: false,
			autoResolvable: false,
		};
		unaffectedSession.execution.lastValidationRun = [
			{ command: "bun test", status: "passed", summary: "Still valid" },
		];
		unaffectedSession.execution.lastReviewerDecision = {
			scope: "feature",
			featureId: "feature-d",
			status: "approved",
			summary: "Looks good",
			blockingFindings: [],
			followUps: [],
			suggestedValidation: [],
		};
		unaffectedSession.artifacts = [{ path: "src/d.ts" }];
		unaffectedSession.notes = ["Independent evidence"];

		const unaffectedReset = resetFeature(unaffectedSession, "feature-a");
		expect(unaffectedReset.ok).toBe(true);
		if (!unaffectedReset.ok) return;
		expect(unaffectedReset.value.execution.lastFeatureId).toBe("feature-d");
		expect(unaffectedReset.value.execution.lastOutcome).toEqual({
			kind: "needs_operator_input",
			summary: "Need operator input",
			retryable: false,
			autoResolvable: false,
		});
		expect(unaffectedReset.value.execution.lastValidationRun).toEqual([
			{ command: "bun test", status: "passed", summary: "Still valid" },
		]);
		expect(unaffectedReset.value.execution.lastReviewerDecision).toEqual({
			scope: "feature",
			featureId: "feature-d",
			status: "approved",
			summary: "Looks good",
			blockingFindings: [],
			followUps: [],
			suggestedValidation: [],
		});
		expect(unaffectedReset.value.artifacts).toEqual([{ path: "src/d.ts" }]);
		expect(unaffectedReset.value.notes).toEqual(["Independent evidence"]);
	});

	test("uses singular vs plural reset summaries based on affected count", () => {
		const singularSession = createSampleSession();
		const singularApplied = applyPlan(singularSession, {
			summary: "Single feature plan",
			overview: "One feature only",
			requirements: ["Keep summary precise"],
			architectureDecisions: ["Use exact reset wording"],
			goalMode: "implementation",
			decompositionPolicy: "atomic_feature",
			features: [
				{
					id: "feature-a",
					title: "Feature A",
					summary: "Only feature",
					fileTargets: ["src/a.ts"],
					verification: ["bun test"],
					status: "completed",
				},
			],
		});
		expect(singularApplied.ok).toBe(true);
		if (!singularApplied.ok) return;
		const singularApproved = approvePlan(singularApplied.value);
		expect(singularApproved.ok).toBe(true);
		if (!singularApproved.ok) return;

		const singularReset = resetFeature(singularApproved.value, "feature-a");
		expect(singularReset.ok).toBe(true);
		if (!singularReset.ok) return;
		expect(singularReset.value.execution.lastSummary).toBe(
			"Reset feature 'feature-a' to pending.",
		);

		const pluralReset = resetFeature(
			createApprovedSession("dependsOn"),
			"feature-a",
		);
		expect(pluralReset.ok).toBe(true);
		if (!pluralReset.ok) return;
		expect(pluralReset.value.execution.lastSummary).toBe(
			"Reset feature 'feature-a' and its dependent features to pending.",
		);
	});

	test("derives status from approval after reset", () => {
		const approvedSession = createApprovedSession("dependsOn");
		const approvedReset = resetFeature(approvedSession, "feature-a");
		expect(approvedReset.ok).toBe(true);
		if (!approvedReset.ok) return;
		expect(approvedReset.value.status).toBe("ready");

		const planningSession = createApprovedSession("dependsOn");
		planningSession.approval = "pending";
		planningSession.status = "running";

		const planningReset = resetFeature(planningSession, "feature-a");
		expect(planningReset.ok).toBe(true);
		if (!planningReset.ok) return;
		expect(planningReset.value.status).toBe("planning");
	});
});
