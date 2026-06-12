import { afterEach, describe, expect, test } from "bun:test";
import {
	cleanupManagedTempDirs,
	createToolContext,
	importBuiltPlugin,
	makeManagedTempDir,
} from "../cross-area/helpers";

type PluginFactory = typeof import("../../src/index").default;
type BuiltPlugin = Awaited<ReturnType<PluginFactory>>;
type TestTool = {
	execute: (args: unknown, context: unknown) => Promise<string>;
};
type FlowToolName =
	| "flow_status"
	| "flow_plan_save"
	| "flow_plan_approve"
	| "flow_run_start"
	| "flow_feature_complete"
	| "flow_review_record"
	| "flow_session";
type FlowSmokeTools = Record<FlowToolName, TestTool>;

afterEach(() => {
	cleanupManagedTempDirs();
});

describe("built dist smoke load", () => {
	test("dist bundle exposes one agent, nine commands, and seven tools by default", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		expect(plugin.config).toBeFunction();
		expect(plugin.tool).toBeDefined();
		const tools = plugin.tool as unknown as FlowSmokeTools;

		const config = {
			agent: {},
			command: {},
		} as Record<string, Record<string, unknown>>;
		await plugin.config?.(
			config as Parameters<NonNullable<typeof plugin.config>>[0],
		);

		expect(Object.keys(config.agent ?? {})).toHaveLength(1);
		expect(Object.keys(config.command ?? {})).toHaveLength(9);
		expect(Object.keys(plugin.tool ?? {})).toHaveLength(7);
		expect(Object.keys(plugin.tool ?? {}).sort()).toEqual([
			"flow_feature_complete",
			"flow_plan_approve",
			"flow_plan_save",
			"flow_review_record",
			"flow_run_start",
			"flow_session",
			"flow_status",
		]);

		const context = createToolContext(worktree);
		const planSaveResponse = JSON.parse(
			await tools.flow_plan_save.execute(
				{ goal: "Optimize the Flow bundle" },
				context,
			),
		);
		expect(planSaveResponse.status).toBe("ok");
		expect(planSaveResponse.session.goal).toBe("Optimize the Flow bundle");
		const sessionId = planSaveResponse.session.id as string;

		const toolArgs: Record<FlowToolName, unknown> = {
			flow_status: {},
			flow_plan_save: {
				plan: {
					summary: "Build the smoke path.",
					overview: "Exercise the dist bundle end to end.",
					features: [
						{
							id: "dist-smoke",
							title: "Dist smoke feature",
							summary: "Drive the bundled plugin through its surface.",
							fileTargets: ["dist/index.js"],
							verification: ["bun test tests/smoke/dist-load.test.ts"],
						},
					],
				},
			},
			flow_plan_approve: {},
			flow_run_start: {},
			flow_feature_complete: {
				contractVersion: "1",
				status: "needs_input",
				summary: "Need to replan smoke coverage.",
				artifactsChanged: [],
				validationRun: [],
				decisions: [],
				nextStep: "Replan before completion.",
				outcome: {
					kind: "replan_required",
					replanReason: "plan_too_broad",
					failedAssumption:
						"The current feature was small enough to finish in one pass.",
					recommendedAdjustment:
						"Split the work into a smaller follow-up plan.",
				},
				featureResult: { featureId: "dist-smoke" },
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
			flow_review_record: {
				scope: "feature",
				featureId: "dist-smoke",
				status: "approved",
				summary: "Looks good.",
			},
			flow_session: { action: "show", sessionId },
		};

		for (const [toolName, toolImpl] of Object.entries(tools)) {
			const response = await toolImpl.execute(
				toolArgs[toolName as FlowToolName] ?? {},
				context,
			);
			expect(typeof response).toBe("string");
			expect(() => JSON.parse(response)).not.toThrow();
		}
	});
});
