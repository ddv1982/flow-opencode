import { afterEach, describe, expect, test } from "bun:test";
import { SessionSchema, type WorkerResult } from "../src/runtime/schema";
import { createSession, saveSession } from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

type ExecuteContext = Parameters<
	ReturnType<typeof createTestTools>["flow_status"]["execute"]
>[1];

function toolContext(worktree: string): ExecuteContext {
	return { worktree } as unknown as ExecuteContext;
}

afterEach(() => {
	cleanupTempDirs();
});

describe("runtime completion and contract guards", () => {
	test("rejects replan_required outcomes without structured replan fields", async () => {
		const tools = createTestTools();
		const response = await tools.flow_run_complete_feature.execute(
			{
				workerJson: JSON.stringify({
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
				}),
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

	test("final-path validation-scope failures return final recovery metadata before reviewer approval", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
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
			nextStep: "Session should complete.",
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

		expect(completed.recovery?.errorCode).toBe("missing_broad_validation");
		expect(completed.recovery?.recoveryStage).toBe("rerun_validation");
		expect(completed.recovery?.prerequisite).toBe("validation_rerun_required");
		expect(completed.recovery?.requiredArtifact).toBe(
			"broad_validation_result",
		);
		expect(completed.recovery?.nextCommand).toBe("/flow-status");
		expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
	});

	test("rejects malformed dependency graphs during plan apply", () => {
		const session = createSession("Build a workflow plugin");
		const invalidPlan = {
			...samplePlan(),
			features: [
				{
					id: "setup-runtime",
					title: "Create runtime helpers",
					summary: "Add runtime helper files and state persistence.",
					fileTargets: ["src/runtime/session.ts"],
					verification: ["bun test"],
					dependsOn: ["missing-feature"],
				},
			],
		};

		const applied = applyPlan(session, invalidPlan);
		expect(applied.ok).toBe(false);
		if (applied.ok) return;

		expect(applied.message).toContain("unknown feature");
	});

	test("rejects unsafe feature ids during plan apply", () => {
		const runtimeTools = createTestTools();

		return expect(
			runtimeTools.flow_plan_apply.execute(
				{
					planJson: JSON.stringify({
						plan: {
							...samplePlan(),
							features: [
								{
									id: "../escape",
									title: "Bad feature id",
									summary: "Should be rejected.",
									status: "pending",
									fileTargets: [],
									verification: [],
								},
							],
						},
					}),
				},
				toolContext(makeTempDir()),
			),
		).resolves.toContain("Feature ids must be lowercase kebab-case");
	});

	test("rejects successful worker results when review failed", () => {
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
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "failed",
				summary: "Blocking issues remain.",
				blockingFindings: [{ summary: "A blocking review issue remains." }],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.message).toContain("featureReview");
	});

	test("rejects successful worker results when validation does not fully pass", () => {
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
			scope: "final",
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
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
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
					status: "partial",
					summary: "Some checks remain unresolved.",
				},
			],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "partial",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.message).toContain("validation did not fully pass");
		expect(completed.recovery?.errorCode).toBe("failing_validation");
		expect(completed.recovery?.recoveryStage).toBe("reset_feature");
		expect(completed.recovery?.prerequisite).toBe("feature_reset_required");
		expect(completed.recovery?.nextCommand).toBe(
			"/flow-reset feature setup-runtime",
		);
		expect(completed.recovery?.nextRuntimeTool).toBe("flow_reset_feature");
		expect(completed.recovery?.nextRuntimeArgs).toEqual({
			featureId: "setup-runtime",
		});
	});

	test("uses reviewer-decision recovery before other final-path guard failures", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
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

		// Intentionally skip reviewer decision and use the wrong validation scope so
		// multiple guard checks could fail. Broad final validation should block
		// completion before reviewer approval is requested.
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
			nextStep: "Session should complete.",
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

		expect(completed.recovery?.errorCode).toBe("missing_broad_validation");
		expect(completed.recovery?.prerequisite).toBe("validation_rerun_required");
	});

	test("retains failure-path projections when completion guard rejects an ok result", () => {
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

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [
				{
					command: "bun test",
					status: "failed",
					summary: "Runtime tests failed.",
				},
			],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [{ summary: "Recorded failure evidence before retry." }],
			nextStep: "Fix failing test and retry.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "failed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe("failing_validation");
		expect(completed.session).toBeDefined();
		if (!completed.session) return;

		expect(completed.session.execution.lastValidationRun).toEqual([
			{
				command: "bun test",
				status: "failed",
				summary: "Runtime tests failed.",
			},
		]);
		expect(completed.session.execution.history).toHaveLength(1);
		expect(completed.session.execution.history[0]?.summary).toBe(
			"Completed runtime setup.",
		);
		expect(completed.session.execution.history[0]?.status).toBe("ok");
		expect(completed.session.execution.history[0]?.outcomeKind).toBe(
			"completed",
		);
		expect(completed.session.artifacts).toEqual([
			{ path: "src/runtime/session.ts" },
		]);
		expect(completed.session.notes).toEqual([
			"Recorded failure evidence before retry.",
		]);
		expect(completed.session.status).toBe("running");
		expect(completed.session.execution.activeFeatureId).toBe("setup-runtime");
	});

	test("allows final completion when broad validation and final review both pass", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
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

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
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
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
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
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
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
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Repo-wide validation is clean.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		expect(completed.value.status).toBe("completed");
	});

	test("defaults missing evidenceRefs when parsing persisted final review records", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
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

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
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
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
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
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
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
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Final review looks good.",
				blockingFindings: [],
			},
		});
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		const legacySession = JSON.parse(JSON.stringify(completed.value));
		legacySession.execution.lastReviewerDecision.evidenceRefs = undefined;
		legacySession.execution.history.at(-1).reviewerDecision.evidenceRefs =
			undefined;
		legacySession.execution.history.at(-1).finalReview.evidenceRefs = undefined;

		const parsed = SessionSchema.safeParse(legacySession);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.execution.lastReviewerDecision?.scope).toBe("final");
		if (parsed.data.execution.lastReviewerDecision?.scope === "final") {
			expect(parsed.data.execution.lastReviewerDecision.evidenceRefs).toEqual({
				changedArtifacts: [],
				validationCommands: [],
			});
		}
		expect(
			parsed.data.execution.history.at(-1)?.finalReview?.evidenceRefs,
		).toEqual({
			changedArtifacts: [],
			validationCommands: [],
		});
	});

	test("allows lite-lane final completion without a separately recorded reviewer decision", () => {
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

		const completed = completeRun(started.value.session, {
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
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Final review looks good.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		expect(completed.value.status).toBe("completed");
	});

	test("requires broad validation before final session completion", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
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

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
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
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
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
			decisions: [],
			nextStep: "Session should complete.",
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
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Feature review is clean.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.message).toContain("broad final validation");
	});

	test("does not allow a completed session to start more work", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
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

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
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
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
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
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
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
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "passed",
				summary: "Repo-wide validation is clean.",
				blockingFindings: [],
			},
		});
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		expect(completed.value.status).toBe("completed");

		const restarted = startRun(completed.value);
		expect(restarted.ok).toBe(false);
		if (restarted.ok) return;

		expect(restarted.message).toContain("already completed");
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
		const response = await tools.flow_run_complete_feature.execute(
			{
				workerJson: JSON.stringify({
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
					finalReview: undefined,
				}),
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.session.lastOutcomeKind).toBe("completed");
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
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "needs_followup",
				summary: "Final approval still pending.",
				blockingFindings: [{ summary: "Awaiting operator sign-off." }],
			},
		} satisfies WorkerResult;

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
	});

	test("recordReviewerDecision preserves optional reviewer payload fields without adapters", () => {
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

		const input = {
			scope: "feature",
			featureId: "setup-runtime",
			status: "needs_fix",
			summary: "Needs another pass.",
			blockingFindings: [{ summary: "Validation evidence is incomplete." }],
			followUps: [{ summary: "Rerun targeted tests", severity: "medium" }],
			suggestedValidation: ["bun test tests/runtime.test.ts"],
		};

		const result = recordReviewerDecision(started.value.session, input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.execution.lastReviewerDecision?.scope).toBe("feature");
		expect(result.value.execution.lastReviewerDecision?.status).toBe(
			"needs_fix",
		);
		expect(
			result.value.execution.lastReviewerDecision?.followUps[0]?.summary,
		).toBe("Rerun targeted tests");
	});

	test("reviewer decision tool accepts the top-level payload for final review", async () => {
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

		await saveSession(worktree, started.value.session);

		const response = await tools.flow_review_record_final.execute(
			{
				decisionJson: JSON.stringify({
					scope: "final",
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
					integrationChecks: [
						"Reviewed integration points across the active feature boundary.",
					],
					regressionChecks: [
						"Checked for regressions in shared surfaces and validation evidence.",
					],
					remainingGaps: [],
					status: "approved",
					summary: "Final state looks good.",
					blockingFindings: [],
					followUps: [],
					suggestedValidation: ["bun run check"],
				}),
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.session.lastReviewerDecision.scope).toBe("final");
		expect(parsed.session.lastReviewerDecision.suggestedValidation).toEqual([
			"bun run check",
		]);
	});

	test("reviewer decision tool rejects featureId on final review at parse time", async () => {
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

		await saveSession(worktree, started.value.session);

		const response = await tools.flow_review_record_final.execute(
			{
				scope: "final",
				featureId: "some-feature",
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
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "approved",
				summary: "Final state looks good.",
				blockingFindings: [],
				followUps: [],
				suggestedValidation: ["bun run check"],
			} as never,
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("featureId");
		expect(parsed.summary).not.toContain(
			"Final review decisions cannot target",
		);
	});

	test("tools keep representative top-level response shapes across the split helpers", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const planStartResponse = await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const planStartParsed = JSON.parse(planStartResponse);
		expect(Object.keys(planStartParsed)).toEqual([
			"status",
			"summary",
			"session",
		]);
		expect(planStartParsed.status).toBe("ok");
		expect(planStartParsed.session.goal).toBe("Build a workflow plugin");

		const planApplyResponse = await tools.flow_plan_apply.execute(
			{ planJson: JSON.stringify({ plan: samplePlan() }) },
			toolContext(worktree),
		);
		const planApplyParsed = JSON.parse(planApplyResponse);
		expect(Object.keys(planApplyParsed)).toEqual([
			"status",
			"summary",
			"autoApproved",
			"session",
		]);
		expect(planApplyParsed.status).toBe("ok");
		expect(planApplyParsed.summary).toBe("Draft plan saved.");
		expect(planApplyParsed.autoApproved).toBe(false);
		expect(planApplyParsed.session.goal).toBe("Build a workflow plugin");
	});
});
