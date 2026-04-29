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
	| "flow_audit_write_report"
	| "flow_audit_reports"
	| "flow_status"
	| "flow_doctor"
	| "flow_history"
	| "flow_history_show"
	| "flow_session_activate"
	| "flow_plan_start"
	| "flow_auto_prepare"
	| "flow_session_close"
	| "flow_plan_context_record"
	| "flow_plan_apply"
	| "flow_plan_approve"
	| "flow_plan_select_features"
	| "flow_run_start"
	| "flow_run_complete_feature"
	| "flow_review_record_feature"
	| "flow_review_record_final"
	| "flow_reset_feature";
type FlowSmokeTools = Record<FlowToolName, TestTool>;

afterEach(() => {
	cleanupManagedTempDirs();
});

describe("built dist smoke load", () => {
	test("dist bundle exposes five agents, ten commands, and nineteen tools by default", async () => {
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

		expect(Object.keys(config.agent ?? {})).toHaveLength(5);
		expect(Object.keys(config.command ?? {})).toHaveLength(10);
		expect(Object.keys(plugin.tool ?? {})).toHaveLength(19);
		expect(plugin.tool?.flow_audit_write_report).toBeDefined();
		expect(plugin.tool?.flow_audit_reports).toBeDefined();

		const context = createToolContext(worktree);
		const planStartResponse = JSON.parse(
			await tools.flow_plan_start.execute(
				{ goal: "Optimize the Flow bundle" },
				context,
			),
		);
		expect(planStartResponse.status).toBe("ok");
		expect(planStartResponse.session.goal).toBe("Optimize the Flow bundle");
		const sessionId = planStartResponse.session.id as string;

		const toolArgs: Record<string, unknown> = {
			flow_audit_write_report: {
				reportJson: JSON.stringify({
					requestedDepth: "deep_audit",
					achievedDepth: "deep_audit",
					repoSummary: "Reviewed one surface directly.",
					overallVerdict: "Deep audit completed.",
					discoveredSurfaces: [
						{
							name: "prompt surfaces",
							category: "source_runtime",
							reviewStatus: "directly_reviewed",
							evidence: ["src/prompts/agents.ts:1-50"],
						},
					],
					validationRun: [
						{
							command: "bun run check",
							status: "not_run",
							summary: "Read-only audit.",
						},
					],
					findings: [],
				}),
			},
			flow_audit_reports: {
				requestJson: JSON.stringify({ action: "history" }),
			},
			flow_status: {},
			flow_doctor: {},
			flow_history: {},
			flow_history_show: { sessionId },
			flow_session_activate: { sessionId },
			flow_plan_start: { goal: "Optimize the Flow bundle" },
			flow_auto_prepare: { argumentString: "resume" },
			flow_session_close: { kind: "completed" },
			flow_plan_context_record: { repoProfile: ["TypeScript"] },
			flow_plan_apply: {
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
			flow_plan_select_features: { featureIds: ["dist-smoke"] },
			flow_run_start: {},
			flow_run_complete_feature: {
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
			flow_review_record_feature: {
				scope: "feature",
				featureId: "dist-smoke",
				status: "approved",
				summary: "Looks good.",
			},
			flow_review_record_final: {
				scope: "final",
				status: "approved",
				summary: "Looks good.",
			},
			flow_reset_feature: { featureId: "dist-smoke" },
		} satisfies Record<string, unknown>;

		for (const [toolName, toolImpl] of Object.entries(tools)) {
			const response = await toolImpl.execute(
				toolArgs[toolName] ?? {},
				context,
			);
			expect(typeof response).toBe("string");
			expect(() => JSON.parse(response)).not.toThrow();
		}
	});
});
