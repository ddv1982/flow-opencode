import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { getFeatureDocPath, getIndexDocPath } from "../src/runtime/paths";
import {
	createSession,
	loadSession,
	saveSession,
} from "../src/runtime/session";
import { summarizeSession } from "../src/runtime/summary";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	selectPlanFeatures,
	startRun,
} from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

async function activeIndexDocPath(worktree: string): Promise<string> {
	return getIndexDocPath(worktree, await activeSessionId(worktree));
}

async function activeFeatureDocPath(
	worktree: string,
	featureId: string,
): Promise<string> {
	return getFeatureDocPath(
		worktree,
		await activeSessionId(worktree),
		featureId,
	);
}

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

	test("rejects starting a second run while one feature is active", () => {
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

		const restarted = startRun(started.value.session);
		expect(restarted.ok).toBe(false);
		if (restarted.ok) return;

		expect(restarted.message).toContain("already in progress");
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

	test("renders per-feature execution history and review evidence", async () => {
		const worktree = makeTempDir();
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
			artifactsChanged: [{ path: "src/runtime/session.ts", kind: "updated" }],
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

		await saveSession(worktree, completed.value);
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(featureDoc).toContain("## Execution History");
		expect(featureDoc).toContain("Completed runtime setup.");
		expect(featureDoc).toContain("#### Changed Artifacts");
		expect(featureDoc).toContain("src/runtime/session.ts (updated)");
		expect(featureDoc).toContain("#### Validation");
		expect(featureDoc).toContain("passed | bun test | Runtime tests passed.");
		expect(featureDoc).toContain("#### Feature Review");
		expect(featureDoc).toContain("Looks correct.");
	});

	test("preserves execution history when replanning the same session", async () => {
		const worktree = makeTempDir();
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

		await saveSession(worktree, completed.value);

		const replanned = applyPlan(completed.value, {
			...samplePlan(),
			summary: "Refined the workflow plan.",
			features: [
				...samplePlan().features,
				{
					id: "write-docs",
					title: "Write docs",
					summary: "Document the refined workflow.",
					fileTargets: ["README.md"],
					verification: ["bun test"],
				},
			],
		});
		expect(replanned.ok).toBe(true);
		if (!replanned.ok) return;

		await saveSession(worktree, replanned.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(replanned.value.execution.history).toHaveLength(1);
		expect(indexDoc).toContain("Completed runtime setup.");
		expect(featureDoc).toContain("## Execution History");
		expect(featureDoc).toContain("Completed runtime setup.");
	});

	test("clears execution history when starting a new goal", async () => {
		const worktree = makeTempDir();
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

		await saveSession(worktree, completed.value);

		const tools = createTestTools();
		const response = await tools.flow_plan_start.execute(
			{ goal: "Different goal" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const nextSession = await loadSession(worktree);

		expect(parsed.status).toBe("ok");
		expect(nextSession?.goal).toBe("Different goal");
		expect(nextSession?.execution.history).toHaveLength(0);

		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(indexDoc).not.toContain("Completed runtime setup.");
	});

	test("runtime tool transitions persist session state and refresh docs", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const before = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(before).toContain("summary: No plan yet.");

		await tools.flow_plan_apply.execute(
			{ planJson: JSON.stringify({ plan: samplePlan() }) },
			toolContext(worktree),
		);
		const afterApply = await readFile(
			await activeIndexDocPath(worktree),
			"utf8",
		);
		const session = await loadSession(worktree);
		expect(session?.plan?.summary).toBe(samplePlan().summary);
		expect(afterApply).toContain(
			"summary: Implement a small workflow feature set.",
		);
	});

	test("returns to planning when the worker requires replanning", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value, "execute-feature");
		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.message).toContain("not runnable");

		const firstStarted = startRun(approved.value);
		expect(firstStarted.ok).toBe(true);
		if (!firstStarted.ok) return;

		const replanned = completeRun(firstStarted.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "The feature needs to be split further.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "Feature is too broad after inspection." }],
			nextStep: "Create a refined plan.",
			outcome: {
				kind: "replan_required",
				needsHuman: false,
				replanReason: "plan_too_broad",
				failedAssumption:
					"The current feature was small enough to finish in one pass.",
				recommendedAdjustment: "Split the work into a smaller follow-up plan.",
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
			},
			featureReview: {
				status: "needs_followup",
				summary: "No code changed.",
				blockingFindings: [],
			},
		});

		expect(replanned.ok).toBe(true);
		if (!replanned.ok) return;

		expect(replanned.value.status).toBe("planning");
		expect(replanned.value.approval).toBe("pending");
		expect(replanned.value.plan).toBeNull();
		expect(summarizeSession(replanned.value).session?.nextCommand).toBe(
			"/flow-plan <goal>",
		);
	});

	test("renders replanned sessions with a new planning command", async () => {
		const worktree = makeTempDir();
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

		const replanned = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "The feature needs to be split further.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "Feature is too broad after inspection." }],
			nextStep: "Create a refined plan.",
			outcome: {
				kind: "replan_required",
				needsHuman: false,
				replanReason: "plan_too_broad",
				failedAssumption:
					"The current feature was small enough to finish in one pass.",
				recommendedAdjustment: "Split the work into a smaller follow-up plan.",
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
			},
			featureReview: {
				status: "needs_followup",
				summary: "No code changed.",
				blockingFindings: [],
			},
		});
		expect(replanned.ok).toBe(true);
		if (!replanned.ok) return;

		await saveSession(worktree, replanned.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(indexDoc).toContain("next command: /flow-plan <goal>");
	});

	test("persists and renders actionable needs_input metadata", async () => {
		const worktree = makeTempDir();
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

		const blocked = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on an operator decision.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "External API credentials are missing." }],
			nextStep: "Ask the operator to provide API credentials.",
			outcome: {
				kind: "needs_operator_input",
				summary: "Credentials are required before work can continue.",
				resolutionHint: "Set the API token and rerun the feature.",
				retryable: true,
				needsHuman: true,
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
				notes: [{ note: "No code changes were made." }],
				followUps: [
					{ summary: "Provide the missing API token.", severity: "high" },
				],
			},
			featureReview: {
				status: "needs_followup",
				summary: "Blocked by missing credentials.",
				blockingFindings: [],
			},
		});
		expect(blocked.ok).toBe(true);
		if (!blocked.ok) return;

		expect(blocked.value.execution.lastNextStep).toBe(
			"Ask the operator to provide API credentials.",
		);
		expect(blocked.value.execution.lastOutcome?.resolutionHint).toBe(
			"Set the API token and rerun the feature.",
		);
		expect(blocked.value.execution.lastFeatureResult?.notes?.[0]?.note).toBe(
			"No code changes were made.",
		);

		const summary = summarizeSession(blocked.value);
		expect(summary.session?.lastNextStep).toBe(
			"Ask the operator to provide API credentials.",
		);
		expect(summary.session?.lastOutcome?.kind).toBe("needs_operator_input");
		expect(summary.session?.nextCommand).toBe("/flow-status");

		await saveSession(worktree, blocked.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(indexDoc).toContain(
			"next step: Ask the operator to provide API credentials.",
		);
		expect(indexDoc).toContain(
			"resolution hint: Set the API token and rerun the feature.",
		);
		expect(featureDoc).toContain("#### Outcome");
		expect(featureDoc).toContain("needs human: yes");
		expect(featureDoc).toContain("#### Follow Ups");
		expect(featureDoc).toContain("Provide the missing API token. (high)");
	});

	test("same-goal planning refresh clears last actionable metadata", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
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

		const blocked = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on an operator decision.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "External API credentials are missing." }],
			nextStep: "Ask the operator to provide API credentials.",
			outcome: {
				kind: "needs_operator_input",
				summary: "Credentials are required before work can continue.",
				resolutionHint: "Set the API token and rerun the feature.",
				retryable: true,
				needsHuman: true,
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
				notes: [{ note: "No code changes were made." }],
				followUps: [
					{ summary: "Provide the missing API token.", severity: "high" },
				],
			},
			featureReview: {
				status: "needs_followup",
				summary: "Blocked by missing credentials.",
				blockingFindings: [],
			},
		});
		expect(blocked.ok).toBe(true);
		if (!blocked.ok) return;

		await saveSession(worktree, blocked.value);
		const response = await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const refreshed = await loadSession(worktree);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");

		expect(parsed.status).toBe("ok");
		expect(refreshed?.execution.lastOutcome).toEqual(
			blocked.value.execution.lastOutcome,
		);
		expect(refreshed?.execution.lastNextStep).toBe(
			blocked.value.execution.lastNextStep,
		);
		expect(refreshed?.execution.lastFeatureResult).toEqual(
			blocked.value.execution.lastFeatureResult,
		);
		expect(indexDoc).toContain(
			"resolution hint: Set the API token and rerun the feature.",
		);
		expect(indexDoc).toContain(
			"next step: Ask the operator to provide API credentials.",
		);
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
