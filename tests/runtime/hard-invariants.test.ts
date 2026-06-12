// Acceptance coverage for the four runtime-enforced hard invariants the
// skills document (skills/flow/SKILL.md, "Hard invariants"):
//   1. A feature cannot complete without recorded validation evidence.
//   2. A session cannot reach completion while features are unfinished.
//   3. An approved plan cannot be mutated without an explicit reset.
//   4. Under a strict review policy, completion requires a recorded reviewer
//      decision.
import { afterEach, describe, expect, test } from "bun:test";
import { createSession, saveSession } from "../../src/runtime/lifecycle";
import type { Session, WorkerResult } from "../../src/runtime/schema";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	selectPlanFeatures,
	startRun,
} from "../../src/runtime/transitions";
import type { TransitionResult } from "../../src/runtime/transitions/shared";
import { cloneSamplePlan } from "../fixtures";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	toolContext,
} from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-hard-invariants-",
);

afterEach(() => {
	cleanupTempDirs();
});

function assertOk<T>(result: TransitionResult<T>): T {
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.value;
}

function createRunningSession(
	plan: Parameters<typeof applyPlan>[1] = cloneSamplePlan(),
	goal = "Hard invariant fixture",
): Session {
	const applied = assertOk(applyPlan(createSession(goal), plan));
	const approved = assertOk(approvePlan(applied));
	return assertOk(startRun(approved)).session;
}

function passingWorkerResult(featureId: string): WorkerResult {
	return {
		contractVersion: "1",
		status: "ok",
		summary: "Completed the feature with full evidence.",
		artifactsChanged: [{ path: "src/runtime/session.ts" }],
		validationRun: [
			{
				command: "bun test",
				status: "passed",
				summary: "Targeted tests passed.",
			},
		],
		validationScope: "targeted",
		decisions: [],
		nextStep: "Run the next feature.",
		outcome: { kind: "completed" },
		featureResult: { featureId, verificationStatus: "passed" },
		featureReview: {
			status: "passed",
			summary: "Feature review passed.",
			blockingFindings: [],
		},
	};
}

describe("runtime hard invariants", () => {
	test("invariant 1: a feature cannot complete without recorded validation evidence", () => {
		const session = createRunningSession();
		const featureId = session.execution.activeFeatureId;
		if (!featureId) {
			throw new Error("Expected an active feature.");
		}

		const completed = completeRun(session, {
			...passingWorkerResult(featureId),
			validationRun: [],
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;
		expect(completed.message).toContain(
			"cannot complete the feature without recorded validation evidence",
		);
		expect(completed.recovery?.errorCode).toBe("missing_validation_evidence");
	});

	test("invariant 2: completing a feature below the completion target never closes the session", () => {
		const session = createRunningSession();
		const featureId = session.execution.activeFeatureId;
		if (!featureId) {
			throw new Error("Expected an active feature.");
		}

		const completed = completeRun(session, passingWorkerResult(featureId));
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		// One of two planned features is done: the session must stay open.
		expect(completed.value.status).not.toBe("completed");
		expect(completed.value.closure).toBeNull();
		expect(completed.value.timestamps.completedAt).toBeNull();
		expect(
			completed.value.plan?.features.filter(
				(feature) => feature.status === "pending",
			),
		).toHaveLength(1);
	});

	test("invariant 2: the runtime rejects closing a session as completed while features are unfinished", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createRunningSession();
		await saveSession(worktree, session);

		const blocked = JSON.parse(
			await tools.flow_session.execute(
				{ action: "close", kind: "completed" },
				toolContext(worktree),
			),
		);
		expect(blocked.status).toBe("error");
		expect(blocked.blocker).toBe("unfinished_features");
		expect(blocked.unfinishedFeatureIds).toEqual([
			"setup-runtime",
			"execute-feature",
		]);
		// The session must remain active and untouched.
		expect(await activeSessionId(worktree)).toBe(session.id);

		// Deferring the same unfinished session is still allowed.
		const deferred = JSON.parse(
			await tools.flow_session.execute(
				{ action: "close", kind: "deferred" },
				toolContext(worktree),
			),
		);
		expect(deferred.status).toBe("ok");
		expect(deferred.closureKind).toBe("deferred");
	});

	test("invariant 2: closing as completed succeeds once every planned feature is finished", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createRunningSession();
		if (!session.plan) {
			throw new Error("Expected a plan on the running session.");
		}
		const finished: Session = {
			...session,
			plan: {
				...session.plan,
				features: session.plan.features.map((feature) => ({
					...feature,
					status: "completed" as const,
				})),
			},
			execution: { ...session.execution, activeFeatureId: null },
		};
		await saveSession(worktree, finished);

		const closed = JSON.parse(
			await tools.flow_session.execute(
				{ action: "close", kind: "completed" },
				toolContext(worktree),
			),
		);
		expect(closed.status).toBe("ok");
		expect(closed.closureKind).toBe("completed");
	});

	test("invariant 3: an approved plan cannot be mutated without an explicit reset", () => {
		const approved = assertOk(
			approvePlan(
				assertOk(
					applyPlan(createSession("Approved plan guard"), cloneSamplePlan()),
				),
			),
		);

		// Narrowing the approved feature set is rejected.
		const reapprovedSubset = approvePlan(approved, ["setup-runtime"]);
		expect(reapprovedSubset.ok).toBe(false);
		if (!reapprovedSubset.ok) {
			expect(reapprovedSubset.message).toContain(
				"feature selection cannot be changed during approval",
			);
		}

		// Draft-plan edits are rejected once the plan left the planning state.
		const narrowed = selectPlanFeatures(approved, ["setup-runtime"]);
		expect(narrowed.ok).toBe(false);
		if (!narrowed.ok) {
			expect(narrowed.message).toContain(
				"Narrow the plan only while it is still a draft",
			);
		}

		// The same holds while a feature is executing.
		const running = assertOk(startRun(approved)).session;
		const editedWhileRunning = selectPlanFeatures(running, ["setup-runtime"]);
		expect(editedWhileRunning.ok).toBe(false);
	});

	test("invariant 4: strict review policy requires a recorded reviewer decision before completion", () => {
		const strictPlan = {
			...cloneSamplePlan(),
			deliveryPolicy: { strictReview: true as const },
		};
		const session = createRunningSession(strictPlan);
		const featureId = session.execution.activeFeatureId;
		if (!featureId) {
			throw new Error("Expected an active feature.");
		}

		const withoutDecision = completeRun(
			session,
			passingWorkerResult(featureId),
		);
		expect(withoutDecision.ok).toBe(false);
		if (!withoutDecision.ok) {
			expect(withoutDecision.message).toContain(
				"recorded approved reviewer decision",
			);
			expect(withoutDecision.recovery?.errorCode).toBe(
				"missing_feature_reviewer_decision",
			);
		}

		const reviewed = assertOk(
			recordReviewerDecision(session, {
				scope: "feature",
				featureId,
				status: "approved",
				summary: "Reviewed and approved.",
			}),
		);
		const withDecision = completeRun(reviewed, passingWorkerResult(featureId));
		expect(withDecision.ok).toBe(true);
	});
});
