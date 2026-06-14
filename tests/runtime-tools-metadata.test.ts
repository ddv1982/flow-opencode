import { afterEach, describe, expect, mock, test } from "bun:test";
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

function latestMetadataCall(metadata: ReturnType<typeof mock>): {
	metadata?: Record<string, unknown>;
	title?: unknown;
} {
	return (metadata.mock.calls.at(-1)?.[0] ?? {}) as unknown as {
		metadata?: Record<string, unknown>;
		title?: unknown;
	};
}

describe("runtime tool metadata", () => {
	test("every Flow tool emits non-empty metadata and still returns a string", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const metadata = mock(() => {});
		const context = {
			...toolContext(worktree),
			sessionID: "metadata-session",
			agent: "flow-auto",
			metadata,
			client: { app: { log: () => {} } },
		};

		const seededResponse = await tools.flow_plan_save.execute(
			{ goal: "Build a workflow plugin" },
			context,
		);
		const seededSession = JSON.parse(seededResponse).session as { id: string };
		const currentSessionId = seededSession.id;

		const toolArgs: Record<string, unknown> = {
			flow_status: {},
			flow_context: {},
			flow_plan_save: { goal: "Build a workflow plugin" },
			flow_plan_approve: {},
			flow_run_start: {},
			flow_feature_complete: {
				contractVersion: "1",
				status: "needs_input",
				summary: "Need a follow-up plan.",
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [],
				decisions: [],
				nextStep: "Replan the work.",
				outcome: {
					kind: "replan_required",
					replanReason: "plan_too_broad",
					failedAssumption:
						"The current feature was small enough to finish in one pass.",
					recommendedAdjustment:
						"Split the work into a smaller follow-up plan.",
				},
				featureResult: {
					featureId: "setup-runtime",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
			flow_review_record: {
				scope: "feature",
				featureReview: {
					featureId: "setup-runtime",
					status: "approved",
					summary: "Looks good.",
				},
			},
			flow_session: { action: "show", sessionId: currentSessionId },
		};

		for (const toolName of Object.keys(tools)) {
			const tool = tools[toolName];
			if (!tool) {
				throw new Error(`Missing tool definition for ${toolName}`);
			}
			metadata.mockClear();
			const response = await tool.execute(toolArgs[toolName], context);

			expect(typeof response).toBe("string");
			if (metadata.mock.calls.length === 0) {
				throw new Error(`Expected metadata for tool ${toolName}`);
			}
			expect(metadata).toHaveBeenCalled();

			const latestCall = latestMetadataCall(metadata);

			expect(typeof latestCall.title).toBe("string");
			expect((latestCall.title as string).trim().length).toBeGreaterThan(0);
			expect(latestCall.metadata).toBeObject();
			expect(Array.isArray(latestCall.metadata)).toBe(false);
		}
	});

	test("runtime tools expose task progress metadata signals", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const metadata = mock(() => {});
		const context = {
			...toolContext(worktree),
			sessionID: "metadata-session",
			agent: "flow-auto",
			metadata,
			client: { app: { log: () => {} } },
		};

		await tools.flow_plan_save.execute(
			{ goal: "Build a workflow plugin" },
			context,
		);
		await tools.flow_plan_save.execute({ plan: samplePlan() }, context);
		metadata.mockClear();
		await tools.flow_plan_approve.execute({}, context);
		let latestCall = latestMetadataCall(metadata);
		expect(latestCall.title).toBe("Plan approval requested");
		expect(latestCall.metadata?.requestedApprovalStatus).toBe("approved");
		expect(latestCall.metadata?.taskOwner).toBe("flow-plan");
		expect(latestCall.metadata?.taskPhase).toBe("planning");

		metadata.mockClear();
		await tools.flow_run_start.execute({}, context);
		latestCall = latestMetadataCall(metadata);
		expect(latestCall.title).toBe("Run start requested: next approved feature");
		expect(latestCall.metadata?.taskOwner).toBe("flow-run");
		expect(latestCall.metadata?.taskPhase).toBe("execution");
		expect(latestCall.metadata?.taskStatus).toBe("active");

		metadata.mockClear();
		await tools.flow_run_start.execute({ featureId: "setup-runtime" }, context);
		latestCall = latestMetadataCall(metadata);
		expect(latestCall.title).toBe("Run start requested: setup-runtime");
		let drilldown = latestCall.metadata?.featureDocDrilldown as Record<
			string,
			unknown
		>;
		expect(drilldown?.kind).toBe("feature_doc");
		expect(drilldown?.featureId).toBe("setup-runtime");
		expect(typeof drilldown?.path).toBe("string");
		expect(
			(drilldown?.path as string).endsWith("/docs/features/setup-runtime.md"),
		).toBe(true);
		expect(typeof drilldown?.availability).toBe("string");

		metadata.mockClear();
		await tools.flow_feature_complete.execute(
			{
				contractVersion: "1",
				status: "needs_input",
				summary: "Need a follow-up plan.",
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [],
				decisions: [],
				nextStep: "Replan the work.",
				outcome: {
					kind: "replan_required",
					replanReason: "plan_too_broad",
					failedAssumption:
						"The current feature was small enough to finish in one pass.",
					recommendedAdjustment:
						"Split the work into a smaller follow-up plan.",
				},
				featureResult: { featureId: "setup-runtime" },
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
			context,
		);
		latestCall = latestMetadataCall(metadata);
		expect(latestCall.title).toBe(
			"Feature completion requested — pending Flow validation: setup-runtime",
		);
		expect(latestCall.metadata?.metadataAuthority).toBe("requested_only");
		expect(latestCall.metadata?.authoritativeStatusSource).toBe(
			"tool_result_json",
		);
		expect(latestCall.metadata?.mutationState).toBe("pending_guarded_mutation");
		expect(latestCall.metadata?.taskOwner).toBe("flow-run");
		expect(latestCall.metadata?.taskPhase).toBe("execution");
		expect(latestCall.metadata?.taskStatus).toBe("active");
		expect(latestCall.metadata?.requestedTaskStatus).toBe("needs_input");
		expect(latestCall.metadata?.requestedWorkerStatus).toBe("needs_input");
		expect(latestCall.metadata?.persistedTaskStatus).toBeNull();
		expect(latestCall.metadata?.persistedWorkerStatus).toBeNull();
		expect(latestCall.metadata?.status).toBeUndefined();
		expect(latestCall.metadata?.validationCount).toBe(0);
		expect(latestCall.metadata?.hasFinalReview).toBe(false);
		drilldown = latestCall.metadata?.featureDocDrilldown as Record<
			string,
			unknown
		>;
		expect(drilldown?.kind).toBe("feature_doc");
		expect(drilldown?.featureId).toBe("setup-runtime");

		metadata.mockClear();
		await tools.flow_feature_complete.execute(
			{ reset: true, featureId: "setup-runtime" },
			context,
		);
		latestCall = latestMetadataCall(metadata);
		expect(latestCall.title).toBe("Feature reset requested: setup-runtime");
		drilldown = latestCall.metadata?.featureDocDrilldown as Record<
			string,
			unknown
		>;
		expect(drilldown?.kind).toBe("feature_doc");
		expect(drilldown?.featureId).toBe("setup-runtime");

		metadata.mockClear();
		await tools.flow_review_record.execute(
			{
				scope: "feature",
				featureReview: {
					featureId: "setup-runtime",
					status: "approved",
					summary: "Looks good.",
				},
			},
			context,
		);
		latestCall = latestMetadataCall(metadata);
		expect(latestCall.title).toBe(
			"Feature review requested approved — pending Flow persistence: setup-runtime",
		);
		expect(latestCall.metadata?.metadataAuthority).toBe("requested_only");
		expect(latestCall.metadata?.authoritativeStatusSource).toBe(
			"tool_result_json",
		);
		expect(latestCall.metadata?.mutationState).toBe("pending_guarded_mutation");
		expect(latestCall.metadata?.taskOwner).toBe("flow-reviewer");
		expect(latestCall.metadata?.taskPhase).toBe("review");
		expect(latestCall.metadata?.taskStatus).toBe("active");
		expect(latestCall.metadata?.requestedReviewStatus).toBe("approved");
		expect(latestCall.metadata?.persistedReviewStatus).toBeNull();
		expect(latestCall.metadata?.status).toBeUndefined();
		drilldown = latestCall.metadata?.featureDocDrilldown as Record<
			string,
			unknown
		>;
		expect(drilldown?.kind).toBe("feature_doc");
		expect(drilldown?.featureId).toBe("setup-runtime");

		metadata.mockClear();
		await tools.flow_review_record.execute(
			{
				scope: "final",
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
					status: "approved",
					summary: "Final review looks good.",
				},
			},
			context,
		);
		latestCall = latestMetadataCall(metadata);
		expect(latestCall.title).toBe(
			"Final reviewer requested approved — pending Flow persistence",
		);
		expect(latestCall.metadata?.metadataAuthority).toBe("requested_only");
		expect(latestCall.metadata?.authoritativeStatusSource).toBe(
			"tool_result_json",
		);
		expect(latestCall.metadata?.mutationState).toBe("pending_guarded_mutation");
		expect(latestCall.metadata?.taskOwner).toBe("flow-reviewer");
		expect(latestCall.metadata?.taskPhase).toBe("final_review");
		expect(latestCall.metadata?.taskStatus).toBe("active");
		expect(latestCall.metadata?.requestedReviewStatus).toBe("approved");
		expect(latestCall.metadata?.persistedReviewStatus).toBeNull();
		expect(latestCall.metadata?.status).toBeUndefined();

		metadata.mockClear();
		await tools.flow_status.execute({}, context);
		latestCall = latestMetadataCall(metadata);
		expect(typeof latestCall.metadata?.taskProgressCount).toBe("number");
		expect(typeof latestCall.metadata?.activeTaskCount).toBe("number");
		expect(typeof latestCall.metadata?.blockedTaskCount).toBe("number");
	});

	test("flow_status counts needs_input task progress rows as blocked metadata", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const metadata = mock(() => {});
		const context = {
			...toolContext(worktree),
			sessionID: "metadata-session",
			agent: "flow-auto",
			metadata,
			client: { app: { log: () => {} } },
		};

		await tools.flow_plan_save.execute(
			{ goal: "Build a workflow plugin" },
			context,
		);
		await tools.flow_plan_save.execute({ plan: samplePlan() }, context);
		await tools.flow_plan_approve.execute({}, context);
		await tools.flow_plan_save.execute(
			{
				planning: {
					decisionLog: [
						{
							question: "Should Flow pause for approval?",
							decisionMode: "recommend_confirm",
							decisionDomain: "architecture",
							options: [{ label: "Pause and ask", tradeoffs: ["safer"] }],
							recommendation: "Pause and ask before changing the architecture.",
							rationale: ["The architecture choice affects multiple files."],
						},
					],
				},
			},
			context,
		);
		await tools.flow_status.execute({}, context);

		const latestCall = latestMetadataCall(metadata);
		expect(latestCall.metadata?.blockedTaskCount).toBeGreaterThanOrEqual(1);
	});

	test("flow_status surfaces context diagnostics for weak planned context", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const context = toolContext(worktree);

		await tools.flow_plan_save.execute(
			{ goal: "Improve context visibility" },
			context,
		);
		await tools.flow_plan_save.execute(
			{
				plan: {
					...samplePlan(),
					features: [
						{
							id: "context-pack",
							title: "Render context pack",
							summary: "Make planned context visible.",
							fileTargets: [],
							verification: [],
							status: "pending",
						},
					],
				},
			},
			context,
		);

		const detailed = JSON.parse(
			await tools.flow_status.execute({}, context),
		) as {
			contextDiagnostics?: Array<{ id: string; featureId?: string }>;
		};
		expect(detailed.contextDiagnostics?.map((item) => item.id)).toContain(
			"feature_missing_file_targets",
		);
		expect(detailed.contextDiagnostics?.map((item) => item.id)).toContain(
			"feature_missing_verification",
		);
		expect(
			detailed.contextDiagnostics?.some(
				(item) => item.featureId === "context-pack",
			),
		).toBe(true);

		const compact = JSON.parse(
			await tools.flow_status.execute({ view: "compact" }, context),
		) as {
			contextDiagnostics?: { count: number; warnings: number };
		};
		expect(compact.contextDiagnostics?.count).toBeGreaterThanOrEqual(1);
		expect(compact.contextDiagnostics?.warnings).toBeGreaterThanOrEqual(1);
	});

	test("flow_status warns when changed artifacts fall outside planned context", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const context = toolContext(worktree);

		await tools.flow_plan_save.execute(
			{ goal: "Detect context drift" },
			context,
		);
		await tools.flow_plan_save.execute(
			{
				planning: {
					repoProfile: ["TypeScript plugin with bun test"],
					research: ["Inspected src/planned.ts"],
				},
				plan: {
					...samplePlan(),
					features: [
						{
							id: "planned-change",
							title: "Change planned file",
							summary: "Update the planned runtime file.",
							fileTargets: ["src/planned.ts"],
							verification: ["bun test"],
							status: "pending",
						},
						{
							id: "follow-up",
							title: "Keep session active",
							summary: "Leave a second feature pending for status inspection.",
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
				summary: "Changed an unplanned file.",
				artifactsChanged: [{ path: "src/unplanned.ts" }],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				decisions: [],
				nextStep: "Review context drift.",
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

		const detailed = JSON.parse(
			await tools.flow_status.execute({}, context),
		) as {
			contextDiagnostics?: Array<{ id: string; summary: string }>;
		};

		const drift = detailed.contextDiagnostics?.find(
			(item) => item.id === "changed_artifacts_outside_planned_context",
		);
		expect(drift?.summary).toContain("src/unplanned.ts");
	});
});
