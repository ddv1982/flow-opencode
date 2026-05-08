import { describe, expect, test } from "bun:test";
import { createSession } from "../src/runtime/session";
import { summarizeSession } from "../src/runtime/summary";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	selectPlanFeatures,
	startRun,
} from "../src/runtime/transitions";
import { samplePlan } from "./runtime-test-helpers";

describe("runtime transitions", () => {
	test("applies and approves a plan", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		expect(approved.value.approval).toBe("approved");
		expect(approved.value.status).toBe("ready");
	});

	test("selects a dependency-consistent subset of features", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const selected = selectPlanFeatures(applied.value, ["setup-runtime"]);
		expect(selected.ok).toBe(true);
		if (!selected.ok) return;

		expect(selected.value.plan?.features).toHaveLength(1);
		expect(selected.value.plan?.features[0]?.id).toBe("setup-runtime");
	});

	test("selectPlanFeatures preserves completed statuses while narrowing draft plans", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const draftWithCompleted = {
			...applied.value,
			plan: applied.value.plan
				? {
						...applied.value.plan,
						features: applied.value.plan.features.map((feature) =>
							feature.id === "setup-runtime"
								? { ...feature, status: "completed" as const }
								: feature,
						),
					}
				: null,
		};

		const selected = selectPlanFeatures(draftWithCompleted, ["setup-runtime"]);
		expect(selected.ok).toBe(true);
		if (!selected.ok) return;

		expect(selected.value.plan?.features).toHaveLength(1);
		expect(selected.value.plan?.features[0]?.id).toBe("setup-runtime");
		expect(selected.value.plan?.features[0]?.status).toBe("completed");
	});

	test("approvePlan resets selected features to pending", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const draftWithCompleted = {
			...applied.value,
			plan: applied.value.plan
				? {
						...applied.value.plan,
						features: applied.value.plan.features.map((feature) =>
							feature.id === "setup-runtime"
								? { ...feature, status: "completed" as const }
								: feature,
						),
					}
				: null,
		};

		const approved = approvePlan(draftWithCompleted, ["setup-runtime"]);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		expect(approved.value.plan?.features).toHaveLength(1);
		expect(approved.value.plan?.features[0]?.id).toBe("setup-runtime");
		expect(approved.value.plan?.features[0]?.status).toBe("pending");
	});

	test("rejects mixed valid and invalid requested feature ids", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const selected = selectPlanFeatures(applied.value, [
			"setup-runtime",
			"missing-feature",
		]);
		expect(selected.ok).toBe(false);
		if (selected.ok) return;

		expect(selected.message).toContain("Unknown feature ids");
	});

	test("starts the next runnable feature", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		expect(started.value.feature?.id).toBe("setup-runtime");
		expect(started.value.session.status).toBe("running");
	});

	test("treats implicit run-start retry as a no-op while rejecting feature switches", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const retried = startRun(started.value.session);
		expect(retried.ok).toBe(true);
		if (!retried.ok) return;

		expect(retried.value.session).toBe(started.value.session);
		expect(retried.value.reason).toBe("already_active");
		expect(retried.value.feature?.id).toBe("setup-runtime");

		const switched = startRun(started.value.session, "execute-feature");
		expect(switched.ok).toBe(false);
		if (switched.ok) return;

		expect(switched.message).toContain("already in progress");
	});

	test("rejects plan approval after execution has started", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reapproved = approvePlan(started.value.session);
		expect(reapproved.ok).toBe(false);
		if (reapproved.ok) return;

		expect(reapproved.message).toContain("already executing work");
	});

	test("does not block the session on an invalid requested feature id", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value, "missing-feature");
		expect(started.ok).toBe(false);
		if (started.ok) return;

		expect(started.message).toContain("was not found");
		expect(approved.value.status).toBe("ready");
	});

	test("completes a feature and advances the session", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "feature",
			featureId: "setup-runtime",
			status: "approved",
			summary: "Looks correct.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [{ summary: "Kept a single session artifact." }],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks correct.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		expect(completed.value.status).toBe("ready");
		expect(completed.value.plan?.features[0]?.status).toBe("completed");
	});

	test("lite retryable non-human blockers return the session to ready without a manual reset", () => {
		const session = createSession("Ship a tiny fix");
		const liteFeature = samplePlan().features[0];
		if (!liteFeature) {
			throw new Error("Missing lite feature fixture.");
		}
		const plan = {
			...samplePlan(),
			features: [liteFeature],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const retried = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "A tiny retryable issue was found.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "The tiny fix needs one more pass." }],
			nextStep: "Retry the tiny fix.",
			outcome: {
				kind: "blocked_external",
				summary: "The tiny fix can be retried immediately.",
				retryable: true,
				autoResolvable: true,
				needsHuman: false,
			},
			featureResult: {
				featureId: liteFeature.id,
				verificationStatus: "not_recorded",
			},
			featureReview: {
				status: "needs_followup",
				summary: "Retry with a smaller adjustment.",
				blockingFindings: [],
			},
		});

		expect(retried.ok).toBe(true);
		if (!retried.ok) return;

		expect(retried.value.status).toBe("ready");
		expect(retried.value.execution.activeFeatureId).toBeNull();
		expect(retried.value.plan?.features[0]?.status).toBe("pending");
		expect(summarizeSession(retried.value).session?.nextCommand).toBe(
			"/flow-run",
		);
	});
});
