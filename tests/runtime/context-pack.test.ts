import { afterEach, describe, expect, test } from "bun:test";
import { buildContextPackProjection } from "../../src/runtime/context-pack";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	sampleSession,
	toolContext,
} from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-context-pack-");

afterEach(() => {
	cleanupTempDirs();
});

describe("context pack traceability", () => {
	test("treats changed artifacts inside review scope as planned context", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const context = toolContext(worktree);

		await tools.flow_plan_save.execute(
			{ goal: "Trace scoped context" },
			context,
		);
		await tools.flow_plan_save.execute(
			{
				planning: {
					repoProfile: ["TypeScript plugin using bun test"],
					research: ["Inspected src/planned.ts and src/generated.ts"],
				},
				plan: {
					...samplePlan(),
					features: [
						{
							id: "planned-change",
							title: "Change reviewed file",
							summary: "Update a file named in review scope.",
							fileTargets: ["src/planned.ts"],
							reviewScope: [
								{
									id: "generated-file",
									kind: "file",
									target: "src/generated.ts",
									description: "Generated context updated by the feature",
								},
							],
							verification: ["bun test"],
							status: "pending",
						},
						{
							id: "follow-up",
							title: "Keep session open",
							summary: "Leave a second feature pending.",
							fileTargets: ["src/follow-up.ts"],
							verification: ["bun test"],
							status: "pending",
						},
					],
				},
			},
			context,
		);
		await tools.flow_plan_approve.execute({}, context);
		await tools.flow_run_start.execute({}, context);
		await tools.flow_feature_complete.execute(
			{
				contractVersion: "1",
				status: "ok",
				summary: "Changed a scoped generated file.",
				artifactsChanged: [{ path: "src/generated.ts" }],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				decisions: [],
				nextStep: "Continue to follow-up.",
				validationScope: "targeted",
				featureResult: {
					featureId: "planned-change",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking feature findings.",
					blockingFindings: [],
				},
			},
			context,
		);

		const status = JSON.parse(await tools.flow_status.execute({}, context)) as {
			contextDiagnostics?: Array<{ id: string }>;
			contextTraceability?: {
				unplannedChangedArtifacts: string[];
				features: Array<{ id: string; gaps: Array<{ id: string }> }>;
			};
		};
		const changedFeature = status.contextTraceability?.features.find(
			(feature) => feature.id === "planned-change",
		);

		expect(
			status.contextDiagnostics?.map((item) => item.id) ?? [],
		).not.toContain("changed_artifacts_outside_planned_context");
		expect(status.contextTraceability?.unplannedChangedArtifacts).toEqual([]);
		expect(changedFeature?.gaps.map((gap) => gap.id)).not.toContain(
			"feature_changed_artifacts_outside_scope",
		);
	});

	test("marks changed artifacts without validation as validation-blocked", () => {
		const session = sampleSession("Detect validation gaps");
		const plan = samplePlan();
		session.plan = plan;
		session.approval = "approved";
		session.status = "running";
		session.execution.activeFeatureId = "setup-runtime";
		session.execution.history = [
			{
				featureId: "setup-runtime",
				status: "needs_input",
				summary: "Changed code before validation.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Run validation.",
				validationRun: [],
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				decisions: [],
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "not_recorded",
				},
				featureReview: {
					status: "needs_followup",
					summary: "Validation is missing.",
					blockingFindings: [{ summary: "No validation evidence." }],
				},
			},
		];

		const contextPack = buildContextPackProjection(session);

		expect(contextPack.workflowReadiness.state).toBe("blocked_by_validation");
		expect(contextPack.workflowReadiness.blocking[0]?.id).toBe(
			"feature_changed_without_validation",
		);
		expect(
			contextPack.traceability.features.find(
				(feature) => feature.id === "setup-runtime",
			)?.gaps[0]?.id,
		).toBe("feature_changed_without_validation");
	});

	test("marks unplanned changed artifacts as context-blocked after approval", () => {
		const session = sampleSession("Detect scope drift");
		session.plan = samplePlan();
		session.approval = "approved";
		session.status = "ready";
		session.execution.history = [
			{
				featureId: "setup-runtime",
				status: "ok",
				summary: "Changed code outside the planned target.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Review scope drift.",
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				artifactsChanged: [{ path: "src/unplanned.ts" }],
				decisions: [],
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
		];

		const contextPack = buildContextPackProjection(session);

		expect(contextPack.workflowReadiness.state).toBe("blocked_by_context");
		expect(
			contextPack.workflowReadiness.blocking.map((item) => item.id),
		).toEqual(
			expect.arrayContaining([
				"changed_artifacts_outside_planned_context",
				"feature_changed_artifacts_outside_scope",
			]),
		);
		expect(contextPack.traceability.unplannedChangedArtifacts).toEqual([
			"src/unplanned.ts",
		]);
	});

	test("compact status exposes workflow readiness and traceability summary", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const context = toolContext(worktree);

		await tools.flow_plan_save.execute(
			{ goal: "Expose compact status" },
			context,
		);
		await tools.flow_plan_save.execute(
			{
				planning: {
					repoProfile: ["TypeScript plugin using bun test"],
					research: ["Inspected runtime status presenters"],
				},
				plan: samplePlan(),
			},
			context,
		);

		const compact = JSON.parse(
			await tools.flow_status.execute({ view: "compact" }, context),
		) as {
			workflowReadiness?: {
				state: string;
				blockingCount: number;
				warningCount: number;
				nextAction: string;
			};
			contextTraceability?: {
				plannedTargetCount: number;
				changedArtifactCount: number;
				validationCommandCount: number;
			};
		};

		expect(compact.workflowReadiness?.state).toBe("planning_ready");
		expect(compact.workflowReadiness?.blockingCount).toBe(0);
		expect(compact.workflowReadiness?.nextAction).toContain("Finish the plan");
		expect(compact.contextTraceability?.plannedTargetCount).toBeGreaterThan(0);
		expect(compact.contextTraceability?.changedArtifactCount).toBe(0);
		expect(compact.contextTraceability?.validationCommandCount).toBe(0);
	});
});
