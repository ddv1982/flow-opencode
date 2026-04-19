import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

describe("cross-area autonomous flow", () => {
	test("preserves recovery metadata across blocked and replan outcomes", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-autonomous-cross-area-");
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
		const flowRunCompleteFeature = requireTool(
			tools,
			"flow_run_complete_feature",
		);
		const flowResetFeature = requireTool(tools, "flow_reset_feature");

		const planStart = JSON.parse(
			await flowPlanStart.execute(
				{ goal: "Recover an autonomous Flow session" },
				context,
			),
		);
		const sessionId = planStart.session.id as string;

		await flowPlanApply.execute(
			{
				plan: {
					summary: "Exercise blocked and replan recovery.",
					overview: "Drive the runtime through retry and replan branches.",
					features: [
						{
							id: "recover-autonomous",
							title: "Recover autonomous flow",
							summary: "Simulate blocked and replan branches.",
							fileTargets: ["dist/index.js"],
							verification: [
								"bun test tests/cross-area/autonomous-flow.test.ts",
							],
						},
					],
				},
			},
			context,
		);
		await flowPlanApprove.execute({}, context);
		await flowRunStart.execute({}, context);

		const blocked = JSON.parse(
			await flowRunCompleteFeature.execute(
				{
					contractVersion: "1",
					status: "needs_input",
					summary: "The flow is blocked on a retryable issue.",
					artifactsChanged: [],
					validationRun: [],
					validationScope: "targeted",
					reviewIterations: 0,
					decisions: [{ summary: "Need a retryable reset." }],
					nextStep: "Reset the feature and retry.",
					outcome: {
						kind: "blocked_external",
						summary: "A retryable repo issue blocked progress.",
						resolutionHint: "Reset the feature and rerun it.",
						retryable: true,
						autoResolvable: true,
						needsHuman: false,
					},
					featureResult: { featureId: "recover-autonomous" },
					featureReview: {
						status: "needs_followup",
						summary: "A reset is required.",
						blockingFindings: [],
					},
				},
				context,
			),
		);
		expect(blocked.status).toBe("ok");
		expect(blocked.session.status).toBe("blocked");
		expect(blocked.session.lastOutcome.retryable).toBe(true);
		expect(blocked.session.nextCommand).toBe(
			"/flow-reset feature recover-autonomous",
		);

		const reset = JSON.parse(
			await flowResetFeature.execute(
				{ featureId: "recover-autonomous" },
				context,
			),
		);
		expect(reset.status).toBe("ok");
		expect(reset.session.status).toBe("ready");

		const rerun = JSON.parse(await flowRunStart.execute({}, context));
		expect(rerun.status).toBe("ok");
		expect(rerun.session.status).toBe("running");

		const replan = JSON.parse(
			await flowRunCompleteFeature.execute(
				{
					contractVersion: "1",
					status: "needs_input",
					summary: "The plan needs to be refreshed.",
					artifactsChanged: [],
					validationRun: [],
					validationScope: "targeted",
					reviewIterations: 0,
					decisions: [{ summary: "The next run needs a replan." }],
					nextStep: "Refresh the plan before continuing.",
					outcome: {
						kind: "replan_required",
						summary: "The active plan is stale.",
						resolutionHint: "Regenerate and approve the draft plan.",
						retryable: true,
						autoResolvable: true,
						needsHuman: false,
					},
					featureResult: { featureId: "recover-autonomous" },
					featureReview: {
						status: "passed",
						summary: "No blocking review findings.",
						blockingFindings: [],
					},
				},
				context,
			),
		);
		expect(replan.status).toBe("ok");
		expect(replan.session.status).toBe("planning");
		expect(replan.session.lastOutcome.kind).toBe("replan_required");

		const sessionPath = join(
			worktree,
			".flow",
			"active",
			sessionId,
			"session.json",
		);
		const persisted = JSON.parse(await readFile(sessionPath, "utf8"));
		expect(persisted.execution.history).toHaveLength(2);
		expect(persisted.execution.history[0].outcome.retryable).toBe(true);
		expect(persisted.execution.history[0].outcome.autoResolvable).toBe(true);
		expect(persisted.execution.history[1].outcome.kind).toBe("replan_required");
		expect(persisted.execution.lastOutcome.kind).toBe("replan_required");
	});
});
