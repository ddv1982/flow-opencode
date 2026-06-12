import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { FLOW_STATUS_COMMAND } from "../src/runtime/constants";
import { createSession, saveSession } from "../src/runtime/lifecycle";
import { getIndexDocPath } from "../src/runtime/paths";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	resetFeature,
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

describe("runtime reviewer decision and reset tools", () => {
	test("explicit strict review requires a recorded reviewer approval before successful completion", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			deliveryPolicy: { strictReview: true as const },
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

		const completed = completeRun(started.value.session, {
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
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe(
			"missing_feature_reviewer_decision",
		);
		expect(completed.recovery?.prerequisite).toBe("reviewer_result_required");
	});

	test("explicit strict final completion requires a separately recorded final reviewer approval", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Ship a tiny fix");
		const liteFeature = samplePlan().features[0];
		if (!liteFeature) {
			throw new Error("Missing lite feature fixture.");
		}
		const plan = {
			...samplePlan(),
			deliveryPolicy: { strictReview: true as const },
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
		await saveSession(worktree, started.value.session);

		const response = await tools.flow_feature_complete.execute(
			{
				contractVersion: "1",
				status: "ok",
				summary: "Completed tiny fix.",
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tiny fix tests passed.",
					},
				],
				validationScope: "broad",
				reviewIterations: 1,
				decisions: [],
				nextStep: "Session should complete.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: liteFeature.id,
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
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
					status: "passed",
					summary: "Final review looks good.",
					blockingFindings: [],
				},
			},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("error");
		expect(parsed.recovery.errorCode).toBe("missing_final_reviewer_decision");
		expect(parsed.recovery.recoveryStage).toBe("record_review");
		expect(parsed.recovery.prerequisite).toBe("reviewer_result_required");
		expect(parsed.recovery.requiredArtifact).toBe("final_reviewer_decision");
		expect(parsed.recovery.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(parsed.recovery.nextRuntimeTool).toBeUndefined();
	});

	test("records reviewer decisions for the active feature", () => {
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
			status: "needs_fix",
			summary: "A follow-up fix is required.",
			blockingFindings: [{ summary: "Adjust one failing branch." }],
			suggestedValidation: ["bun test"],
		});

		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		expect(reviewed.value.execution.lastReviewerDecision?.status).toBe(
			"needs_fix",
		);
		expect(reviewed.value.execution.lastReviewerDecision?.scope).toBe(
			"feature",
		);
		if (reviewed.value.execution.lastReviewerDecision?.scope !== "feature") {
			throw new Error(
				"Expected feature-scoped reviewer decision in test setup.",
			);
		}
		expect(reviewed.value.execution.lastReviewerDecision.featureId).toBe(
			"setup-runtime",
		);
	});

	test("resets a feature back to pending", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const resetPlan = approved.value.plan;
		const resetFeatureEntry = resetPlan?.features[0];
		if (!resetPlan || !resetFeatureEntry) {
			throw new Error("Expected approved plan with first feature");
		}
		resetFeatureEntry.status = "completed";
		const reset = resetFeature(approved.value, "setup-runtime");
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;

		expect(reset.value.plan?.features[0]?.status).toBe("pending");

		await saveSession(worktree, reset.value);
		const sessionId = await activeSessionId(worktree);
		await expect(
			readFile(getIndexDocPath(worktree, sessionId), "utf8"),
		).resolves.toContain("# Flow Session");
	});

	test("resetting a prerequisite also resets dependent features", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const dependentPlan = approved.value.plan;
		const prerequisite = dependentPlan?.features[0];
		const dependent = dependentPlan?.features[1];
		if (!dependentPlan || !prerequisite || !dependent) {
			throw new Error("Expected approved plan with dependent features");
		}
		prerequisite.status = "completed";
		dependent.status = "completed";

		const reset = resetFeature(approved.value, "setup-runtime");
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;

		expect(reset.value.plan?.features[0]?.status).toBe("pending");
		expect(reset.value.plan?.features[1]?.status).toBe("pending");
		expect(reset.value.artifacts).toHaveLength(0);
		expect(reset.value.notes).toHaveLength(0);
		expect(reset.value.execution.lastValidationRun).toHaveLength(0);
	});

	test("resetting an unrelated feature preserves the last run projections", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, {
			...samplePlan(),
			features: [
				...samplePlan().features,
				{
					id: "write-docs",
					title: "Write docs",
					summary: "Document the workflow.",
					fileTargets: ["README.md"],
					verification: ["bun test"],
				},
			],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const unrelatedPlan = approved.value.plan;
		const setupFeature = unrelatedPlan?.features[0];
		const implementFeature = unrelatedPlan?.features[1];
		const docsFeature = unrelatedPlan?.features[2];
		if (!unrelatedPlan || !setupFeature || !implementFeature || !docsFeature) {
			throw new Error("Expected approved plan with three features");
		}
		setupFeature.status = "completed";
		implementFeature.status = "completed";
		docsFeature.status = "completed";
		approved.value.execution.lastFeatureId = "write-docs";
		approved.value.execution.lastValidationRun = [
			{ command: "bun test", status: "passed", summary: "Still valid." },
		];
		approved.value.artifacts = [{ path: "README.md" }];
		approved.value.notes = ["Docs feature completed cleanly."];

		const reset = resetFeature(approved.value, "setup-runtime");
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;

		expect(reset.value.execution.lastFeatureId).toBe("write-docs");
		expect(reset.value.execution.lastValidationRun).toHaveLength(1);
		expect(reset.value.artifacts).toHaveLength(1);
		expect(reset.value.notes).toHaveLength(1);
	});
});
