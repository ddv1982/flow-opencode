import { afterEach, describe, expect, test } from "bun:test";
import { dispatchSessionMutationAction } from "../src/runtime/application/session-actions";
import {
	runSessionMutationActionAtRoot,
	type SessionMutationAction,
	type SessionRuntimePort,
} from "../src/runtime/application/session-engine";
import {
	createFeatureReviewerDecisionAction,
	createFinalReviewerDecisionAction,
} from "../src/runtime/application/session-review-actions";
import { FLOW_STATUS_COMMAND } from "../src/runtime/constants";
import {
	createSession,
	loadSession,
	saveSession,
} from "../src/runtime/session";
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
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("runtime completion and recovery tools", () => {
	test("tools return machine-readable missing-session responses for plan, review, and reset operations", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const cases = [
			[
				"flow_plan_apply",
				{ plan: samplePlan() },
				"missing_session",
				"/flow-plan <goal>",
			],
			["flow_plan_approve", {}, "missing_session", undefined],
			[
				"flow_plan_select_features",
				{ featureIds: ["setup-runtime"] },
				"missing_session",
				undefined,
			],
			[
				"flow_review_record_feature",
				{
					scope: "feature",
					featureId: "setup-runtime",
					status: "approved",
					summary: "Looks good.",
				},
				"missing_session",
				undefined,
			],
			[
				"flow_review_record_final",
				{
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
					summary: "Looks good.",
				},
				"missing_session",
				undefined,
			],
			[
				"flow_reset_feature",
				{ featureId: "setup-runtime" },
				"missing_session",
				undefined,
			],
		] as const;

		for (const [toolName, args, expectedStatus, expectedNextCommand] of cases) {
			const response = await (
				tools[toolName] as {
					execute: (
						args: unknown,
						context: Parameters<
							ReturnType<typeof createTestTools>["flow_status"]["execute"]
						>[1],
					) => Promise<string>;
				}
			).execute(args, toolContext(worktree));
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe(expectedStatus);
			expect(parsed.summary).toContain("No active Flow");
			if (expectedNextCommand) {
				expect(parsed.nextCommand).toBe(expectedNextCommand);
			}
		}
	});

	test("tool rejects flow_run_start for completed sessions", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
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

		await saveSession(worktree, completed.value);
		const response = await tools.flow_run_start.execute(
			{ featureId: undefined },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_session");
		expect(parsed.summary).toContain("No active Flow");
	});

	test("tool rejects nested worker payload shape", async () => {
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

		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				result: {
					status: "ok",
					summary: "Completed runtime setup.",
					artifactsChanged: [{ path: "src/runtime/session.ts" }],
					validationRun: [],
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
			} as never,
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("validation failed");
	});

	test("tool rejects non-ok worker payloads missing outcome at parse time", async () => {
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

		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				status: "needs_input",
				summary: "Need a new plan.",
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [],
				decisions: [],
				nextStep: "Replan the work.",
				outcome: undefined,
				featureResult: {
					featureId: "setup-runtime",
				},
				featureReview: {
					status: "passed",
					summary: "No review yet.",
					blockingFindings: [],
				},
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("Tool argument validation failed");
		expect(parsed.summary).toContain("outcome");
		expect(parsed.summary).not.toContain("Cannot read properties");
	});

	test("tool rejects malformed JSON-string worker transport fields", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const response = await tools.flow_run_complete_feature.execute(
			{ workerJson: '{"contractVersion":"1",' },
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("status");
	});

	test("tool rejects syntactically valid JSON-string worker transport fields", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const response = await tools.flow_run_complete_feature.execute(
			{
				workerJson:
					'{"contractVersion":"1","status":"ok","summary":"Bad payload.","artifactsChanged":[],"validationRun":[],"decisions":[],"nextStep":"Stop.","outcome":{"kind":"completed"},"featureResult":{"featureId":"setup-runtime"},"featureReview":{"status":"passed","summary":"Looks good.","blockingFindings":[]}}',
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("status");
	});

	test("tool returns machine-readable recovery details for missing final reviewer approval", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			deliveryPolicy: { strictReview: true },
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

		await saveSession(worktree, started.value.session);
		const response = await tools.flow_run_complete_feature.execute(
			{
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
				reviewScopeLedger: [
					{
						scopeId: "file_target:src/runtime/session.ts",
						status: "reviewed_no_findings",
						evidenceRefs: ["src/runtime/session.ts"],
						validationRefs: ["bun test"],
						residualRisk: "No known residual risk.",
					},
				],
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
		expect(parsed.recovery.retryable).toBe(true);
	});

	test("same-session success still persists without an explicit noop predicate", async () => {
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

		let currentSession = started.value.session;
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => currentSession,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				const saved = structuredClone(nextSession);
				currentSession = saved;
				return saved;
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};
		const action: SessionMutationAction<typeof currentSession> = {
			name: "identity_success",
			run: (loadedSession) => ({ ok: true, value: loadedSession }),
			getSession: (value) => value,
			onSuccess: () => ({ status: "ok", summary: "saved" }),
			onNoopSuccess: () => ({ status: "ok", summary: "noop" }),
		};

		const result = await runSessionMutationActionAtRoot(
			worktree,
			action,
			runtime,
		);

		expect(result.kind).toBe("success");
		expect(result.response.summary).toBe("saved");
		expect(saveCount).toBe(1);
		expect(syncCount).toBe(1);
	});

	test("no-op mutation with disabled artifact sync skips persistence and sync", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => session,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				return structuredClone(nextSession);
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};
		const action: SessionMutationAction<typeof session> = {
			name: "disabled_sync_noop",
			run: (loadedSession) => ({ ok: true, value: loadedSession }),
			getSession: (value) => value,
			onSuccess: () => ({ status: "ok", summary: "saved" }),
			isNoopSuccess: (value, originalSession) => value === originalSession,
			onNoopSuccess: () => ({ status: "ok", summary: "noop" }),
			syncArtifacts: false,
		};

		const result = await runSessionMutationActionAtRoot(
			worktree,
			action,
			runtime,
		);

		expect(result.kind).toBe("success");
		expect(result.response.summary).toBe("noop");
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(0);
	});

	test("plan approval action skips persistence for duplicate approval", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		let currentSession = approved.value;
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => currentSession,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				const saved = structuredClone(nextSession);
				currentSession = saved;
				return saved;
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};
		const savedAfterFirst = currentSession;

		const duplicate = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("approve_plan", { featureIds: [] }),
			runtime,
		);

		expect(duplicate.kind).toBe("success");
		expect(duplicate.response.summary).toBe(
			"Plan approval already recorded; no state change.",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(1);
		expect(currentSession).toBe(savedAfterFirst);
		if (duplicate.kind === "success") {
			expect(duplicate.savedSession).toBe(savedAfterFirst);
		}

		const changedSelection = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("approve_plan", {
				featureIds: ["execute-flow"],
			}),
			runtime,
		);

		expect(changedSelection.kind).toBe("failure");
		expect(changedSelection.response.summary).toContain(
			"feature selection cannot be changed",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(1);
	});

	test("plan approval action treats selected subset duplicates as narrowed-plan no-ops", async () => {
		const worktree = makeTempDir();
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			features: [
				...basePlan.features,
				{
					...basePlan.features[0],
					id: "document-runtime",
					title: "Document runtime helpers",
					summary: "Document runtime helper behavior.",
					fileTargets: ["README.md"],
					dependsOn: undefined,
				},
			],
		};
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value, [
			"document-runtime",
			"setup-runtime",
		]);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		let currentSession = approved.value;
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => currentSession,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				const saved = structuredClone(nextSession);
				currentSession = saved;
				return saved;
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};
		const savedAfterFirst = currentSession;
		expect(currentSession.plan?.features.map((feature) => feature.id)).toEqual([
			"setup-runtime",
			"document-runtime",
		]);

		const duplicateDifferentOrder = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("approve_plan", {
				featureIds: ["document-runtime", "setup-runtime"],
			}),
			runtime,
		);

		expect(duplicateDifferentOrder.kind).toBe("success");
		expect(duplicateDifferentOrder.response.summary).toBe(
			"Plan approval already recorded; no state change.",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(1);
		expect(currentSession).toBe(savedAfterFirst);
		if (duplicateDifferentOrder.kind === "success") {
			expect(duplicateDifferentOrder.savedSession).toBe(savedAfterFirst);
		}

		const duplicateOmittedIds = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("approve_plan", { featureIds: [] }),
			runtime,
		);

		expect(duplicateOmittedIds.kind).toBe("success");
		expect(duplicateOmittedIds.response.summary).toBe(
			"Plan approval already recorded; no state change.",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(2);
		expect(currentSession).toBe(savedAfterFirst);
		expect(currentSession.plan?.features.map((feature) => feature.id)).toEqual([
			"setup-runtime",
			"document-runtime",
		]);

		const changedSelection = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("approve_plan", {
				featureIds: ["setup-runtime"],
			}),
			runtime,
		);

		expect(changedSelection.kind).toBe("failure");
		expect(changedSelection.response.summary).toContain(
			"feature selection cannot be changed",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(2);
		expect(currentSession).toBe(savedAfterFirst);
	});

	test("explicit duplicate run start skips persistence for the same active feature", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value, "setup-runtime");
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		let currentSession = started.value.session;
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => currentSession,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				const saved = structuredClone(nextSession);
				currentSession = saved;
				return saved;
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};
		const savedAfterFirst = currentSession;

		const duplicate = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("start_run", {
				featureId: "setup-runtime",
			}),
			runtime,
		);

		expect(duplicate.kind).toBe("success");
		expect(duplicate.response.summary).toBe(
			"Feature 'setup-runtime' is already running; no state change.",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(1);
		expect(currentSession).toBe(savedAfterFirst);
		expect(currentSession.execution.activeFeatureId).toBe("setup-runtime");
		if (duplicate.kind === "success") {
			expect(duplicate.savedSession).toBe(savedAfterFirst);
		}
	});

	test("implicit duplicate run start is no-op while explicit different feature still fails", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value, "setup-runtime");
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		let currentSession = started.value.session;
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => currentSession,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				const saved = structuredClone(nextSession);
				currentSession = saved;
				return saved;
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};

		const implicit = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("start_run", {}),
			runtime,
		);
		expect(implicit.kind).toBe("success");
		expect(implicit.response.summary).toBe(
			"Feature 'setup-runtime' is already running; no state change.",
		);

		const differentFeature = await runSessionMutationActionAtRoot(
			worktree,
			dispatchSessionMutationAction("start_run", {
				featureId: "execute-flow",
			}),
			runtime,
		);
		expect(differentFeature.kind).toBe("failure");
		expect(differentFeature.response.summary).toContain(
			"Feature 'setup-runtime' is already in progress.",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(1);
		expect(currentSession.execution.activeFeatureId).toBe("setup-runtime");
	});

	test("reviewer decision action skips persistence for identical no-op records", async () => {
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

		const decision = {
			scope: "feature" as const,
			featureId: "setup-runtime",
			status: "approved" as const,
			summary: "Looks good.",
		};
		const preRecorded = recordReviewerDecision(started.value.session, decision);
		expect(preRecorded.ok).toBe(true);
		if (!preRecorded.ok) return;

		let currentSession = preRecorded.value;
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => currentSession,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				const saved = structuredClone(nextSession);
				currentSession = saved;
				return saved;
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};
		const savedAfterFirst = currentSession;
		const duplicate = await runSessionMutationActionAtRoot(
			worktree,
			createFeatureReviewerDecisionAction(decision),
			runtime,
		);
		expect(duplicate.kind).toBe("success");
		expect(duplicate.response.summary).toBe(
			"Reviewer decision already recorded; no state change.",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(1);
		expect(currentSession).toBe(savedAfterFirst);
		if (duplicate.kind === "success") {
			expect(duplicate.savedSession).toBe(savedAfterFirst);
		}

		const changed = await runSessionMutationActionAtRoot(
			worktree,
			createFeatureReviewerDecisionAction({
				...decision,
				status: "needs_fix",
				summary: "Needs one fix.",
				blockingFindings: [{ summary: "Validation evidence is incomplete." }],
			}),
			runtime,
		);
		expect(changed.kind).toBe("success");
		expect(changed.response.summary).toBe("Reviewer decision recorded.");
		expect(saveCount).toBe(1);
		expect(syncCount).toBe(2);
		expect(currentSession).not.toBe(savedAfterFirst);
		expect(currentSession.execution.lastReviewerDecision?.status).toBe(
			"needs_fix",
		);
	});

	test("final reviewer decision action skips persistence for identical no-op records", async () => {
		const worktree = makeTempDir();
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

		const decision = {
			scope: "final" as const,
			reviewDepth: "detailed" as const,
			reviewedSurfaces: [
				"changed_files" as const,
				"shared_surfaces" as const,
				"validation_evidence" as const,
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
			status: "approved" as const,
			summary: "Final review looks good.",
		};
		const preRecorded = recordReviewerDecision(started.value.session, decision);
		expect(preRecorded.ok).toBe(true);
		if (!preRecorded.ok) return;

		let currentSession = preRecorded.value;
		let saveCount = 0;
		let syncCount = 0;
		const runtime: SessionRuntimePort = {
			loadSession: async () => currentSession,
			saveSessionState: async (_worktree, nextSession) => {
				saveCount += 1;
				const saved = structuredClone(nextSession);
				currentSession = saved;
				return saved;
			},
			syncSessionArtifacts: async () => {
				syncCount += 1;
			},
		};
		const savedAfterFirst = currentSession;
		const duplicate = await runSessionMutationActionAtRoot(
			worktree,
			createFinalReviewerDecisionAction(decision),
			runtime,
		);

		expect(duplicate.kind).toBe("success");
		expect(duplicate.response.summary).toBe(
			"Reviewer decision already recorded; no state change.",
		);
		expect(saveCount).toBe(0);
		expect(syncCount).toBe(1);
		expect(currentSession).toBe(savedAfterFirst);
		if (duplicate.kind === "success") {
			expect(duplicate.savedSession).toBe(savedAfterFirst);
		}
	});

	test("final review tool returns recovery details for review-scope accounting failures", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const basePlan = samplePlan();
		const applied = applyPlan(createSession("Review runtime scope"), {
			...basePlan,
			goalMode: "review" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: ["src/runtime/session.ts"],
				},
			],
		});
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
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary: "Checked final runtime state and validation evidence.",
				validationAssessment: "bun test validates the reviewed runtime scope.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Checked the runtime session boundary against completion behavior.",
				],
				regressionChecks: [
					"Checked validation evidence for the runtime session boundary.",
				],
				remainingGaps: [],
				status: "approved",
				summary: "Looks good.",
				reviewScopeLedger: [
					{
						scopeId: "audit:pointer-only-practice-controls",
						status: "reviewed_no_findings",
						evidenceRefs: ["src/runtime/session.ts"],
						residualRisk: "No known residual risk.",
					},
				],
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.recovery.errorCode).toBe("missing_review_scope_accounting");
		expect(parsed.recovery.recoveryStage).toBe("record_review");
		expect(parsed.recovery.prerequisite).toBe("reviewer_result_required");
		expect(parsed.recovery.requiredArtifact).toBe("final_reviewer_decision");
		expect(
			parsed.recovery.details.reviewScopeLedger.declaredScopes.map(
				(scope: { scopeId: string }) => scope.scopeId,
			),
		).toContain("file_target:src/runtime/session.ts");
		expect(
			parsed.recovery.details.reviewScopeLedger.exampleReviewScopeLedgerPurpose,
		).toBe("scaffold_only");
		expect(
			parsed.recovery.details.reviewScopeLedger.exampleReviewScopeLedger.map(
				(entry: { scopeId: string }) => entry.scopeId,
			),
		).toContain("file_target:src/runtime/session.ts");
		expect(
			parsed.recovery.details.reviewScopeLedger.exampleReviewScopeLedger[0]
				.residualRisk,
		).toContain("Example scaffold only");
		expect(
			parsed.recovery.details.reviewScopeLedger.notes.join("\n"),
		).toContain("do not replay unchanged");
	});

	test("tool does not persist worker evidence when success-gate recovery rejects ok completion", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, {
			...samplePlan(),
			deliveryPolicy: { strictReview: true },
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		await saveSession(worktree, started.value.session);
		const response = await tools.flow_run_complete_feature.execute(
			{
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
				reviewScopeLedger: [
					{
						scopeId: "file_target:src/runtime/session.ts",
						status: "reviewed_no_findings",
						evidenceRefs: ["src/runtime/session.ts"],
						validationRefs: ["bun test"],
						residualRisk: "No known residual risk.",
					},
				],
				reviewIterations: 1,
				decisions: [{ summary: "Runtime wiring is complete." }],
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
		expect(parsed.status).toBe("error");
		expect(parsed.recovery.errorCode).toBe("missing_feature_reviewer_decision");

		const persisted = await loadSession(worktree);
		expect(persisted?.execution.activeFeatureId).toBe("setup-runtime");
		expect(persisted?.execution.lastSummary).toBe(
			"Running feature 'setup-runtime'.",
		);
		expect(persisted?.execution.lastFeatureResult).toBeNull();
		expect(persisted?.execution.lastValidationRun).toEqual([]);
		expect(persisted?.execution.history).toHaveLength(0);
		expect(persisted?.artifacts).toEqual([]);
		expect(persisted?.notes).toEqual([]);
	});

	test("tool returns machine-readable recovery details for missing broad validation", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
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

		await saveSession(worktree, reviewed.value);
		const response = await tools.flow_run_complete_feature.execute(
			{
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
				reviewScopeLedger: [
					{
						scopeId: "file_target:src/runtime/session.ts",
						status: "reviewed_no_findings",
						evidenceRefs: ["src/runtime/session.ts"],
						validationRefs: ["bun test"],
						residualRisk: "No known residual risk.",
					},
				],
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
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.recovery.errorCode).toBe("missing_broad_validation");
		expect(parsed.recovery.recoveryStage).toBe("rerun_validation");
		expect(parsed.recovery.prerequisite).toBe("validation_rerun_required");
		expect(parsed.recovery.requiredArtifact).toBe("broad_validation_result");
		expect(parsed.recovery.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(parsed.recovery.nextRuntimeTool).toBeUndefined();
		expect(parsed.recovery.autoResolvable).toBe(true);
	});

	test("feature reviewer recovery exposes runtime tool guidance without suggesting flow-run", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, {
			...samplePlan(),
			deliveryPolicy: { strictReview: true },
		});
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
			reviewScopeLedger: [
				{
					scopeId: "file_target:src/runtime/session.ts",
					status: "reviewed_no_findings",
					evidenceRefs: ["src/runtime/session.ts"],
					validationRefs: ["bun test"],
					residualRisk: "No known residual risk.",
				},
			],
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
		expect(completed.recovery?.requiredArtifact).toBe(
			"feature_reviewer_decision",
		);
		expect(completed.recovery?.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
		expect(completed.recovery?.nextRuntimeArgs).toBeUndefined();
	});

	test("missing targeted validation recovery stays status-only and points back to validation", () => {
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
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "broad",
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

		expect(completed.recovery?.errorCode).toBe("missing_targeted_validation");
		expect(completed.recovery?.recoveryStage).toBe("rerun_validation");
		expect(completed.recovery?.prerequisite).toBe("validation_rerun_required");
		expect(completed.recovery?.requiredArtifact).toBe(
			"targeted_validation_result",
		);
		expect(completed.recovery?.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
		expect(completed.recovery?.nextRuntimeArgs).toBeUndefined();
	});

	test("missing final review payload exposes prerequisite instead of fake retry action", () => {
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
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe("missing_final_review_payload");
		expect(completed.recovery?.recoveryStage).toBe("retry_completion");
		expect(completed.recovery?.prerequisite).toBe(
			"completion_payload_rebuild_required",
		);
		expect(completed.recovery?.requiredArtifact).toBe("final_review_payload");
		expect(completed.recovery?.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
	});
});
