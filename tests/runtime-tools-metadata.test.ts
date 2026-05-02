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

describe("runtime tool metadata", () => {
	test("every Flow tool emits non-empty metadata and still returns a string", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const metadata = mock(() => {});
		const context = {
			...toolContext(worktree),
			metadata,
			client: { app: { log: () => {} } },
		};

		const seededResponse = await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			context,
		);
		const seededSession = JSON.parse(seededResponse).session as { id: string };
		const currentSessionId = seededSession.id;

		const toolArgs: Record<string, unknown> = {
			flow_status: {},
			flow_history: {},
			flow_history_show: { sessionId: currentSessionId },
			flow_session_activate: { sessionId: currentSessionId },
			flow_plan_start: { goal: "Build a workflow plugin" },
			flow_auto_prepare: { argumentString: "resume" },
			flow_session_close: { kind: "completed" },
			flow_plan_apply: { plan: samplePlan() },
			flow_plan_approve: {},
			flow_plan_select_features: { featureIds: ["setup-runtime"] },
			flow_run_start: {},
			flow_run_complete_feature: {
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
			flow_review_record_feature: {
				scope: "feature",
				featureId: "setup-runtime",
				status: "approved",
				summary: "Looks good.",
			},
			flow_review_record_final: {
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
			flow_review_render: {
				reviewJson: JSON.stringify({
					requestedDepth: "deep_audit",
					achievedDepth: "deep_audit",
					repoSummary: "Repo summary.",
					overallVerdict: "Looks coherent.",
					discoveredSurfaces: [],
					coverageNotes: [],
					validationRun: [],
					findings: [],
				}),
			},
			flow_reset_feature: { featureId: "setup-runtime" },
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

			const latestCallEntry = metadata.mock.calls.at(-1) as
				| [unknown, ...unknown[]]
				| undefined;
			const latestCall = latestCallEntry?.[0] as
				| { title?: unknown; metadata?: unknown }
				| undefined;

			expect(typeof latestCall?.title).toBe("string");
			expect((latestCall?.title as string).trim().length).toBeGreaterThan(0);
			expect(latestCall?.metadata).toBeObject();
			expect(Array.isArray(latestCall?.metadata)).toBe(false);
		}
	});
});
