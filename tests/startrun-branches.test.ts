import { expect, test } from "bun:test";
import { createSession } from "../src/runtime/session";
import { applyPlan, approvePlan, startRun } from "../src/runtime/transitions";

import { cloneSamplePlan } from "./fixtures";

test("startRun fails when the session is already completed", () => {
	const completedSession = {
		...createSession("Build a workflow plugin"),
		status: "completed" as const,
	};

	const started = startRun(completedSession);
	expect(started.ok).toBe(false);
	if (started.ok) return;

	expect(
		started.message.startsWith("This Flow session is already completed"),
	).toBe(true);
	expect(completedSession.status).toBe("completed");
});

test("startRun marks the session completed when every feature is already complete", () => {
	const session = createSession("Build a workflow plugin");
	const applied = applyPlan(session, cloneSamplePlan());
	expect(applied.ok).toBe(true);
	if (!applied.ok) return;

	const approved = approvePlan(applied.value);
	expect(approved.ok).toBe(true);
	if (!approved.ok) return;

	const allCompleted = {
		...approved.value,
		plan: approved.value.plan
			? {
					...approved.value.plan,
					features: approved.value.plan.features.map((feature) => ({
						...feature,
						status: "completed" as const,
					})),
				}
			: null,
	};

	const started = startRun(allCompleted);
	expect(started.ok).toBe(true);
	if (!started.ok) return;

	expect(started.value.feature).toBeNull();
	expect(started.value.reason).toBe("complete");
	expect(started.value.session.status).toBe("completed");
	expect(started.value.session.execution.activeFeatureId).toBeNull();
	expect(started.value.session.execution.lastSummary).toBe(
		"All planned features are complete.",
	);
});

test("startRun blocks the session when dependencies prevent every pending feature from running", () => {
	const session = createSession("Build a workflow plugin");
	const plan = {
		...cloneSamplePlan(),
		features: [
			{
				id: "blocked-alpha",
				title: "Blocked by review",
				summary: "Waiting on another feature to complete first.",
				fileTargets: ["src/runtime/session.ts"],
				verification: ["bun test"],
				dependsOn: ["blocked-beta"],
				status: "pending" as const,
			},
			{
				id: "blocked-beta",
				title: "Blocked by dependency",
				summary: "Also waiting on another feature.",
				fileTargets: ["src/tools.ts"],
				verification: ["bun test"],
				dependsOn: ["blocked-alpha"],
				status: "pending" as const,
			},
		],
	};
	const approved = {
		...session,
		approval: "approved" as const,
		status: "ready" as const,
		plan,
	};

	const started = startRun(approved);
	expect(started.ok).toBe(true);
	if (!started.ok) return;

	expect(started.value.feature).toBeNull();
	expect(started.value.session.status).toBe("blocked");
	expect(started.value.session.execution.activeFeatureId).toBeNull();
	expect(started.value.session.execution.lastOutcomeKind).toBe("blocked");
	expect(started.value.reason).toBe(
		"No runnable feature is available in the approved plan.",
	);
});

test("startRun fails for an unknown requested feature id without blocking the session", () => {
	const session = createSession("Build a workflow plugin");
	const applied = applyPlan(session, cloneSamplePlan());
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
	expect(approved.value.execution.activeFeatureId).toBeNull();
});
