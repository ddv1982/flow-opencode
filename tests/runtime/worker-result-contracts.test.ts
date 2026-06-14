// Owns worker-result payload contract coverage previously grouped in
// tests/runtime-completion-contracts.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { createSession, saveSession } from "../../src/runtime/lifecycle";
import type { WorkerResult } from "../../src/runtime/schema";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../../src/runtime/transitions";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("runtime worker result contracts", () => {
	test("rejects replan_required outcomes without structured replan fields", async () => {
		const tools = createTestTools();
		const response = await tools.flow_feature_complete.execute(
			{
				contractVersion: "1",
				status: "needs_input",
				summary: "Need a new plan.",
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [],
				decisions: [],
				nextStep: "Replan the work.",
				outcome: {
					kind: "replan_required",
				},
				featureResult: {
					featureId: "setup-runtime",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking findings.",
					blockingFindings: [],
				},
			},
			toolContext(makeTempDir()),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("error");
		expect(String(parsed.summary)).toContain("replan_required outcomes");
	});

	test("rejects inconsistent ok status with replan outcome", () => {
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
			summary: "Looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const problematicOkPayload = {
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
			decisions: [],
			nextStep: "Create a refined plan.",
			outcome: {
				kind: "replan_required",
				replanReason: "plan_too_broad",
				failedAssumption:
					"The current feature was small enough to finish in one pass.",
				recommendedAdjustment: "Split the work into a smaller follow-up plan.",
				needsHuman: false,
			} as WorkerResult["outcome"],
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks correct.",
				blockingFindings: [],
			},
		} as unknown as WorkerResult;

		const completed = completeRun(reviewed.value, problematicOkPayload);

		expect(completed.ok).toBe(false);
		if (completed.ok) return;
		expect(completed.message).toContain("validation failed");
	});

	test("tool accepts the documented top-level worker payload", async () => {
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

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "feature",
			featureId: "setup-runtime",
			status: "approved",
			summary: "Looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		await saveSession(worktree, reviewed.value);
		const response = await tools.flow_feature_complete.execute(
			{
				contractVersion: "1",
				status: "ok",
				featureId: "setup-runtime",
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
				decisions: [],
				nextStep: "Run the next feature.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
				finalReview: undefined,
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.session.lastOutcomeKind).toBe("completed");
	});

	test("tool rejects conflicting top-level worker feature ids", async () => {
		const tools = createTestTools();
		const response = await tools.flow_feature_complete.execute(
			{
				contractVersion: "1",
				status: "ok",
				featureId: "other-feature",
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
				decisions: [],
				nextStep: "Run the next feature.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
			},
			toolContext(makeTempDir()),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("Tool argument validation failed");
		expect(parsed.summary).toContain("featureId");
		expect(parsed.summary).toContain("featureResult.featureId");
	});

	test("completeRun accepts the documented top-level worker payload directly", () => {
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
			summary: "Looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const payload = {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [
				{ command: "bun test", status: "passed", summary: "Tests passed." },
			],
			validationScope: "targeted",
			decisions: [{ summary: "Kept the runtime contract stable." }],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		} satisfies WorkerResult;

		const parsed = completeRun(reviewed.value, payload);

		expect(parsed.ok).toBe(true);
	});

	test("completeRun preserves optional worker-result fields without adapters", () => {
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
			summary: "Looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const payload = {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on operator input.",
			artifactsChanged: [{ path: "src/runtime/session.ts", kind: "source" }],
			validationRun: [
				{
					command: "bun test",
					status: "partial",
					summary: "One manual check remains.",
				},
			],
			validationScope: "broad",
			reviewIterations: 2,
			decisions: [{ summary: "Stopped before unsafe completion." }],
			nextStep: "Ask the operator to confirm migration timing.",
			outcome: {
				kind: "needs_operator_input",
				category: "release",
				summary: "Manual release approval required.",
				resolutionHint: "Confirm the rollout window.",
				retryable: true,
				autoResolvable: false,
				needsHuman: true,
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "partial",
				notes: [{ note: "Manual verification remains." }],
				followUps: [{ summary: "Confirm rollout timing", severity: "medium" }],
			},
			featureReview: {
				status: "needs_followup",
				summary: "Needs operator confirmation.",
				blockingFindings: [{ summary: "Release timing not approved." }],
			},
			finalReview: {
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				remainingGaps: [],
				status: "needs_followup",
				summary: "Final approval still pending.",
				blockingFindings: [{ summary: "Awaiting operator sign-off." }],
			},
		} as unknown as WorkerResult;

		const result = completeRun(reviewed.value, payload);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.execution.lastFeatureResult?.verificationStatus).toBe(
			"partial",
		);
		expect(
			result.value.execution.lastFeatureResult?.followUps?.[0]?.summary,
		).toBe("Confirm rollout timing");
		expect(result.value.execution.history.at(-1)?.finalReview?.status).toBe(
			"needs_followup",
		);
		expect(
			result.value.execution.history.at(-1)?.finalReview?.evidenceRefs,
		).toEqual({
			changedArtifacts: ["src/runtime/session.ts"],
			validationCommands: ["bun test"],
		});
	});
});
