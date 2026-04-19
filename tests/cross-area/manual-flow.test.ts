import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionSchema } from "../../src/runtime/schema";
import {
	cleanupManagedTempDirs,
	createToolContext,
	importBuiltPlugin,
	makeManagedTempDir,
	requireTool,
} from "./helpers";

afterEach(() => {
	cleanupManagedTempDirs();
});

function normalizeEnvelope(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (_key, current) => {
			if (typeof current !== "string") {
				return current;
			}

			return current
				.replace(
					/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
					"<session-id>",
				)
				.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<timestamp>");
		}),
	);
}

const expectedEnvelopeSnapshot = {
	complete: {
		session: {
			activeFeature: null,
			approval: "approved",
			artifacts: [{ path: "dist/index.js" }],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 1,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 1,
				totalFeatures: 1,
			},
			featureLines: ["dist-smoke (completed): Run dist smoke"],
			featureProgress: { completed: 1, total: 1 },
			features: [
				{
					id: "dist-smoke",
					status: "completed",
					summary: "Exercise the release bundle end to end.",
					title: "Run dist smoke",
				},
			],
			goal: "Ship the dist smoke workflow",
			id: "<session-id>",
			lastFeatureResult: {
				featureId: "dist-smoke",
				verificationStatus: "passed",
			},
			lastNextStep: "Ship the release.",
			lastOutcome: { kind: "completed" },
			lastOutcomeKind: "completed",
			lastReviewerDecision: {
				blockingFindings: [],
				followUps: [],
				scope: "final",
				status: "approved",
				suggestedValidation: [],
				summary: "Final review approved.",
			},
			lastValidationRun: [
				{
					command: "bun test tests/smoke/dist-load.test.ts",
					status: "passed",
					summary: "Dist smoke passed.",
				},
			],
			nextCommand: "/flow-plan <goal>",
			notes: ["Release smoke completed cleanly."],
			planOverview:
				"Validate plan, run, review, and completion via built code.",
			planSummary: "Run a single smoke feature through the dist bundle.",
			planning: { repoProfile: [], research: [], decisionLog: [] },
			status: "completed",
		},
		status: "ok",
		summary: "Completed release smoke path.",
	},
	featureReview: {
		session: {
			activeFeature: {
				fileTargets: ["dist/index.js"],
				id: "dist-smoke",
				status: "in_progress",
				summary: "Exercise the release bundle end to end.",
				title: "Run dist smoke",
				verification: ["bun test tests/smoke/dist-load.test.ts"],
			},
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: true,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 1,
				totalFeatures: 1,
			},
			featureLines: ["dist-smoke (in_progress): Run dist smoke"],
			featureProgress: { completed: 0, total: 1 },
			features: [
				{
					id: "dist-smoke",
					status: "in_progress",
					summary: "Exercise the release bundle end to end.",
					title: "Run dist smoke",
				},
			],
			goal: "Ship the dist smoke workflow",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: {
				blockingFindings: [],
				featureId: "dist-smoke",
				followUps: [],
				scope: "feature",
				status: "approved",
				suggestedValidation: [],
				summary: "Feature review approved.",
			},
			lastValidationRun: [],
			nextCommand: "/flow-run",
			notes: [],
			planOverview:
				"Validate plan, run, review, and completion via built code.",
			planSummary: "Run a single smoke feature through the dist bundle.",
			planning: { repoProfile: [], research: [], decisionLog: [] },
			status: "running",
		},
		status: "ok",
		summary: "Reviewer decision recorded.",
	},
	finalReview: {
		session: {
			activeFeature: {
				fileTargets: ["dist/index.js"],
				id: "dist-smoke",
				status: "in_progress",
				summary: "Exercise the release bundle end to end.",
				title: "Run dist smoke",
				verification: ["bun test tests/smoke/dist-load.test.ts"],
			},
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: true,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 1,
				totalFeatures: 1,
			},
			featureLines: ["dist-smoke (in_progress): Run dist smoke"],
			featureProgress: { completed: 0, total: 1 },
			features: [
				{
					id: "dist-smoke",
					status: "in_progress",
					summary: "Exercise the release bundle end to end.",
					title: "Run dist smoke",
				},
			],
			goal: "Ship the dist smoke workflow",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: {
				blockingFindings: [],
				followUps: [],
				scope: "final",
				status: "approved",
				suggestedValidation: [],
				summary: "Final review approved.",
			},
			lastValidationRun: [],
			nextCommand: "/flow-run",
			notes: [],
			planOverview:
				"Validate plan, run, review, and completion via built code.",
			planSummary: "Run a single smoke feature through the dist bundle.",
			planning: { repoProfile: [], research: [], decisionLog: [] },
			status: "running",
		},
		status: "ok",
		summary: "Reviewer decision recorded.",
	},
	planApply: {
		session: {
			activeFeature: null,
			approval: "pending",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 1,
				totalFeatures: 1,
			},
			featureLines: ["dist-smoke (pending): Run dist smoke"],
			featureProgress: { completed: 0, total: 1 },
			features: [
				{
					id: "dist-smoke",
					status: "pending",
					summary: "Exercise the release bundle end to end.",
					title: "Run dist smoke",
				},
			],
			goal: "Ship the dist smoke workflow",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-plan",
			notes: [],
			planOverview:
				"Validate plan, run, review, and completion via built code.",
			planSummary: "Run a single smoke feature through the dist bundle.",
			planning: { repoProfile: [], research: [], decisionLog: [] },
			status: "planning",
		},
		status: "ok",
		summary: "Draft plan saved.",
	},
	planApprove: {
		session: {
			activeFeature: null,
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 1,
				totalFeatures: 1,
			},
			featureLines: ["dist-smoke (pending): Run dist smoke"],
			featureProgress: { completed: 0, total: 1 },
			features: [
				{
					id: "dist-smoke",
					status: "pending",
					summary: "Exercise the release bundle end to end.",
					title: "Run dist smoke",
				},
			],
			goal: "Ship the dist smoke workflow",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-run",
			notes: [],
			planOverview:
				"Validate plan, run, review, and completion via built code.",
			planSummary: "Run a single smoke feature through the dist bundle.",
			planning: { repoProfile: [], research: [], decisionLog: [] },
			status: "ready",
		},
		status: "ok",
		summary: "Plan approved.",
	},
	planStart: {
		session: {
			activeFeature: null,
			approval: "pending",
			artifacts: [],
			completion: null,
			featureLines: [],
			featureProgress: { completed: 0, total: 0 },
			features: [],
			goal: "Ship the dist smoke workflow",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-plan <goal>",
			notes: [],
			planOverview: null,
			planSummary: null,
			planning: { repoProfile: [], research: [], decisionLog: [] },
			status: "planning",
		},
		status: "ok",
		summary: "Planning session ready for goal: Ship the dist smoke workflow",
	},
	runStart: {
		feature: {
			fileTargets: ["dist/index.js"],
			id: "dist-smoke",
			status: "in_progress",
			summary: "Exercise the release bundle end to end.",
			title: "Run dist smoke",
			verification: ["bun test tests/smoke/dist-load.test.ts"],
		},
		session: {
			activeFeature: {
				fileTargets: ["dist/index.js"],
				id: "dist-smoke",
				status: "in_progress",
				summary: "Exercise the release bundle end to end.",
				title: "Run dist smoke",
				verification: ["bun test tests/smoke/dist-load.test.ts"],
			},
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: true,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 1,
				totalFeatures: 1,
			},
			featureLines: ["dist-smoke (in_progress): Run dist smoke"],
			featureProgress: { completed: 0, total: 1 },
			features: [
				{
					id: "dist-smoke",
					status: "in_progress",
					summary: "Exercise the release bundle end to end.",
					title: "Run dist smoke",
				},
			],
			goal: "Ship the dist smoke workflow",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-run",
			notes: [],
			planOverview:
				"Validate plan, run, review, and completion via built code.",
			planSummary: "Run a single smoke feature through the dist bundle.",
			planning: { repoProfile: [], research: [], decisionLog: [] },
			status: "running",
		},
		status: "ok",
		summary: "Running feature 'dist-smoke'.",
	},
};

describe("cross-area manual flow", () => {
	test("drives plan to final completion with stable JSON envelopes and artifacts", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-manual-cross-area-");
		const plugin = await pluginFactory({ worktree } as Parameters<
			typeof pluginFactory
		>[0]);
		const tools = plugin.tool as Record<
			string,
			{ execute: (args: unknown, context: unknown) => Promise<string> }
		>;
		const context = createToolContext(worktree);
		const flowPlanStart = requireTool(tools, "flow_plan_start");
		const flowPlanApply = requireTool(tools, "flow_plan_apply");
		const flowPlanApprove = requireTool(tools, "flow_plan_approve");
		const flowRunStart = requireTool(tools, "flow_run_start");
		const flowReviewRecordFeature = requireTool(
			tools,
			"flow_review_record_feature",
		);
		const flowReviewRecordFinal = requireTool(
			tools,
			"flow_review_record_final",
		);
		const flowRunCompleteFeature = requireTool(
			tools,
			"flow_run_complete_feature",
		);

		const planStart = JSON.parse(
			await flowPlanStart.execute(
				{ goal: "Ship the dist smoke workflow" },
				context,
			),
		);
		const planApply = JSON.parse(
			await flowPlanApply.execute(
				{
					plan: {
						summary: "Run a single smoke feature through the dist bundle.",
						overview:
							"Validate plan, run, review, and completion via built code.",
						features: [
							{
								id: "dist-smoke",
								title: "Run dist smoke",
								summary: "Exercise the release bundle end to end.",
								fileTargets: ["dist/index.js"],
								verification: ["bun test tests/smoke/dist-load.test.ts"],
							},
						],
					},
				},
				context,
			),
		);
		const planApprove = JSON.parse(await flowPlanApprove.execute({}, context));
		const runStart = JSON.parse(await flowRunStart.execute({}, context));
		const featureReview = JSON.parse(
			await flowReviewRecordFeature.execute(
				{
					scope: "feature",
					featureId: "dist-smoke",
					status: "approved",
					summary: "Feature review approved.",
				},
				context,
			),
		);
		const finalReview = JSON.parse(
			await flowReviewRecordFinal.execute(
				{
					scope: "final",
					status: "approved",
					summary: "Final review approved.",
				},
				context,
			),
		);
		const complete = JSON.parse(
			await flowRunCompleteFeature.execute(
				{
					contractVersion: "1",
					status: "ok",
					summary: "Completed release smoke path.",
					artifactsChanged: [{ path: "dist/index.js" }],
					validationRun: [
						{
							command: "bun test tests/smoke/dist-load.test.ts",
							status: "passed",
							summary: "Dist smoke passed.",
						},
					],
					validationScope: "broad",
					reviewIterations: 1,
					decisions: [{ summary: "Release smoke completed cleanly." }],
					nextStep: "Ship the release.",
					outcome: { kind: "completed" },
					featureResult: {
						featureId: "dist-smoke",
						verificationStatus: "passed",
					},
					featureReview: {
						status: "passed",
						summary: "Feature review is clean.",
						blockingFindings: [],
					},
					finalReview: {
						status: "passed",
						summary: "Final review is clean.",
						blockingFindings: [],
					},
				},
				context,
			),
		);

		expect([
			planStart.status,
			planApply.status,
			planApprove.status,
			runStart.status,
			featureReview.status,
			finalReview.status,
			complete.status,
		]).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
		expect(complete.session.status).toBe("completed");
		expect(complete.session.lastOutcomeKind).toBe("completed");
		expect(complete.session.lastReviewerDecision.scope).toBe("final");
		expect(complete.session.completion.totalFeatures).toBe(1);

		expect(
			normalizeEnvelope({
				planStart,
				planApply,
				planApprove,
				runStart,
				featureReview,
				finalReview,
				complete,
			}),
		).toEqual(expectedEnvelopeSnapshot);

		const sessionId = planStart.session.id as string;
		const sessionPath = join(
			worktree,
			".flow",
			"sessions",
			sessionId,
			"session.json",
		);
		const rawSession = JSON.parse(await readFile(sessionPath, "utf8"));
		const parsedSession = SessionSchema.parse(rawSession);
		expect(parsedSession.id).toBe(sessionId);
		expect(parsedSession.status).toBe("completed");
		expect(parsedSession.timestamps.completedAt).toBeString();

		const activePointer = await readFile(
			join(worktree, ".flow", "active"),
			"utf8",
		);
		expect(activePointer.trim()).toBe(sessionId);

		const indexDoc = await readFile(
			join(worktree, ".flow", "sessions", sessionId, "docs", "index.md"),
			"utf8",
		);
		const featureDoc = await readFile(
			join(
				worktree,
				".flow",
				"sessions",
				sessionId,
				"docs",
				"features",
				"dist-smoke.md",
			),
			"utf8",
		);
		expect(indexDoc).toContain("Ship the dist smoke workflow");
		expect(indexDoc).toContain("dist-smoke | completed | Run dist smoke");
		expect(featureDoc).toContain("Run dist smoke");
	});
});
